import rasgos from "../../../personajes/catalogo/rasgos.json";
import proporcionesRig from "../render3d/proporcionesRig.json";
import type { FichaPersonaje } from "../render3d/personajeVoxel";
import type { VoxelExportado } from "../render3d/voxelMalla";

/**
 * Port en TypeScript de la geometría de pelo/barba de
 * `personajes/src/generarPersonaje.js` (mismas 30 formas de pelo + 15 de
 * barba, copiadas tal cual) — SOLO para la vista previa en vivo del creador
 * de personaje (`creadorPersonaje.ts`), mismo patrón ya establecido en el
 * proyecto para cálculos que necesitan resolverse en el cliente sin ida y
 * vuelta al servidor por cada clic (ver `render3d/generarMuebleVoxel.ts`
 * como gemelo de `taller-vox/generarMuebleVoxel.js`).
 *
 * La ficha REAL que se persiste y que ve el resto de jugadores SIEMPRE sale
 * del servidor (`server/src/personaje/generadorFichaJugador.ts`, que valida
 * contra el mismo catálogo) — este archivo es una aproximación de solo
 * lectura para que el panel se sienta instantáneo, nunca la fuente de
 * verdad. Si un peinado nuevo se añade a generarPersonaje.js, hay que
 * copiarlo aquí también (mismo mantenimiento en dos sitios que ya aceptan
 * el resto de "ports" del proyecto).
 */

type Caja = { x: [number, number]; y: [number, number]; z: [number, number] };

function caja(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Caja {
  return { x: [x0, x1], y: [y0, y1], z: [z0, z1] };
}
function parLateral(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Caja[] {
  return [caja(x0, x1, y0, y1, z0, z1), caja(-x1, -x0, y0, y1, z0, z1)];
}

const CAJAS_PELO: Record<string, Caja[]> = {
  calvo: [],
  rapado: [
    { x: [-0.56, 0.56], y: [1.0, 1.09], z: [-0.56, 0.5] },
    { x: [-0.56, 0.56], y: [0.5, 1.0], z: [-0.62, -0.5] },
  ],
  corto: [
    { x: [-0.6, 0.6], y: [1.0, 1.18], z: [-0.6, 0.5] },
    { x: [-0.6, 0.6], y: [0.35, 1.0], z: [-0.66, -0.5] },
    { x: [-0.66, -0.5], y: [0.55, 1.0], z: [-0.55, 0.35] },
    { x: [0.5, 0.66], y: [0.55, 1.0], z: [-0.55, 0.35] },
    { x: [-0.45, 0.45], y: [1.0, 1.12], z: [0.5, 0.58] },
  ],
  melena: [
    { x: [-0.62, 0.62], y: [1.0, 1.18], z: [-0.62, 0.5] },
    { x: [-0.62, 0.62], y: [-0.18, 1.0], z: [-0.68, -0.5] },
    { x: [-0.68, -0.5], y: [0.1, 1.0], z: [-0.6, 0.3] },
    { x: [0.5, 0.68], y: [0.1, 1.0], z: [-0.6, 0.3] },
    { x: [-0.45, 0.45], y: [1.0, 1.12], z: [0.5, 0.58] },
  ],
  coleta: [
    { x: [-0.6, 0.6], y: [1.0, 1.16], z: [-0.6, 0.5] },
    { x: [-0.6, 0.6], y: [0.4, 1.0], z: [-0.64, -0.5] },
    { x: [-0.64, -0.5], y: [0.55, 1.0], z: [-0.5, 0.3] },
    { x: [0.5, 0.64], y: [0.55, 1.0], z: [-0.5, 0.3] },
    { x: [-0.1, 0.1], y: [-0.3, 0.55], z: [-0.78, -0.62] },
  ],
  monje: [
    { x: [-0.62, 0.62], y: [0.4, 0.75], z: [-0.66, -0.5] },
    { x: [-0.66, -0.5], y: [0.4, 0.75], z: [-0.55, 0.4] },
    { x: [0.5, 0.66], y: [0.4, 0.75], z: [-0.55, 0.4] },
  ],
  corto_flequillo: [
    caja(-0.58, 0.58, 1.0, 1.16, -0.6, 0.42),
    caja(-0.58, 0.58, 0.4, 1.0, -0.64, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.5, 0.3),
    caja(-0.42, 0.42, 0.96, 1.12, 0.42, 0.58),
  ],
  corto_alborotado: [
    caja(-0.6, 0.6, 1.0, 1.22, -0.6, 0.45),
    caja(-0.3, 0.3, 1.18, 1.32, -0.3, 0.1),
    caja(-0.6, 0.6, 0.35, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.68, 0.5, 1.05, -0.55, 0.35),
  ],
  corto_ondulado: [
    caja(-0.62, 0.62, 1.0, 1.2, -0.62, 0.48),
    caja(-0.62, 0.62, 0.35, 1.0, -0.68, -0.5),
    ...parLateral(0.5, 0.7, 0.5, 1.0, -0.58, 0.4),
    caja(-0.4, 0.4, 1.0, 1.1, 0.48, 0.56),
  ],
  media_melena: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.48),
    caja(-0.62, 0.62, -0.05, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.66, 0.0, 1.0, -0.55, 0.32),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  media_melena_ondulada: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.48),
    caja(-0.66, 0.66, -0.08, 1.0, -0.7, -0.5),
    ...parLateral(0.5, 0.72, -0.05, 1.0, -0.58, 0.35),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  melena_larga: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.48),
    caja(-0.6, 0.6, -0.5, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.64, -0.4, 1.0, -0.55, 0.3),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  melena_rizada: [
    caja(-0.66, 0.66, 1.0, 1.24, -0.66, 0.46),
    caja(-0.7, 0.7, -0.3, 1.0, -0.74, -0.5),
    ...parLateral(0.5, 0.78, -0.2, 1.0, -0.62, 0.4),
    caja(-0.36, 0.36, 1.02, 1.14, 0.46, 0.54),
  ],
  melena_ondulada: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.48),
    caja(-0.64, 0.64, -0.35, 1.0, -0.7, -0.5),
    ...parLateral(0.5, 0.7, -0.25, 1.0, -0.58, 0.35),
    caja(-0.4, 0.4, 1.0, 1.1, 0.48, 0.56),
  ],
  coleta_alta: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.5, 0.3),
    caja(-0.09, 0.09, 0.75, 1.28, -0.84, -0.62),
  ],
  coleta_baja: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.45, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.62, 0.5, 1.0, -0.5, 0.3),
    caja(-0.1, 0.1, -0.35, 0.42, -0.8, -0.6),
  ],
  doble_coleta: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.6, -0.5),
    ...parLateral(0.24, 0.4, -0.15, 0.65, -0.68, -0.5),
  ],
  mono: [
    caja(-0.58, 0.58, 1.0, 1.12, -0.58, 0.46),
    caja(-0.58, 0.58, 0.55, 1.0, -0.6, -0.5),
    ...parLateral(0.5, 0.62, 0.6, 1.0, -0.48, 0.3),
    caja(-0.16, 0.16, 1.05, 1.32, -0.72, -0.46),
  ],
  mono_bajo: [
    caja(-0.58, 0.58, 1.0, 1.12, -0.58, 0.46),
    caja(-0.6, 0.6, 0.2, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.64, 0.25, 1.0, -0.5, 0.3),
    caja(-0.15, 0.15, 0.02, 0.26, -0.74, -0.56),
  ],
  trenza_simple: [
    caja(-0.58, 0.58, 1.0, 1.13, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.6, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.48, 0.3),
    caja(-0.08, 0.08, 0.6, 0.85, -0.74, -0.6),
    caja(-0.07, 0.07, 0.3, 0.6, -0.72, -0.58),
    caja(-0.06, 0.06, -0.15, 0.3, -0.7, -0.58),
  ],
  trenza_doble: [
    caja(-0.58, 0.58, 1.0, 1.13, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.58, -0.5),
    ...parLateral(0.06, 0.16, -0.1, 0.55, -0.66, -0.5),
    ...parLateral(0.06, 0.16, -0.1, 0.55, -0.5, -0.36),
  ],
  trenza_corona: [
    caja(-0.6, 0.6, 0.82, 0.98, -0.6, 0.5),
    caja(-0.6, 0.6, 0.4, 0.82, -0.64, -0.5),
    ...parLateral(0.5, 0.64, 0.4, 0.85, -0.5, 0.3),
    caja(-0.08, 0.08, 0.6, 0.85, -0.72, -0.58),
  ],
  rizado_afro: [
    caja(-0.72, 0.72, 1.0, 1.42, -0.72, 0.36),
    caja(-0.78, 0.78, 0.3, 1.0, -0.78, -0.4),
    ...parLateral(0.5, 0.82, 0.3, 1.0, -0.6, 0.36),
  ],
  ondulado_suelto: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.46),
    caja(-0.64, 0.64, -0.1, 1.0, -0.7, -0.5),
    ...parLateral(0.44, 0.72, -0.05, 1.0, -0.58, 0.36),
    caja(-0.3, 0.5, 1.0, 1.12, 0.4, 0.56),
  ],
  flequillo_lateral: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.46),
    caja(-0.6, 0.6, 0.1, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.64, 0.15, 1.0, -0.55, 0.32),
    caja(-0.45, 0.05, 0.9, 1.15, 0.4, 0.58),
  ],
  mohawk: [
    caja(-0.1, 0.1, 1.0, 1.42, -0.5, 0.46),
    caja(-0.56, 0.56, 1.0, 1.03, -0.56, 0.5),
  ],
  cresta_lateral: [
    caja(-0.05, 0.55, 1.0, 1.2, -0.55, 0.46),
    caja(-0.05, 0.6, 0.6, 1.0, -0.62, -0.5),
    caja(0.42, 0.56, 0.55, 1.0, -0.5, 0.32),
    caja(-0.56, -0.42, 1.0, 1.05, -0.5, 0.32),
  ],
  rapado_lateral: [
    caja(-0.2, 0.55, 1.0, 1.24, -0.55, 0.46),
    caja(-0.56, 0.56, 1.0, 1.05, -0.6, -0.5),
    caja(0.35, 0.5, 0.85, 1.03, -0.4, 0.25),
    caja(-0.5, -0.35, 0.85, 1.03, -0.4, 0.25),
  ],
  recogido_medio: [
    caja(-0.6, 0.6, 1.0, 1.14, -0.6, 0.46),
    caja(-0.62, 0.62, -0.3, 1.0, -0.68, -0.5),
    ...parLateral(0.5, 0.66, -0.2, 1.0, -0.55, 0.3),
    caja(-0.14, 0.14, 1.08, 1.3, -0.68, -0.46),
  ],
  despeinado: [
    caja(-0.64, 0.64, 1.0, 1.24, -0.64, 0.44),
    caja(-0.34, 0.1, 1.2, 1.38, -0.4, -0.05),
    caja(0.05, 0.4, 1.16, 1.34, -0.15, 0.2),
    caja(-0.66, 0.66, -0.25, 1.0, -0.72, -0.5),
    ...parLateral(0.5, 0.74, -0.15, 1.02, -0.6, 0.36),
  ],
};

const CAJAS_BARBA: Record<string, Caja[]> = {
  ninguna: [],
  bigote: [{ x: [-0.24, 0.24], y: [0.26, 0.37], z: [0.5, 0.6] }],
  perilla: [{ x: [-0.16, 0.16], y: [-0.06, 0.26], z: [0.5, 0.62] }],
  completa: [
    { x: [-0.42, 0.42], y: [-0.12, 0.3], z: [0.5, 0.64] },
    { x: [-0.62, -0.5], y: [0.05, 0.5], z: [-0.05, 0.5] },
    { x: [0.5, 0.62], y: [0.05, 0.5], z: [-0.05, 0.5] },
  ],
  bigote_fino: [caja(-0.16, 0.16, 0.29, 0.35, 0.5, 0.58)],
  bigote_grueso: [
    caja(-0.3, 0.3, 0.24, 0.38, 0.5, 0.62),
    ...parLateral(0.26, 0.34, 0.22, 0.3, 0.48, 0.56),
  ],
  perilla_larga: [
    caja(-0.16, 0.16, -0.22, 0.26, 0.5, 0.64),
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
  ],
  candado: [
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
    caja(-0.4, 0.4, -0.1, 0.05, 0.5, 0.62),
    ...parLateral(0.34, 0.44, -0.05, 0.32, 0.4, 0.55),
  ],
  patillas: [...parLateral(0.5, 0.6, -0.05, 0.5, -0.02, 0.42)],
  patillas_bigote: [
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
    ...parLateral(0.5, 0.6, -0.05, 0.5, -0.02, 0.42),
  ],
  barba_corta: [
    caja(-0.38, 0.38, -0.06, 0.28, 0.5, 0.6),
    ...parLateral(0.5, 0.58, 0.1, 0.48, 0.0, 0.44),
  ],
  barba_larga: [
    caja(-0.42, 0.42, -0.4, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, -0.1, 0.5, -0.05, 0.5),
  ],
  barba_trenzada: [
    caja(-0.42, 0.42, -0.15, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, 0.05, 0.5, -0.05, 0.5),
    caja(-0.08, 0.08, -0.55, -0.15, 0.5, 0.6),
  ],
  barba_partida: [
    caja(-0.42, 0.42, 0.05, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, 0.1, 0.5, -0.05, 0.5),
    ...parLateral(0.06, 0.16, -0.4, 0.08, 0.48, 0.6),
  ],
  barba_hacha: [
    caja(-0.34, 0.34, 0.05, 0.3, 0.5, 0.62),
    ...parLateral(0.5, 0.58, 0.15, 0.5, -0.02, 0.44),
    caja(-0.1, 0.1, -0.3, 0.05, 0.5, 0.58),
  ],
};

function ajustarColor(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c: number) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

// Mismo mulberry32 que interiores/src/azar.js — copiado en vez de cruzar un
// require() de Node a un bundle de navegador solo por un jitter cosmético
// de color que ni siquiera necesita coincidir con la versión del servidor
// (la ficha REAL que se persiste la calcula generadorFichaJugador.ts).
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

function voxelizarCajas(cajas: Caja[], ladoCabeza: number, color: string, rnd: () => number): VoxelExportado[] {
  const celda = ladoCabeza / 6;
  const voxeles: VoxelExportado[] = [];
  for (const c of cajas) {
    const [x0, x1] = c.x.map((v) => v * ladoCabeza);
    const [y0, y1] = c.y.map((v) => v * ladoCabeza);
    const [z0, z1] = c.z.map((v) => v * ladoCabeza);
    for (let x = x0 + celda / 2; x < x1; x += celda) {
      for (let y = y0 + celda / 2; y < y1; y += celda) {
        for (let z = z0 + celda / 2; z < z1; z += celda) {
          voxeles.push({ x, y, z, tam: [celda, celda, celda], color: ajustarColor(color, (rnd() - 0.5) * 0.06), pivote: "cabeza" });
        }
      }
    }
  }
  return voxeles;
}

export interface EleccionPersonaje {
  sexo: "hombre" | "mujer";
  peloEstilo: string;
  barbaEstilo: string;
  peloColorId: string;
  pielColorId: string;
  ojosColorId: string;
  altura: number;
  corpulencia: number;
}

/** Solo los colores de peso>0 son elegibles — hueso/ceniciento/piedra (coloresPiel) son variantes reservadas, ver rasgos.json. */
function coloresElegibles(lista: [string, number, string][]): [string, number, string][] {
  const conPeso = lista.filter(([, peso]) => peso > 0);
  return conPeso.length ? conPeso : lista;
}

/** Catálogo listo para poblar los pickers del creador — mismos ids/hex que usa el servidor para validar. */
export const CATALOGO_PERSONAJE = {
  peloEstilos: Object.keys(CAJAS_PELO),
  barbaEstilos: Object.keys(CAJAS_BARBA),
  coloresPelo: rasgos.coloresPelo as [string, number, string][],
  coloresPiel: coloresElegibles(rasgos.coloresPiel as [string, number, string][]),
  coloresOjos: rasgos.coloresOjos as [string, number, string][],
  rangoAltura: { min: 0.88, max: 1.12, defecto: 1.0 },
  rangoCorpulencia: { min: 0.85, max: 1.2, defecto: 1.0 },
};

function colorDe(lista: [string, number, string][], id: string): string {
  const entrada = lista.find(([nombre]) => nombre === id);
  return entrada ? entrada[2] : "#ff00ff";
}

/**
 * Construye `{ficha, voxelesCabeza}` para la vista previa en vivo — misma
 * forma que espera `crearPersonajeVoxel` (con `ropa: []`, que en un jugador
 * siempre es vacía). Nunca lanza: cualquier id fuera de catálogo cae a un
 * valor por defecto seguro, igual que el servidor.
 */
export function construirFichaPreview(eleccion: EleccionPersonaje): { ficha: FichaPersonaje; voxelesCabeza: VoxelExportado[] } {
  const peloEstilo = CAJAS_PELO[eleccion.peloEstilo] ? eleccion.peloEstilo : "corto";
  const barbaEstilo = CAJAS_BARBA[eleccion.barbaEstilo] ? eleccion.barbaEstilo : "ninguna";
  const peloColorHex = colorDe(CATALOGO_PERSONAJE.coloresPelo, eleccion.peloColorId);
  const pielColorHex = colorDe(CATALOGO_PERSONAJE.coloresPiel, eleccion.pielColorId);
  const ojosColorHex = colorDe(CATALOGO_PERSONAJE.coloresOjos, eleccion.ojosColorId);

  const ficha: FichaPersonaje = {
    npcId: "jugador",
    sexo: eleccion.sexo,
    morfologia: {
      sexo: eleccion.sexo,
      altura: Math.max(CATALOGO_PERSONAJE.rangoAltura.min, Math.min(CATALOGO_PERSONAJE.rangoAltura.max, eleccion.altura)),
      corpulencia: Math.max(CATALOGO_PERSONAJE.rangoCorpulencia.min, Math.min(CATALOGO_PERSONAJE.rangoCorpulencia.max, eleccion.corpulencia)),
    },
    rasgos: {
      peloColor: { hex: peloColorHex },
      pielColor: { hex: pielColorHex },
      ojosColor: { hex: ojosColorHex },
    },
  };

  const rnd = crearPRNG(`preview|${eleccion.peloEstilo}|${eleccion.barbaEstilo}`);
  const voxelesCabeza = [
    ...voxelizarCajas(CAJAS_PELO[peloEstilo] || [], proporcionesRig.ladoCabeza, peloColorHex, rnd),
    ...voxelizarCajas(CAJAS_BARBA[barbaEstilo] || [], proporcionesRig.ladoCabeza, peloColorHex, rnd),
  ];

  return { ficha, voxelesCabeza };
}
