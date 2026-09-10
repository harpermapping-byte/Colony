import animalesRigJson from "../../../personajes/catalogo/animales_rig.json";
import animalesBakerJson from "../../../baker/catalogo/animales.json";
import type { AnimalExportado, PiezaAnimal } from "./animalVoxel";
import { animalPlaceholder } from "./animalPlaceholder";

/**
 * Port en TypeScript de `personajes/src/generarAnimal.js` — SOLO los dos
 * esqueletos más visibles en tierra (cuadrupedo/ave: lobos, ciervos,
 * conejos, gallinas, pájaros...), pedido explícito del streamer para
 * cerrar de primeras el hueco más notado ("rectángulos con vida arriba
 * moverse") sin portar los 14 esqueletos restantes (marino/insectos, menos
 * frecuentes en pantalla) todavía. Mismo patrón ya usado por
 * `crearFichaVoxel.ts` para el creador de personaje: una copia de solo
 * lectura para el cliente en vivo, la fuente de verdad offline sigue
 * siendo `generarAnimal.js` (usado por el pool de fauna decorativa y por
 * el bake). Si generarAnimal.js gana un rasgo nuevo en estos dos
 * esqueletos, hay que copiarlo aquí también.
 *
 * A diferencia de la ficha de personaje (persistida, un único resultado
 * por cuenta), un individuo vivo de fauna/mascota/montura NO tiene semilla
 * de bake propia — se genera bajo demanda en el momento en que aparece en
 * el cliente (`especieId` + el id real de su entrada en el Schema de
 * Colyseus como semilla estable), así que dos clientes viendo el MISMO
 * individuo (mismo id) ven exactamente el mismo aspecto, y el mismo
 * individuo se ve igual mientras exista.
 */

interface Proporciones {
  largoCuerpo: number;
  altoCuerpo: number;
  anchoCuerpo: number;
  altoPata: number;
  grosorPata?: number;
  tamCabeza: number;
}

interface Raza {
  id: string;
  peso: number;
  escala?: [number, number];
  proporciones?: Partial<Proporciones>;
  rasgos?: Record<string, unknown>;
  coloresPosibles?: [string, number][];
}

interface EntradaRig {
  esqueleto: string;
  escala?: [number, number];
  proporciones?: Proporciones;
  rasgos?: Record<string, unknown>;
  razas?: Raza[];
  coloresPosibles?: [string, number][];
  heredaDe?: string;
  heredaRazasDe?: string;
  esCria?: boolean;
}

interface EntradaBaker {
  colorDebug?: string;
}

const RIG: Record<string, EntradaRig> = animalesRigJson as unknown as Record<string, EntradaRig>;
const BAKER: Record<string, EntradaBaker> = animalesBakerJson as unknown as Record<string, EntradaBaker>;
const COLOR_DEFECTO = "#8a7a5a";

const COLOR_OJO = "#1a140e";
const COLOR_PICO = "#c9922a";
const COLOR_CRESTA = "#c0392b";
const COLOR_CUERNO = "#d8cfc0";

// Mismo mulberry32 que interiores/src/azar.js — copiado en vez de cruzar un
// require() de Node a un bundle de navegador (mismo criterio ya usado en
// crearFichaVoxel.ts).
function crearPRNG(semillaTexto: string): () => number {
  let h = 1779033703 ^ semillaTexto.length;
  for (let i = 0; i < semillaTexto.length; i++) {
    h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function siguiente() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function elegirPonderado<T>(lista: [T, number][], rnd: () => number): T {
  const total = lista.reduce((s, [, peso]) => s + peso, 0);
  let tirada = rnd() * total;
  for (const [valor, peso] of lista) {
    tirada -= peso;
    if (tirada <= 0) return valor;
  }
  return lista[lista.length - 1][0];
}

function enRango([min, max]: [number, number], rnd: () => number): number {
  return min + (max - min) * rnd();
}

function ajustarColor(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c: number) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

// --- Plantillas de esqueleto — port literal de generarAnimal.js, mismos
// nombres de pivote/geometría (ver ese archivo para el resto de esqueletos).

function esqueletoCuadrupedo(p: Proporciones, rasgos: Record<string, unknown>, color: string, rnd: () => number): PiezaAnimal[] {
  const piezas: PiezaAnimal[] = [];
  const pieza = (pivote: string, cx: number, y0: number, cz: number, w: number, h: number, d: number, c: string) =>
    piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const topeCuerpo = p.altoPata + p.altoCuerpo;

  pieza("cuerpo", 0, p.altoPata, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);

  const grosorPata = p.grosorPata ?? p.anchoCuerpo * 0.22;
  const margenPata = grosorPata / 2;
  for (const [pivote, sx, sz] of [
    ["pataDelIzq", -1, 1], ["pataDelDer", 1, 1], ["pataTrasIzq", -1, -1], ["pataTrasDer", 1, -1],
  ] as [string, number, number][]) {
    pieza(pivote, sx * (p.anchoCuerpo / 2 - margenPata), 0, sz * (p.largoCuerpo / 2 - margenPata), grosorPata, p.altoPata, grosorPata, ajustarColor(color, -0.06));
  }

  // cabeza al frente, levantada respecto al lomo
  const cabezaY = topeCuerpo - p.tamCabeza * 0.5;
  const cabezaZ = p.largoCuerpo / 2 + p.tamCabeza / 2;
  pieza("cabeza", 0, cabezaY, cabezaZ, p.tamCabeza, p.tamCabeza, p.tamCabeza, color);

  // hocico por rasgo (corto/medio/largo)
  const hocicoRasgo = (rasgos.hocico as string) || "medio";
  const largoHocico = ({ corto: 0.25, medio: 0.45, largo: 0.7 }[hocicoRasgo] ?? 0.45) * p.tamCabeza;
  pieza("cabeza", 0, cabezaY + p.tamCabeza * 0.15, cabezaZ + p.tamCabeza / 2 + largoHocico / 2, p.tamCabeza * 0.55, p.tamCabeza * 0.45, largoHocico, ajustarColor(color, -0.08));

  // ojos a los lados de la cabeza (los cuadrúpedos miran lateral)
  const ojo = p.tamCabeza * 0.16;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.004), cabezaY + p.tamCabeza * 0.6, cabezaZ + p.tamCabeza * 0.2, 0.012, ojo, ojo, COLOR_OJO);
  }

  // orejas por rasgo — "ninguna" (reptiles/pinnípedos) no dibuja nada.
  const orejas = (rasgos.orejas as string) || "puntiagudas";
  if (orejas !== "ninguna") {
    const altoOreja = ({ largas: 0.9, puntiagudas: 0.45, laterales: 0.2, caidas: 0.65, cortas: 0.28 }[orejas] ?? 0.45) * p.tamCabeza;
    const anchoOreja = orejas === "laterales" ? p.tamCabeza * 0.45 : p.tamCabeza * 0.22;
    for (const lado of [-1, 1]) {
      const ox = orejas === "laterales" ? lado * (p.tamCabeza / 2 + anchoOreja / 2) : lado * p.tamCabeza * 0.28;
      const oy = orejas === "laterales" ? cabezaY + p.tamCabeza * 0.6 : cabezaY + p.tamCabeza;
      pieza("cabeza", ox, oy, cabezaZ - p.tamCabeza * 0.1, anchoOreja, altoOreja, p.tamCabeza * 0.14, ajustarColor(color, -0.05));
    }
  }

  // cuernos por rasgo (cortos = tacos; ramificados = columna + travesaño)
  if (rasgos.cuernos === "cortos") {
    for (const lado of [-1, 1]) {
      pieza("cabeza", lado * p.tamCabeza * 0.32, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.14, p.tamCabeza * 0.4, p.tamCabeza * 0.14, COLOR_CUERNO);
    }
  } else if (rasgos.cuernos === "ramificados") {
    for (const lado of [-1, 1]) {
      const bx = lado * p.tamCabeza * 0.3;
      pieza("cabeza", bx, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.12, p.tamCabeza * 0.9, p.tamCabeza * 0.12, COLOR_CUERNO);
      pieza("cabeza", bx + lado * p.tamCabeza * 0.18, cabezaY + p.tamCabeza * 1.55, cabezaZ - p.tamCabeza * 0.05, p.tamCabeza * 0.45, p.tamCabeza * 0.1, p.tamCabeza * 0.1, COLOR_CUERNO);
    }
  }

  // cola por rasgo
  const colaZ = -p.largoCuerpo / 2;
  if (rasgos.cola === "pomo") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.3, colaZ - 0.03, p.anchoCuerpo * 0.3, p.anchoCuerpo * 0.3, 0.07, ajustarColor(color, 0.1));
  } else if (rasgos.cola === "corta") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.25, colaZ - 0.05, grosorPata, grosorPata, 0.12, ajustarColor(color, -0.05));
  } else if (rasgos.cola === "larga") {
    const largoCola = p.largoCuerpo * (0.35 + rnd() * 0.1); // variación individual sutil
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.35, colaZ - largoCola / 2, grosorPata, grosorPata, largoCola, ajustarColor(color, -0.05));
  }

  return piezas;
}

function esqueletoAve(p: Proporciones, rasgos: Record<string, unknown>, color: string, _rnd: () => number): PiezaAnimal[] {
  const piezas: PiezaAnimal[] = [];
  const pieza = (pivote: string, cx: number, y0: number, cz: number, w: number, h: number, d: number, c: string) =>
    piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const topeCuerpo = p.altoPata + p.altoCuerpo;

  pieza("cuerpo", 0, p.altoPata, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);

  // patas finas (las aves del bake andan; volar es animación futura)
  const grosorPata = 0.035;
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "pataIzq" : "pataDer", lado * p.anchoCuerpo * 0.22, 0, 0, grosorPata, p.altoPata, grosorPata, COLOR_PICO);
  }

  // alas plegadas a los lados
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "alaIzq" : "alaDer", lado * (p.anchoCuerpo / 2 + 0.02), p.altoPata + p.altoCuerpo * 0.25, -p.largoCuerpo * 0.05, 0.05, p.altoCuerpo * 0.6, p.largoCuerpo * 0.75, ajustarColor(color, -0.1));
  }

  // cabeza sobre el frente del cuerpo
  const cabezaY = topeCuerpo + p.tamCabeza * 0.1;
  const cabezaZ = p.largoCuerpo * 0.32;
  pieza("cabeza", 0, cabezaY, cabezaZ, p.tamCabeza, p.tamCabeza, p.tamCabeza, color);

  // pico
  const largoPico = (rasgos.pico === "largo" ? 0.9 : 0.45) * p.tamCabeza;
  pieza("cabeza", 0, cabezaY + p.tamCabeza * 0.3, cabezaZ + p.tamCabeza / 2 + largoPico / 2, p.tamCabeza * 0.3, p.tamCabeza * 0.25, largoPico, COLOR_PICO);

  // ojos laterales
  const ojo = p.tamCabeza * 0.2;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.003), cabezaY + p.tamCabeza * 0.55, cabezaZ + p.tamCabeza * 0.1, 0.01, ojo, ojo, COLOR_OJO);
  }

  if (rasgos.cresta) {
    pieza("cabeza", 0, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.2, p.tamCabeza * 0.35, p.tamCabeza * 0.7, COLOR_CRESTA);
  }

  // cola en abanico
  if (rasgos.cola === "abanico") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.15, -p.largoCuerpo / 2 - p.largoCuerpo * 0.15, p.anchoCuerpo * 0.8, p.altoCuerpo * 0.5, p.largoCuerpo * 0.3, ajustarColor(color, -0.12));
  }

  return piezas;
}

function limpiarRasgosCria(rasgos: Record<string, unknown>): Record<string, unknown> {
  const limpio = { ...rasgos };
  if (limpio.cuernos) limpio.cuernos = "ninguno";
  if ("cresta" in limpio) limpio.cresta = false;
  return limpio;
}

/** Resuelve `heredaDe`/`heredaRazasDe` — mismo algoritmo que generarAnimal.js::resolverHerencia. Null si la especie base no existe (catálogo inconsistente). */
function resolverHerencia(rig: EntradaRig): EntradaRig | null {
  if (rig.heredaDe) {
    const base = RIG[rig.heredaDe];
    if (!base) return null;
    let rasgos = { ...base.rasgos, ...(rig.rasgos || {}) };
    if (rig.esCria) rasgos = limpiarRasgosCria(rasgos);
    return {
      esqueleto: base.esqueleto,
      escala: rig.escala || base.escala,
      proporciones: base.proporciones,
      rasgos,
      razas: rig.esCria ? undefined : base.razas,
      coloresPosibles: rig.esCria ? undefined : base.coloresPosibles,
    };
  }
  if (rig.heredaRazasDe) {
    const otra = RIG[rig.heredaRazasDe];
    if (!otra) return null;
    return { ...rig, razas: otra.razas };
  }
  return rig;
}

/**
 * Genera el cuerpo vóxel REAL de un individuo vivo (fauna/mascota/montura)
 * si su especie es cuadrupedo/ave — cae a `animalPlaceholder` (caja única)
 * para cualquier otro esqueleto o especie sin rig, exactamente igual que
 * antes de este port. Nunca lanza.
 */
export function generarAnimalVoxel(especieId: string, individuoId: string): AnimalExportado {
  const rigDeclarado = RIG[especieId];
  if (!rigDeclarado) return animalPlaceholder(especieId);
  const rig = resolverHerencia(rigDeclarado);
  if (!rig || (rig.esqueleto !== "cuadrupedo" && rig.esqueleto !== "ave") || !rig.proporciones || !rig.escala) {
    return animalPlaceholder(especieId);
  }

  const rnd = crearPRNG(`${individuoId}|animal|${especieId}`);

  const raza = rig.razas?.length ? elegirPonderado(rig.razas.map((r): [Raza, number] => [r, r.peso]), rnd) : null;
  const escalaRango = raza?.escala ?? rig.escala;
  const proporcionesBase: Proporciones = { ...rig.proporciones, ...(raza?.proporciones ?? {}) };
  const rasgosBase: Record<string, unknown> = { ...(rig.rasgos ?? {}), ...(raza?.rasgos ?? {}) };
  const coloresPosibles = raza?.coloresPosibles ?? rig.coloresPosibles;

  const escala = Number(enRango(escalaRango, rnd).toFixed(3));
  const colorBase = coloresPosibles?.length ? elegirPonderado(coloresPosibles, rnd) : (BAKER[especieId]?.colorDebug ?? COLOR_DEFECTO);
  const color = ajustarColor(colorBase, (rnd() - 0.5) * 0.12);
  const sexo = rnd() < 0.5 ? "macho" : "hembra";

  const proporciones = {} as Proporciones;
  for (const [k, v] of Object.entries(proporcionesBase) as [keyof Proporciones, number][]) proporciones[k] = v * escala;

  const rasgos = { ...rasgosBase };
  if (rasgos.cuernos === "ramificados" && sexo === "hembra") delete rasgos.cuernos;

  const piezas = rig.esqueleto === "cuadrupedo"
    ? esqueletoCuadrupedo(proporciones, rasgos, color, rnd)
    : esqueletoAve(proporciones, rasgos, color, rnd);

  return { ficha: { especieId, esqueleto: rig.esqueleto, escala }, piezas };
}
