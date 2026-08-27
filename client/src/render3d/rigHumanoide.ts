import * as THREE from "three";
import proporcionesBase from "./proporcionesRig.json";
import { aplicarMorfologia, type Morfologia } from "./morfologia";

/**
 * Rig humanoide básico estilo Roblox/Minecraft: 6 piezas independientes
 * (cabeza, torso, brazo izq/der, pierna izq/der), cada una colgando de su
 * PIVOTE (hombro/cadera/cuello) — animar es rotar pivotes, nunca mover
 * vértices. La futura ropa/pelo/accesorios se cuelga del mismo pivote de la
 * parte del cuerpo que le toque y hereda sus animaciones gratis (decisión
 * de diseño del creador de personajes — ver GDD_Motor_3D_Props.md).
 *
 * La cara no es una textura plana: ojos/nariz son geometría propia sobre la
 * cara frontal (+Z), así el personaje "mira" hacia donde camina de forma
 * legible en la cámara isométrica, y el futuro creador de personajes puede
 * variar cada rasgo por separado (forma/tamaño/color) sin tocar el resto.
 *
 * Es el placeholder animable de personajes mientras no exista su modelo
 * vóxel real — cuando llegue, mantendrá esta MISMA estructura de pivotes
 * (los nombres de hueso de abajo) y esta clase solo cambia la geometría de
 * cada pieza, no la animación ni la API.
 */

// Altura de referencia del personaje de talla base (unidades de mundo;
// 1 unidad = 1 casilla). Las medidas viven en proporcionesRig.json — la
// MISMA fuente que usa ropa/src/generarPrenda.js — y cada personaje las
// recibe ya morfadas por altura/corpulencia/sexo (aplicarMorfologia), así
// la ropa generada sobre esa misma morfología encaja sin ajuste ninguno.
export const ALTO_RIG =
  proporcionesBase.altoPierna + proporcionesBase.altoTorso + proporcionesBase.ladoCabeza; // ≈ 1.57 en talla base

export interface OpcionesRig {
  colorTunica: string; // torso+brazos (la "ropa" del placeholder)
  colorPiel?: string;
  colorPelo?: string;
  colorOjos?: string;
  /** Altura/corpulencia/sexo del personaje — omitida = talla base. */
  morfologia?: Morfologia;
}

export interface RigHumanoide {
  objeto: THREE.Group;
  /** Avanza la animación. `andando` mueve piernas/brazos; parado, respiración sutil. */
  actualizar(dt: number, andando: boolean): void;
  /** Orienta el cuerpo entero hacia una dirección de mundo (dx, dz). */
  orientar(dx: number, dz: number): void;
}

function caja(w: number, h: number, d: number, color: string | number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }),
  );
  m.castShadow = true;
  return m;
}

export function crearRigHumanoide(opciones: OpcionesRig): RigHumanoide {
  const colorPiel = opciones.colorPiel || "#c8956c";
  const colorPelo = opciones.colorPelo || "#4a3220";
  const colorTunica = opciones.colorTunica;

  // Medidas de ESTE personaje: base + su morfología. Todo lo de abajo se
  // construye sobre estas, nunca sobre proporcionesBase directamente.
  const proporciones = aplicarMorfologia(opciones.morfologia);
  const ALTO_PIERNA = proporciones.altoPierna;
  const ALTO_TORSO = proporciones.altoTorso;
  const LADO_CABEZA = proporciones.ladoCabeza;

  const raiz = new THREE.Group(); // anclada por los pies, como todo en el proyecto

  // --- Piernas (pivote en la cadera) ---
  function pierna(ladoX: number): THREE.Group {
    const pivote = new THREE.Group();
    pivote.name = ladoX < 0 ? "piernaIzq" : "piernaDer";
    pivote.position.set(ladoX, ALTO_PIERNA, 0);
    const carne = caja(proporciones.pierna.w, ALTO_PIERNA, proporciones.pierna.d, colorPiel);
    carne.position.y = -ALTO_PIERNA / 2;
    pivote.add(carne);
    return pivote;
  }
  const piernaIzq = pierna(-proporciones.pierna.offsetX);
  const piernaDer = pierna(proporciones.pierna.offsetX);
  raiz.add(piernaIzq, piernaDer);

  // --- Torso ---
  const torso = new THREE.Group();
  torso.name = "torso";
  torso.position.y = ALTO_PIERNA;
  const cuerpoTorso = caja(proporciones.torso.w, ALTO_TORSO, proporciones.torso.d, colorTunica);
  cuerpoTorso.position.y = ALTO_TORSO / 2;
  torso.add(cuerpoTorso);
  raiz.add(torso);

  // --- Brazos (pivote en el hombro, cuelgan del torso) ---
  function brazo(ladoX: number): THREE.Group {
    const pivote = new THREE.Group();
    pivote.name = ladoX < 0 ? "brazoIzq" : "brazoDer";
    const b = proporciones.brazo;
    pivote.position.set(ladoX, ALTO_TORSO + b.pivoteYOffset, 0);
    const manga = caja(b.mangaW, b.mangaH, b.mangaD, colorTunica);
    manga.position.y = -b.mangaH / 2;
    const mano = caja(b.manoW, b.manoH, b.manoD, colorPiel);
    mano.position.y = -b.mangaH - b.manoH / 2;
    pivote.add(manga, mano);
    return pivote;
  }
  const brazoIzq = brazo(-proporciones.brazo.offsetX);
  const brazoDer = brazo(proporciones.brazo.offsetX);
  torso.add(brazoIzq, brazoDer);

  // --- Cabeza (pivote en el cuello) + rasgos faciales como geometría ---
  const cabeza = new THREE.Group();
  cabeza.name = "cabeza";
  cabeza.position.y = ALTO_TORSO;
  const craneo = caja(LADO_CABEZA, LADO_CABEZA, LADO_CABEZA, colorPiel);
  craneo.position.y = LADO_CABEZA / 2;
  const pelo = caja(LADO_CABEZA + 0.04, 0.1, LADO_CABEZA + 0.04, colorPelo);
  pelo.position.y = LADO_CABEZA - 0.03;
  const mitadCara = LADO_CABEZA / 2;
  const ojoIzq = caja(0.05, 0.05, 0.02, opciones.colorOjos || "#1d2b1f");
  ojoIzq.position.set(-0.07, LADO_CABEZA * 0.6, mitadCara + 0.005);
  const ojoDer = ojoIzq.clone();
  ojoDer.position.x = 0.07;
  const nariz = caja(0.05, 0.07, 0.05, colorPiel);
  nariz.position.set(0, LADO_CABEZA * 0.42, mitadCara + 0.02);
  cabeza.add(craneo, pelo, ojoIzq, ojoDer, nariz);
  torso.add(cabeza);

  // --- Animación por pivotes ---
  let fase = 0;
  let pesoAndar = 0; // 0=parado, 1=andando — con rampa para no cortar en seco

  function actualizar(dt: number, andando: boolean) {
    pesoAndar = THREE.MathUtils.clamp(pesoAndar + (andando ? dt : -dt) * 6, 0, 1);
    fase += dt * 9 * Math.max(pesoAndar, 0.15);
    const zancada = Math.sin(fase) * 0.65 * pesoAndar;
    piernaIzq.rotation.x = zancada;
    piernaDer.rotation.x = -zancada;
    brazoIzq.rotation.x = -zancada * 0.7;
    brazoDer.rotation.x = zancada * 0.7;
    // parado: respiración sutil del torso; andando: rebote de zancada
    torso.position.y = ALTO_PIERNA + (pesoAndar > 0.01 ? Math.abs(Math.cos(fase)) * 0.03 * pesoAndar : Math.sin(fase * 0.35) * 0.008);
  }

  function orientar(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    raiz.rotation.y = Math.atan2(dx, dz); // la cara está en +Z local
  }

  return { objeto: raiz, actualizar, orientar };
}
