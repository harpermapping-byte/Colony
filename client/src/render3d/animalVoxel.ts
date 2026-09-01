import * as THREE from "three";
import { normalizarMarcha, type Marcha } from "./rigHumanoide";

/**
 * Materializa un animal del generador (personajes/src/generarAnimal.js):
 * cada pieza es una caja y cada PIVOTE con nombre (pataDelIzq, cabeza,
 * cola, alaIzq, segmento3...) se convierte en un grupo real de Three con
 * su origen de giro bien puesto — animar es rotar/mover pivotes, igual que
 * el rig humanoide. Animación v1: idle por esqueleto (cola que se mueve,
 * alas de insecto batiendo, coleteo de pez, ondulación de serpiente,
 * respiración) + ciclo de andar para patas cuando `andando`.
 */

export interface PiezaAnimal {
  pivote: string;
  cx: number;
  y0: number;
  cz: number;
  w: number;
  h: number;
  d: number;
  color: string;
}

export interface AnimalExportado {
  ficha: { especieId: string; esqueleto: string; escala: number };
  piezas: PiezaAnimal[];
}

export interface AnimalVoxel {
  objeto: THREE.Group;
  /** Marchas embebidas SIEMPRE (regla del streamer): 0 parado, 1 andando, 2 corriendo. */
  actualizar(dt: number, marcha?: Marcha): void;
  orientar(dx: number, dz: number): void;
}

export interface OpcionesAnimalVoxel {
  /**
   * Pose "caído" (cadáveres, pedido 2026-09-01) — ESTÁTICA: se aplica una
   * única vez al construir el rig (patas/alas separadas del cuerpo, cuerpo
   * volcado de lado) y el llamante NUNCA debe llamar `actualizar()` después
   * (no hay animación de cadáver). Pivotes específicos por plantilla para
   * las 3 requeridas (cuadrupedo/ave/insecto, docs/GDD_Muerte_Respawn.md);
   * el resto de esqueletos (pez/serpiente/crustáceo/anfibio, fuera del
   * pedido explícito) solo reciben el volcado genérico de cuerpo entero,
   * que ya por sí solo deja de parecer una criatura viva de pie.
   */
  caido?: boolean;
  /** id del cadáver — jitter DETERMINISTA de qué lado cae (nunca Math.random, ver inclinarCaido en rigHumanoide.ts). */
  id?: string;
}

function caja(p: PiezaAnimal): THREE.Mesh {
  const malla = new THREE.Mesh(
    new THREE.BoxGeometry(p.w, p.h, p.d),
    new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, metalness: 0 }),
  );
  malla.position.set(p.cx, p.y0 + p.h / 2, p.cz);
  malla.castShadow = true;
  return malla;
}

// Origen de giro de cada pivote, deducido de sus piezas: las patas y
// pinzas giran desde ARRIBA (la cadera/hombro), las alas desde su borde
// interior (el flanco del cuerpo), la cola desde su unión con el cuerpo
// (su z máxima), y el resto desde su propio centro.
function origenPivote(nombre: string, piezas: PiezaAnimal[]): THREE.Vector3 {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of piezas) {
    minX = Math.min(minX, p.cx - p.w / 2); maxX = Math.max(maxX, p.cx + p.w / 2);
    minY = Math.min(minY, p.y0); maxY = Math.max(maxY, p.y0 + p.h);
    minZ = Math.min(minZ, p.cz - p.d / 2); maxZ = Math.max(maxZ, p.cz + p.d / 2);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  if (nombre.startsWith("pata") || nombre.startsWith("pinza")) return new THREE.Vector3(cx, maxY, cz);
  if (nombre.startsWith("ala")) return new THREE.Vector3(cx < 0 ? maxX : minX, cy, cz);
  if (nombre === "cola") return new THREE.Vector3(cx, cy, maxZ);
  if (nombre === "cabeza") return new THREE.Vector3(cx, minY, minZ);
  return new THREE.Vector3(cx, cy, cz);
}

/**
 * Pose "caído" por plantilla — solo pivotes, nunca geometría nueva (mismo
 * criterio que el rig humanoide): separa patas/alas del cuerpo como si
 * hubiera caído inerte. `bocaX` deriva de un hash del `id` del cadáver
 * (determinista — mismo cadáver, misma pose para cualquier cliente, nunca
 * Math.random, regla del proyecto).
 */
function aplicarPoseCaidaAnimal(pivotes: Map<string, THREE.Group>, esqueleto: string, lado: number): void {
  switch (esqueleto) {
    case "cuadrupedo": {
      for (const [nombre, grupo] of pivotes) {
        if (!nombre.startsWith("pata")) continue;
        const der = nombre.endsWith("Der");
        grupo.rotation.x = (der ? 1 : -1) * 0.9;
        grupo.rotation.z = lado * 0.5;
      }
      const cabeza = pivotes.get("cabeza");
      if (cabeza) cabeza.rotation.z = lado * 0.35;
      const cola = pivotes.get("cola");
      if (cola) cola.rotation.x = 0.4;
      break;
    }
    case "ave": {
      for (const ladoAla of ["alaIzq", "alaDer"]) {
        const ala = pivotes.get(ladoAla);
        if (ala) ala.rotation.z = (ladoAla === "alaIzq" ? -1 : 1) * 1.1; // extendida, no plegada
      }
      for (const p of ["pataIzq", "pataDer"]) {
        const pata = pivotes.get(p);
        if (pata) pata.rotation.x = 1.2;
      }
      const cabeza = pivotes.get("cabeza");
      if (cabeza) cabeza.rotation.z = lado * 0.4;
      break;
    }
    case "insecto": {
      let i = 0;
      for (const [nombre, grupo] of pivotes) {
        if (!nombre.startsWith("pata")) continue;
        grupo.rotation.x = 0.6 * (i % 2 === 0 ? 1 : -1);
        i++;
      }
      for (const ladoAla of ["alaIzq", "alaDer"]) {
        const ala = pivotes.get(ladoAla);
        if (ala) ala.rotation.z = (ladoAla === "alaIzq" ? -1 : 1) * 0.3;
      }
      break;
    }
    default:
      break; // fuera del pedido explícito: solo el volcado genérico de abajo
  }
}

export function crearAnimalVoxel(datos: AnimalExportado, opciones?: OpcionesAnimalVoxel): AnimalVoxel {
  const raiz = new THREE.Group();
  const pivotes = new Map<string, THREE.Group>();

  const porPivote = new Map<string, PiezaAnimal[]>();
  for (const p of datos.piezas) {
    if (!porPivote.has(p.pivote)) porPivote.set(p.pivote, []);
    porPivote.get(p.pivote)!.push(p);
  }
  for (const [nombre, piezas] of porPivote) {
    const grupo = new THREE.Group();
    grupo.name = nombre;
    const origen = origenPivote(nombre, piezas);
    grupo.position.copy(origen);
    grupo.userData.baseX = origen.x; // para oscilar sobre la posición de reposo (serpiente)
    for (const p of piezas) {
      const malla = caja(p);
      malla.position.sub(origen);
      grupo.add(malla);
    }
    pivotes.set(nombre, grupo);
    raiz.add(grupo);
  }

  const esqueleto = datos.ficha.esqueleto;

  if (opciones?.caido) {
    // Volcado genérico de cuerpo entero, válido para cualquier esqueleto
    // (bbox calculada ANTES de rotar, con raíz todavía en el origen):
    // rotar 90° en Z tumba al animal de lado; se sube lo que ocupaba de
    // ancho para no enterrarlo medio en la casilla.
    const bbox = new THREE.Box3().setFromObject(raiz);
    let hash = 0;
    const idJitter = opciones?.id ?? "";
    for (let i = 0; i < idJitter.length; i++) hash = (hash * 31 + idJitter.charCodeAt(i)) >>> 0;
    const lado = hash % 2 === 0 ? 1 : -1;
    aplicarPoseCaidaAnimal(pivotes, esqueleto, lado);
    raiz.rotation.z = (lado * Math.PI) / 2;
    raiz.position.y = Math.max(Math.abs(bbox.min.x), Math.abs(bbox.max.x)) + 0.03;
    const objeto = raiz;
    return {
      objeto,
      actualizar: () => {}, // cadáver estático: nunca se llama, pero cumple la interfaz
      orientar: () => {},
    };
  }
  let fase = Math.random() * Math.PI * 2; // desfase entre individuos: que no respiren todos a la vez (solo visual, no afecta a nada determinista)
  let pesoAndar = 0;
  let pesoCorrer = 0;

  function actualizar(dt: number, marcha: Marcha = 0) {
    const m = normalizarMarcha(marcha);
    pesoAndar = THREE.MathUtils.clamp(pesoAndar + (m >= 1 ? dt : -dt) * 5, 0, 1);
    pesoCorrer = THREE.MathUtils.clamp(pesoCorrer + (m >= 2 ? dt : -dt) * 5, 0, 1);
    // correr acelera TODO el ciclo (patas, cola, ondulación) y amplía la
    // zancada — así el galope/carrera existe en los 7 esqueletos sin código
    // extra por especie: los peces coletean más fuerte, las serpientes
    // ondulan más rápido, los cuadrúpedos galopan con rebote.
    fase += dt * 3 * (1 + 1.2 * pesoCorrer);
    const t = fase;

    // ciclo de andar genérico: patas en contrafase (vale para cuadrúpedo,
    // ave y crustáceo; los esqueletos sin patas lo ignoran)
    let i = 0;
    for (const [nombre, grupo] of pivotes) {
      if (!nombre.startsWith("pata")) continue;
      grupo.rotation.x = Math.sin(t * 3 + (i % 2 === 0 ? 0 : Math.PI)) * (0.5 + 0.3 * pesoCorrer) * pesoAndar;
      i++;
    }
    // rebote de carrera del cuerpo entero (galope) — solo en tierra
    if (esqueleto === "cuadrupedo" || esqueleto === "ave" || esqueleto === "anfibio") {
      raiz.position.y = Math.abs(Math.cos(t * 3)) * 0.06 * pesoCorrer;
    }

    switch (esqueleto) {
      case "cuadrupedo": {
        const cola = pivotes.get("cola");
        if (cola) cola.rotation.y = Math.sin(t * 1.6) * 0.3;
        const cabeza = pivotes.get("cabeza");
        if (cabeza) cabeza.rotation.x = Math.sin(t * 0.7) * 0.06;
        break;
      }
      case "ave": {
        const cabeza = pivotes.get("cabeza");
        if (cabeza) cabeza.position.y += Math.sin(t * 2.2) * 0.0015; // picoteo sutil
        break;
      }
      case "insecto": {
        // alas batiendo rápido + vuelo estacionario del cuerpo entero
        for (const lado of ["alaIzq", "alaDer"]) {
          const ala = pivotes.get(lado);
          if (ala) ala.rotation.z = Math.sin(t * 22) * (lado === "alaIzq" ? 0.7 : -0.7);
        }
        raiz.position.y = Math.sin(t * 1.8) * 0.04;
        break;
      }
      case "pez": {
        const cola = pivotes.get("cola");
        if (cola) cola.rotation.y = Math.sin(t * 4) * 0.45;
        raiz.rotation.z = Math.sin(t * 1.2) * 0.04;
        break;
      }
      case "serpiente": {
        for (const [nombre, grupo] of pivotes) {
          if (!nombre.startsWith("segmento")) continue;
          const n = Number(nombre.slice(9)) || 0;
          grupo.position.x = grupo.userData.baseX + Math.sin(t * 2 + n * 0.9) * 0.02;
        }
        break;
      }
      case "crustaceo": {
        for (const lado of ["pinzaIzq", "pinzaDer"]) {
          const pinza = pivotes.get(lado);
          if (pinza) pinza.rotation.x = Math.max(0, Math.sin(t * 1.4 + (lado === "pinzaIzq" ? 0 : 1.3))) * 0.25;
        }
        break;
      }
      case "anfibio": {
        // la garganta/cuerpo hincha al respirar
        const cuerpo = pivotes.get("cuerpo");
        if (cuerpo) cuerpo.scale.y = 1 + Math.sin(t * 2.4) * 0.03;
        break;
      }
    }
  }

  function orientar(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    raiz.rotation.y = Math.atan2(dx, dz); // el frente del animal es +z, como el rig
  }

  return { objeto: raiz, actualizar, orientar };
}
