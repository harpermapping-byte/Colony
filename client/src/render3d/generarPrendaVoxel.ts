import type { VoxelExportado } from "./voxelMalla";
import { aplicarMorfologia, type Morfologia, type ProporcionesRig } from "./morfologia";

/**
 * PUERTO nativo (TS/ESM) de `ropa/src/generarPrenda.js` — MISMO algoritmo,
 * mantenido en sincronía a mano; mismo límite real de bundling ya
 * documentado en `generarEquipoVoxel.ts` (CommonJS de `ropa/`+`interiores/`
 * vs. Vite/Rollup sin interop de CommonJS para el árbol de fuentes propio).
 * A diferencia de `generarEquipoVoxel.ts` (una caja por slot, para las 48
 * piezas de armadura de `ropa/catalogo/equipo.json`), este puerto genera la
 * malla de vóxeles RICA de `ropa/catalogo/prendas.json` (zonasColor/
 * zonasFijas/voxelResolucion/detalle) — ropa civil craftable
 * (docs/GDD_Profesiones.md, 2026-08-30) usa ESTE renderer, no el de equipo.
 *
 * `aplicarMorfologia` se reusa TAL CUAL de `./morfologia.ts` (ya es el
 * gemelo TS real de `ropa/src/morfologia.js`, no una copia más) — el rig del
 * jugador todavía no manda su propia morfología a `crearRigHumanoide`
 * (game.ts sigue sin ese campo en red), así que hoy siempre se llama con
 * factores neutros; en cuanto exista, esta función ya sabe leerla.
 */

// --- PRNG determinista (mulberry32) — puerto exacto de interiores/src/azar.js:crearPRNG ---
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

// La ropa se genera un pelín más ancha que el cuerpo desnudo para que se
// vea como una capa sobre la piel sin fundirse con ella.
const MARGEN_CAPA = 1.08;

function ajustarColor(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c: number) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  const r = ajustar((n >> 16) & 255);
  const g = ajustar((n >> 8) & 255);
  const b = ajustar(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function variarColor(hex: string, rnd: () => number, amplitud = 0.05): string {
  return ajustarColor(hex, (rnd() - 0.5) * amplitud);
}

export interface PrendaCatalogo {
  slotCuerpo: "torso" | "piernas" | "cabeza";
  tipoPrenda: "camisa" | "pantalon" | "gorro";
  materialesCompatibles: string[];
  zonasColor?: string[];
  zonasFijas?: string[];
  voxelResolucion: { x: number; y: number; z: number };
  detalle: Record<string, unknown>;
}
export interface MaterialPrendaCatalogo {
  colorDebug: string;
}

function resolverColoresPorZona(
  prenda: PrendaCatalogo,
  material: MaterialPrendaCatalogo,
  tintes: Record<string, string> | undefined,
): Record<string, string> {
  const colores: Record<string, string> = {};
  for (const zona of prenda.zonasColor || []) {
    colores[zona] = (tintes && tintes[zona]) || material.colorDebug;
  }
  for (const zona of prenda.zonasFijas || []) {
    colores[zona] = zona === "remiendos" || zona === "cordon"
      ? ajustarColor(material.colorDebug, -0.22)
      : ajustarColor(material.colorDebug, -0.12);
  }
  return colores;
}

interface VoxelInterno {
  x: number; y: number; z: number; tam: [number, number, number]; color: string; zona: string; parte: string;
  pivote?: string;
}

interface FormaResultado { escalaX?: number; escalaZ?: number; zona?: string }
type FormaFn = (t: number, iy: number, ny: number) => FormaResultado | undefined;

function voxelizarParte(
  opts: { w: number; h: number; d: number; resolucion: { x: number; y: number; z: number }; formaFn: FormaFn; zonaBase: string; pivoteX?: number; pivoteYBase?: number },
  colores: Record<string, string>,
  rnd: () => number,
  parteId: string,
): VoxelInterno[] {
  const { w, h, d, resolucion, formaFn, zonaBase, pivoteX = 0, pivoteYBase = 0 } = opts;
  const voxeles: VoxelInterno[] = [];
  const { x: nx, y: ny, z: nz } = resolucion;
  const cw = w / nx;
  void cw;
  const ch = h / ny;
  const cd = d / nz;
  void cd;
  for (let iy = 0; iy < ny; iy++) {
    const t = ny <= 1 ? 0 : iy / (ny - 1);
    const { escalaX = 1, escalaZ = escalaX, zona = zonaBase } = formaFn(t, iy, ny) || {};
    const anchoCapa = w * escalaX;
    const fondoCapa = d * escalaZ;
    const nxCapa = Math.max(1, Math.round(nx * escalaX));
    const nzCapa = Math.max(1, Math.round(nz * escalaZ));
    for (let ix = 0; ix < nxCapa; ix++) {
      for (let iz = 0; iz < nzCapa; iz++) {
        const x = pivoteX - anchoCapa / 2 + (ix + 0.5) * (anchoCapa / nxCapa);
        const z = -fondoCapa / 2 + (iz + 0.5) * (fondoCapa / nzCapa);
        const y = pivoteYBase + iy * ch + ch / 2;
        const colorZona = colores[zona] || colores[zonaBase];
        voxeles.push({ x, y, z, tam: [anchoCapa / nxCapa, ch, fondoCapa / nzCapa], color: variarColor(colorZona, rnd), zona, parte: parteId });
      }
    }
  }
  return voxeles;
}

function formaCamisaCuerpo(detalle: Record<string, unknown>): FormaFn {
  return (t) => {
    if (t > 0.93) return { escalaX: 1, zona: "cuello" };
    if (detalle.bajo === "recto" && t < 0.1) return { escalaX: 1.12, zona: "cuerpo" };
    return { escalaX: 1, zona: "cuerpo" };
  };
}

function formaManga(): FormaFn {
  return (t) => {
    if (t < 0.12) return { escalaX: 0.95, zona: "puños" };
    return { escalaX: 1, zona: "cuerpo" };
  };
}

function formaPierna(detalle: Record<string, unknown>): FormaFn {
  return (t) => {
    if (detalle.cinturon && t > 0.92) return { escalaX: 1.18, zona: "cinturon" };
    let escala = detalle.corte === "holgado" ? 1.0 + 0.15 * t : 1.0;
    if (detalle.bajo === "estrecho" && t < 0.15) escala *= 0.8;
    return { escalaX: escala, zona: "cuerpo" };
  };
}

function formaGorro(detalle: Record<string, unknown>): FormaFn {
  return (t) => {
    if (detalle.borde === "vuelto" && t < 0.14) return { escalaX: 1.2, zona: "cuerpo" };
    return { escalaX: 1.05 - 0.35 * t, zona: "cuerpo" };
  };
}

function aplicarRemiendos(voxeles: VoxelInterno[], colorRemiendo: string, rnd: () => number, cantidad = 4): void {
  if (!voxeles.length) return;
  for (let i = 0; i < cantidad; i++) {
    const idx = Math.floor(rnd() * voxeles.length);
    voxeles[idx] = { ...voxeles[idx], color: colorRemiendo, zona: "remiendos" };
  }
}

function generarCordon(bboxCabeza: { w: number; d: number }, colorCordon: string, parteId: string): VoxelInterno[] {
  const voxeles: VoxelInterno[] = [];
  for (const lado of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      voxeles.push({
        x: lado * bboxCabeza.w * 0.42, y: -0.02 - i * 0.03, z: bboxCabeza.d * 0.3,
        tam: [0.025, 0.03, 0.025], color: colorCordon, zona: "cordon", parte: parteId,
      });
    }
  }
  return voxeles;
}

function generarPrendaTorso(prenda: PrendaCatalogo, colores: Record<string, string>, rnd: () => number, cuerpo: ProporcionesRig): VoxelInterno[] {
  const { torso, brazo, altoTorso } = cuerpo;
  const w = torso.w * MARGEN_CAPA;
  const d = torso.d * MARGEN_CAPA;
  let voxeles = voxelizarParte(
    { w, h: altoTorso, d, resolucion: prenda.voxelResolucion, formaFn: formaCamisaCuerpo(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: 0 },
    colores, rnd, "torso",
  );

  if (prenda.detalle.mangas) {
    const largo = prenda.detalle.mangas === "largas" ? brazo.mangaH * 0.95 : brazo.mangaH * 0.55;
    const resManga = { x: Math.max(2, Math.round(prenda.voxelResolucion.x * 0.55)), y: Math.max(3, Math.round(prenda.voxelResolucion.y * 0.5)), z: Math.max(2, Math.round(prenda.voxelResolucion.z * 0.7)) };
    for (const [lado, parteId] of [[-1, "mangaIzq"], [1, "mangaDer"]] as const) {
      const manga = voxelizarParte(
        { w: brazo.mangaW * MARGEN_CAPA, h: largo, d: brazo.mangaD * MARGEN_CAPA, resolucion: resManga, formaFn: formaManga(), zonaBase: "cuerpo", pivoteX: 0, pivoteYBase: -largo },
        colores, rnd, parteId,
      );
      voxeles = voxeles.concat(manga.map((v) => ({ ...v, pivote: lado < 0 ? "brazoIzq" : "brazoDer" })));
    }
  }
  return voxeles;
}

function generarPrendaPiernas(prenda: PrendaCatalogo, colores: Record<string, string>, rnd: () => number, cuerpo: ProporcionesRig): VoxelInterno[] {
  const { pierna, altoPierna } = cuerpo;
  const w = pierna.w * MARGEN_CAPA;
  const d = pierna.d * MARGEN_CAPA;
  let voxeles: VoxelInterno[] = [];
  for (const [lado, parteId] of [[-1, "piernaIzq"], [1, "piernaDer"]] as const) {
    const pata = voxelizarParte(
      { w, h: altoPierna, d, resolucion: prenda.voxelResolucion, formaFn: formaPierna(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: -altoPierna },
      colores, rnd, parteId,
    );
    voxeles = voxeles.concat(pata.map((v) => ({ ...v, pivote: lado < 0 ? "piernaIzq" : "piernaDer" })));
  }
  if (prenda.zonasFijas?.includes("remiendos")) aplicarRemiendos(voxeles, colores.remiendos, rnd);
  return voxeles;
}

function generarPrendaCabeza(prenda: PrendaCatalogo, colores: Record<string, string>, rnd: () => number, cuerpo: ProporcionesRig): VoxelInterno[] {
  const { ladoCabeza } = cuerpo;
  const bbox = { w: ladoCabeza * 1.18, h: ladoCabeza * 0.75, d: ladoCabeza * 1.18 };
  let voxeles = voxelizarParte(
    { ...bbox, resolucion: prenda.voxelResolucion, formaFn: formaGorro(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: ladoCabeza * 0.55 },
    colores, rnd, "cabeza",
  );
  if (prenda.zonasFijas?.includes("cordon")) voxeles = voxeles.concat(generarCordon(bbox, colores.cordon, "cabeza"));
  return voxeles.map((v) => ({ ...v, pivote: "cabeza" }));
}

const GENERADORES_POR_TIPO: Record<string, (p: PrendaCatalogo, c: Record<string, string>, r: () => number, cuerpo: ProporcionesRig) => VoxelInterno[]> = {
  camisa: generarPrendaTorso,
  pantalon: generarPrendaPiernas,
  gorro: generarPrendaCabeza,
};

/**
 * Puerto de ropa/src/generarPrenda.js:generarPrenda — misma firma/
 * comportamiento, catálogos ya resueltos por quien llama (sin fs, JSON
 * importado por Vite). Sin `tintes`/`detalleOverride` todavía (nadie los
 * pide desde el cliente hoy, mismo alcance mínimo que el resto de esta
 * pasada) — se pueden añadir sin rediseño si hiciera falta.
 */
export function generarPrendaVoxel(
  prenda: PrendaCatalogo,
  material: MaterialPrendaCatalogo,
  opciones: { semilla: string; prendaId: string; materialId: string; morfologia?: Morfologia },
): VoxelExportado[] {
  const generador = GENERADORES_POR_TIPO[prenda.tipoPrenda];
  if (!generador) {
    console.warn(`generarPrendaVoxel: sin generador para tipoPrenda "${prenda.tipoPrenda}"`);
    return [];
  }
  const rnd = crearPRNG(`${opciones.semilla}|${opciones.prendaId}|${opciones.materialId}`);
  const colores = resolverColoresPorZona(prenda, material, undefined);
  const cuerpo = aplicarMorfologia(opciones.morfologia);
  const voxeles = generador(prenda, colores, rnd, cuerpo);
  return voxeles.map((v) => ({
    x: v.x, y: v.y, z: v.z, tam: v.tam, color: v.color,
    pivote: v.pivote || prenda.slotCuerpo,
  }));
}
