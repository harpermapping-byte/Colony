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

/**
 * Marchas embebidas en TODO esqueleto (regla del streamer): parado (0),
 * andando (1) y corriendo (2) existen SIEMPRE, listas para que cualquier
 * mecánica futura las dispare. `true`/`false` siguen valiendo como
 * andando/parado (compatibilidad con el código existente).
 */
export type Marcha = 0 | 1 | 2 | boolean;

export function normalizarMarcha(marcha: Marcha | undefined): number {
  if (marcha === true) return 1;
  if (!marcha) return 0;
  return Math.min(2, Math.max(0, marcha));
}

export interface RigHumanoide {
  objeto: THREE.Group;
  /**
   * Avanza la animación según la marcha (parado/andando/corriendo).
   * `tocando` (docs/GDD_Instrumentos.md, pedido 2026-08-31): pose genérica
   * de "tocando instrumento" — balanceo de brazos/cabeza sobre el idle,
   * compartida por los 4 instrumentos (alcance explícito: una sola
   * coreografía, no una por instrumento). Solo tiene efecto real con
   * marcha=0 (parado) — el servidor ya cancela la reproducción en cuanto el
   * jugador se mueve, así que ambas cosas nunca deberían darse juntas, pero
   * la pose no fuerza esa combinación por su cuenta.
   * `sentado`/`sentadoSuelo`/`tumbado` (pedido 2026-08-31, "sentarse en
   * sillas/bancos/sofás, sentarse en el suelo con otra animación, y
   * tumbarse en la cama"): poses estáticas, se pisan entre sí en ese orden
   * de prioridad (sentado > sentadoSuelo > tumbado > tocando) — nunca
   * deberían coincidir de todas formas (el servidor cancela unas a otras).
   * `caido` (pedido 2026-09-01, "los cadáveres deben verse como el
   * personaje real, tumbado"): PRIORIDAD MÁXIMA, por delante incluso de
   * sentado/tumbado — un cadáver nunca debería mezclarse con ninguna otra
   * pose. A diferencia de `tumbado` (relajado, simétrico, para dormir en
   * cama) esta pose queda asimétrica y desmadejada (brazo/pierna en
   * ángulos distintos, cabeza ladeada) para leerse claramente como "caído"
   * y no como "tumbado a propósito". El volcado del cuerpo entero (yacer de
   * lado en el suelo) lo aplica el llamante rotando `objeto` — mismo
   * mecanismo ya usado por nadar/tumbado — ver `inclinarCaido` más abajo.
   * `trabajando` (docs/GDD_NPCs_Contratables.md, pedido 2026-09-01): pose
   * fija de un NPC trabajador operando su mesa de oficio — de pie, ligera
   * inclinación hacia delante y brazos ocupados sobre la mesa (sin
   * keyframes, un pose fijo es consistente con el resto del proyecto,
   * mismo criterio que `tocando`/`caido`). Prioridad justo por debajo de
   * `caido` y de las poses sentado/tumbado (nunca deberían coincidir de
   * todas formas: un trabajador nunca se sienta ni cae mientras trabaja).
   */
  actualizar(dt: number, marcha?: Marcha, tocando?: boolean, sentado?: boolean, sentadoSuelo?: boolean, tumbado?: boolean, caido?: boolean, trabajando?: boolean): void;
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
  // La mano es su PROPIO pivote nombrado (manoIzq/manoDer, colgado del
  // pivote del brazo) — antes era solo una caja suelta dentro de brazoIzq/
  // brazoDer, sin nombre propio. Necesario para que anillos/brazaletes/
  // guantes/armas (docs/GDD_Equipo.md) puedan colgarse con el mismo patrón
  // "buscar el pivote por nombre" (mallasPorPivote/personajeVoxel.ts) que
  // ya usa el resto del equipo/ropa, heredando la animación del brazo
  // entero gratis. y=0 del pivote de mano es la MUÑECA (donde termina la
  // manga) — mismo sitio exacto donde ya se dibujaba la caja de la mano,
  // así que esto no cambia nada visualmente, solo le pone nombre.
  function brazo(ladoX: number): THREE.Group {
    const pivote = new THREE.Group();
    pivote.name = ladoX < 0 ? "brazoIzq" : "brazoDer";
    const b = proporciones.brazo;
    pivote.position.set(ladoX, ALTO_TORSO + b.pivoteYOffset, 0);
    const manga = caja(b.mangaW, b.mangaH, b.mangaD, colorTunica);
    manga.position.y = -b.mangaH / 2;
    pivote.add(manga);

    const manoPivote = new THREE.Group();
    manoPivote.name = ladoX < 0 ? "manoIzq" : "manoDer";
    manoPivote.position.y = -b.mangaH;
    const mano = caja(b.manoW, b.manoH, b.manoD, colorPiel);
    mano.position.y = -b.manoH / 2;
    manoPivote.add(mano);
    pivote.add(manoPivote);

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
  // con nombre para que personajeVoxel.ts pueda ocultarlo cuando el
  // personaje trae pelo vóxel real del generador (si no, se duplicarían)
  pelo.name = "peloPlaceholder";
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
  let faseTocando = 0;
  let pesoAndar = 0; // 0=parado, 1=en movimiento — con rampa para no cortar en seco
  let pesoCorrer = 0; // 0=andando, 1=corriendo — segunda rampa sobre la primera

  function actualizar(dt: number, marcha: Marcha = 0, tocando = false, sentado = false, sentadoSuelo = false, tumbado = false, caido = false, trabajando = false) {
    // Cadáver: prioridad absoluta, pose fija desmadejada — nunca se anima
    // (el llamante la aplica una única vez y no vuelve a llamar actualizar).
    if (caido) {
      piernaIzq.rotation.x = 0.35;
      piernaIzq.rotation.z = -0.25;
      piernaDer.rotation.x = -0.15;
      piernaDer.rotation.z = 0.4;
      brazoIzq.rotation.x = 0.2;
      brazoIzq.rotation.z = -0.9;
      brazoDer.rotation.x = -0.6;
      brazoDer.rotation.z = 0.5;
      torso.rotation.x = 0;
      torso.rotation.z = 0.08;
      cabeza.rotation.x = 0;
      cabeza.rotation.z = -0.3;
      torso.position.y = ALTO_PIERNA;
      return;
    }
    // Poses estáticas (sentado/sentadoSuelo/tumbado) pisan la zancada
    // entera y no se mezclan con marcha/tocando — el servidor ya garantiza
    // que no coinciden con movimiento real (se cancelan solas al andar).
    if (sentado || sentadoSuelo) {
      const flexion = sentadoSuelo ? 1.9 : 1.4; // en el suelo, piernas más recogidas
      piernaIzq.rotation.x = flexion;
      piernaDer.rotation.x = flexion;
      brazoIzq.rotation.x = sentadoSuelo ? 0.3 : 0;
      brazoDer.rotation.x = sentadoSuelo ? 0.3 : 0;
      torso.rotation.x = sentadoSuelo ? 0.15 : 0;
      torso.rotation.z = 0;
      cabeza.rotation.x = 0;
      torso.position.y = ALTO_PIERNA;
      return;
    }
    if (tumbado) {
      // Tumbado (cama): piernas y brazos relajados, la inclinación de
      // cuerpo entero boca arriba la aplica el llamante (mismo mecanismo
      // que nadando, game.ts) rotando `objeto` — aquí solo se sueltan los
      // pivotes para que no se vea la pose de correr mientras está tumbado.
      piernaIzq.rotation.x = 0;
      piernaDer.rotation.x = 0;
      brazoIzq.rotation.x = 0;
      brazoDer.rotation.x = 0;
      torso.rotation.x = 0;
      torso.rotation.z = 0;
      cabeza.rotation.x = 0;
      torso.position.y = ALTO_PIERNA;
      return;
    }
    if (trabajando) {
      // Ligero balanceo de brazos (moler/martillear/tallar genérico) sobre
      // una postura fija inclinada hacia la mesa — misma cadencia visual
      // que `tocando` pero más contenida (brazos abajo, no alzados).
      faseTocando += dt * 4;
      const balanceo = Math.sin(faseTocando) * 0.25;
      piernaIzq.rotation.x = 0;
      piernaDer.rotation.x = 0;
      brazoIzq.rotation.x = -0.55 + balanceo;
      brazoDer.rotation.x = -0.55 - balanceo;
      torso.rotation.x = 0.25;
      torso.rotation.z = 0;
      cabeza.rotation.x = 0.15;
      torso.position.y = ALTO_PIERNA;
      return;
    }
    const m = normalizarMarcha(marcha);
    pesoAndar = THREE.MathUtils.clamp(pesoAndar + (m >= 1 ? dt : -dt) * 6, 0, 1);
    pesoCorrer = THREE.MathUtils.clamp(pesoCorrer + (m >= 2 ? dt : -dt) * 6, 0, 1);
    // correr = misma zancada, más rápida y más amplia, brazos más fuertes
    // y el torso echado hacia delante
    fase += dt * (9 + 5 * pesoCorrer) * Math.max(pesoAndar, 0.15);
    const zancada = Math.sin(fase) * (0.65 + 0.35 * pesoCorrer) * pesoAndar;
    piernaIzq.rotation.x = zancada;
    piernaDer.rotation.x = -zancada;
    brazoIzq.rotation.x = -zancada * (0.7 + 0.25 * pesoCorrer);
    brazoDer.rotation.x = zancada * (0.7 + 0.25 * pesoCorrer);
    torso.rotation.x = 0.2 * pesoCorrer;
    torso.rotation.z = 0;
    cabeza.rotation.x = 0;
    // parado: respiración sutil del torso; en movimiento: rebote de zancada
    torso.position.y = ALTO_PIERNA + (pesoAndar > 0.01 ? Math.abs(Math.cos(fase)) * (0.03 + 0.025 * pesoCorrer) * pesoAndar : Math.sin(fase * 0.35) * 0.008);

    // Tocando instrumento: pose genérica sobre el idle (brazos alzados que
    // se balancean, leve cabeceo/vaivén del torso) — pisa la rotación de
    // brazos de arriba a propósito, ya nunca coincide con zancada real.
    if (tocando) {
      faseTocando += dt * 6;
      const balanceo = Math.sin(faseTocando) * 0.35;
      brazoIzq.rotation.x = -0.9 + balanceo;
      brazoDer.rotation.x = -0.9 - balanceo;
      cabeza.rotation.x = Math.sin(faseTocando * 0.5) * 0.08;
      torso.rotation.z = Math.sin(faseTocando * 0.5) * 0.03;
    }
  }

  function orientar(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    raiz.rotation.y = Math.atan2(dx, dz); // la cara está en +Z local
  }

  return { objeto: raiz, actualizar, orientar };
}

/**
 * Vuelca el rig entero para que quede tumbado en el suelo (cadáveres,
 * pedido 2026-09-01) — mismo mecanismo ya usado por nadar/dormir (rotar
 * `objeto.rotation.x`, RigHumanoide.actualizar solo suelta los pivotes),
 * aplicado UNA sola vez porque un cadáver no vuelve a animarse. Cae de
 * lado (rotation.z) en vez de bocarriba/bocabajo — se lee mejor en la
 * cámara isométrica fija — con una pequeña variación de lado/ángulo
 * DETERMINISTA por `id` (mismo cadáver = misma pose para cualquier
 * cliente que lo mire, nunca `Math.random()` — regla del proyecto) para
 * que varios cadáveres juntos no queden todos clonados.
 */
export function inclinarCaido(objeto: THREE.Object3D, id: string): void {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const lado = hash % 2 === 0 ? 1 : -1;
  const jitter = ((hash >> 3) % 100) / 100 - 0.5; // -0.5..0.5
  objeto.rotation.order = "YXZ";
  objeto.rotation.x = 0.05 + jitter * 0.15;
  objeto.rotation.z = lado * (Math.PI / 2 + jitter * 0.3);
  // al caer de lado la altura que ocupaba de ancho pasa a ser vertical —
  // se sube un poco para no enterrar medio cuerpo bajo la casilla.
  objeto.position.y += 0.28;
}
