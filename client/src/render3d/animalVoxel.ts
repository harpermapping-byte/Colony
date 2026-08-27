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

export function crearAnimalVoxel(datos: AnimalExportado): AnimalVoxel {
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
