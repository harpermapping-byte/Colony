import type { VoxelExportado } from "./voxelMalla";

/**
 * PUERTO nativo (TS/ESM) de `ropa/src/generarEquipo.js` — MISMO algoritmo,
 * MISMA tabla `POSICION_POR_SLOT`, mantenida en sincronía a mano. No es una
 * decisión de diseño, es un límite real de bundling: `generarEquipo.js`
 * (y su dependencia `interiores/src/azar.js`) son CommonJS consumidos por
 * TODO el resto del proyecto (`ropa/`, `interiores/`, `poblacion/`,
 * `ciudades/`, `server/` vía tsx/ts-node) vía `require()` — convertirlos a
 * ESM rompería docenas de consumidores Node. Vite/Rollup, en cambio, solo
 * interopera CommonJS de verdad dentro de `node_modules` (su config no
 * trae `@rollup/plugin-commonjs` para el árbol de fuentes propio) — cruzar
 * el límite Node -> navegador para ESTA pieza necesita, pues, una versión
 * nativa. Si `ropa/src/generarEquipo.js` cambia, replicar el cambio aquí
 * (docs/GDD_Equipo.md lo documenta como deuda conocida y acotada — la
 * tabla de posiciones es un hecho estructural del rig, cambia poquísimo).
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

function ajustarColor(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c: number) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  const r = ajustar((n >> 16) & 255);
  const g = ajustar((n >> 8) & 255);
  const b = ajustar(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function variarColor(hex: string, rnd: () => number, amplitud = 0.06): string {
  return ajustarColor(hex, (rnd() - 0.5) * amplitud);
}

interface PosicionSlot {
  pivotes: string[];
  ambosLados?: boolean;
  caja: { w: number; h: number; d: number };
  offset: { x: number; y: number; z: number };
}

// Copia exacta de ropa/src/generarEquipo.js:POSICION_POR_SLOT.
const POSICION_POR_SLOT: Record<string, PosicionSlot> = {
  casco: { pivotes: ["cabeza"], caja: { w: 0.36, h: 0.14, d: 0.36 }, offset: { x: 0, y: 0.62, z: 0 } },
  mascara: { pivotes: ["cabeza"], caja: { w: 0.3, h: 0.16, d: 0.06 }, offset: { x: 0, y: 0.2, z: 0.16 } },
  gafas: { pivotes: ["cabeza"], caja: { w: 0.26, h: 0.05, d: 0.03 }, offset: { x: 0, y: 0.19, z: 0.17 } },
  pechera: { pivotes: ["torso"], caja: { w: 0.5, h: 0.5, d: 0.28 }, offset: { x: 0, y: 0.28, z: 0 } },
  brazos: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.16, h: 0.3, d: 0.2 }, offset: { x: 0, y: -0.2, z: 0 } },
  manos: { pivotes: ["manoDer"], ambosLados: true, caja: { w: 0.15, h: 0.18, d: 0.18 }, offset: { x: 0, y: -0.02, z: 0 } },
  piernas: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.19, h: 0.68, d: 0.23 }, offset: { x: 0, y: -0.34, z: 0 } },
  zapatos: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.19, h: 0.12, d: 0.26 }, offset: { x: 0, y: -0.68, z: 0.02 } },
  hombreras: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.24, h: 0.16, d: 0.24 }, offset: { x: 0, y: -0.02, z: 0 } },
  rodilleras: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.21, h: 0.12, d: 0.14 }, offset: { x: 0, y: -0.36, z: 0.1 } },
  coderas: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.16, h: 0.11, d: 0.16 }, offset: { x: 0, y: -0.22, z: 0 } },
  anilloIzquierdo: { pivotes: ["manoIzq"], caja: { w: 0.03, h: 0.03, d: 0.13 }, offset: { x: 0, y: -0.03, z: 0.05 } },
  anilloDerecho: { pivotes: ["manoDer"], caja: { w: 0.03, h: 0.03, d: 0.13 }, offset: { x: 0, y: -0.03, z: 0.05 } },
  brazalete: { pivotes: ["manoDer"], ambosLados: true, caja: { w: 0.15, h: 0.04, d: 0.15 }, offset: { x: 0, y: 0.03, z: 0 } },
  espalda: { pivotes: ["torso"], caja: { w: 0.34, h: 0.4, d: 0.16 }, offset: { x: 0, y: 0.2, z: -0.2 } },
  // Capa/manto — copia exacta de ropa/src/generarEquipo.js, ver su comentario.
  capa: { pivotes: ["torso"], caja: { w: 0.42, h: 0.62, d: 0.1 }, offset: { x: 0, y: 0.02, z: -0.22 } },
  cinturon: { pivotes: ["torso"], caja: { w: 0.14, h: 0.12, d: 0.1 }, offset: { x: 0.22, y: -0.02, z: 0.02 } },
  bandolera: { pivotes: ["torso"], caja: { w: 0.12, h: 0.42, d: 0.08 }, offset: { x: 0.16, y: 0, z: 0.14 } },
  manoPrincipal: { pivotes: ["manoDer"], caja: { w: 0.06, h: 0.3, d: 0.06 }, offset: { x: 0, y: -0.18, z: 0.06 } },
  manoSecundaria: { pivotes: ["manoIzq"], caja: { w: 0.06, h: 0.3, d: 0.06 }, offset: { x: 0, y: -0.18, z: 0.06 } },
};

const PIVOTE_ESPEJO: Record<string, string> = { brazoDer: "brazoIzq", piernaDer: "piernaIzq", manoDer: "manoIzq" };

export interface PiezaEquipoCatalogo {
  slotEquipo: string;
  materialesCompatibles: string[];
  tamano?: number;
}

export interface MaterialCatalogo {
  colorDebug: string;
}

/** Puerto de ropa/src/generarEquipo.js:generarPieza — misma firma/comportamiento, catálogos ya resueltos por quien llama (sin fs, JSON importado por Vite). */
export function generarPiezaVoxel(
  pieza: PiezaEquipoCatalogo,
  material: MaterialCatalogo,
  opciones: { semilla: string; piezaId: string; materialId: string; slotFisico?: string },
): VoxelExportado[] {
  const posicion = POSICION_POR_SLOT[opciones.slotFisico || pieza.slotEquipo];
  if (!posicion) {
    console.warn(`generarEquipoVoxel: sin geometría para slot "${opciones.slotFisico || pieza.slotEquipo}"`);
    return [];
  }

  const rnd = crearPRNG(`${opciones.semilla}|${opciones.piezaId}|${opciones.materialId}`);
  const colorBase = ajustarColor(material.colorDebug, (rnd() - 0.5) * 0.1);
  const escala = pieza.tamano ?? 1;

  const voxeles: VoxelExportado[] = [];
  for (const pivoteBase of posicion.pivotes) {
    const lados = posicion.ambosLados ? [pivoteBase, PIVOTE_ESPEJO[pivoteBase]] : [pivoteBase];
    for (const pivote of lados) {
      const signoX = pivote === PIVOTE_ESPEJO[pivoteBase] ? -1 : 1;
      voxeles.push({
        x: posicion.offset.x * escala * signoX,
        y: posicion.offset.y,
        z: posicion.offset.z,
        tam: [posicion.caja.w * escala, posicion.caja.h * escala, posicion.caja.d * escala],
        color: variarColor(colorBase, rnd),
        pivote,
      });
    }
  }
  return voxeles;
}
