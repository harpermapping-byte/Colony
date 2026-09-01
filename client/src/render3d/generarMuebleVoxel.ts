import type { VoxelExportado } from "./voxelMalla";

/**
 * PUERTO nativo (TS/ESM) de `taller-vox/generarMuebleVoxel.js` — MISMO
 * algoritmo, mantenido en sincronía a mano (mismo criterio que
 * `generarPrendaVoxel.ts`). Usado por el panel del banco de carpintero para
 * la vista previa 3D instantánea (docs/GDD_Ropa_Procedural.md §Carpintero legendario).
 */

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

function sombrear(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = ajustar((n >> 16) & 255), g = ajustar((n >> 8) & 255), b = ajustar(n & 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

interface Pieza { id: string; x: number; y: number; z: number; tam: [number, number, number]; color?: string; }

function cajasBase(tipoMueble: string): Pieza[] {
  switch (tipoMueble) {
    case "mesa":
      return [
        { id: "tablero", x: 0, y: 0.72, z: 0, tam: [0.9, 0.06, 0.6] },
        { id: "pata", x: -0.4, y: 0.36, z: -0.25, tam: [0.06, 0.72, 0.06] },
        { id: "pata", x: 0.4, y: 0.36, z: -0.25, tam: [0.06, 0.72, 0.06] },
        { id: "pata", x: -0.4, y: 0.36, z: 0.25, tam: [0.06, 0.72, 0.06] },
        { id: "pata", x: 0.4, y: 0.36, z: 0.25, tam: [0.06, 0.72, 0.06] },
      ];
    case "cama":
      return [
        { id: "base", x: 0, y: 0.22, z: 0, tam: [1.0, 0.3, 2.0] },
        { id: "colchon", x: 0, y: 0.42, z: 0, tam: [0.94, 0.14, 1.94] },
        { id: "cabecero", x: 0, y: 0.55, z: -0.97, tam: [1.0, 0.7, 0.06] },
      ];
    case "arcon":
      return [
        { id: "cuerpo", x: 0, y: 0.22, z: 0, tam: [0.7, 0.44, 0.4] },
        { id: "tapa", x: 0, y: 0.47, z: 0, tam: [0.72, 0.06, 0.42] },
      ];
    case "silla":
    default:
      return [
        { id: "asiento", x: 0, y: 0.45, z: 0, tam: [0.45, 0.05, 0.45] },
        { id: "respaldo", x: 0, y: 0.75, z: -0.2, tam: [0.45, 0.55, 0.05] },
        { id: "pata", x: -0.18, y: 0.225, z: -0.18, tam: [0.05, 0.45, 0.05] },
        { id: "pata", x: 0.18, y: 0.225, z: -0.18, tam: [0.05, 0.45, 0.05] },
        { id: "pata", x: -0.18, y: 0.225, z: 0.18, tam: [0.05, 0.45, 0.05] },
        { id: "pata", x: 0.18, y: 0.225, z: 0.18, tam: [0.05, 0.45, 0.05] },
      ];
  }
}

export interface OpcionesMueble {
  semilla: string;
  tipoMueble: string;
  colorMadera: string;
  colorAcento?: string | null;
  tallado?: boolean;
  desgaste?: boolean;
  roto?: boolean;
  tapizado?: boolean;
  incrustado?: boolean;
  herraje?: boolean;
}

export function generarMuebleVoxel(opciones: OpcionesMueble): VoxelExportado[] {
  const rnd = crearPRNG(String(opciones.semilla ?? "mueble"));
  const base = cajasBase(opciones.tipoMueble);
  const colorMadera = opciones.colorMadera || "#5a3d20";

  let piezas: Pieza[] = base.map((c) => ({ ...c, color: colorMadera }));

  if (opciones.desgaste) {
    piezas = piezas.map((p) => (rnd() < 0.4 ? { ...p, color: sombrear(p.color!, 0.8 + rnd() * 0.12) } : p));
  }

  if (opciones.roto) {
    let iMenor = -1, volMenor = Infinity;
    piezas.forEach((p, i) => {
      const vol = p.tam[0] * p.tam[1] * p.tam[2];
      if (vol < volMenor) { volMenor = vol; iMenor = i; }
    });
    if (iMenor >= 0) {
      const p = piezas[iMenor];
      piezas[iMenor] = { ...p, tam: [p.tam[0] * 0.5, p.tam[1] * 0.55, p.tam[2] * 0.5], color: sombrear(p.color!, 0.7) };
    }
  }

  if (opciones.tallado) {
    let candidata: Pieza | null = null;
    for (const p of piezas) if (!candidata || p.tam[0] * p.tam[2] > candidata.tam[0] * candidata.tam[2]) candidata = p;
    if (candidata) {
      const oscuro = sombrear(candidata.color!, 0.55);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const offset = (i - (n - 1) / 2) * (candidata.tam[0] / (n + 1));
        piezas.push({ id: "talla", x: candidata.x + offset, y: candidata.y, z: candidata.z + candidata.tam[2] / 2 + 0.005, tam: [0.02, candidata.tam[1] * 0.7, 0.01], color: oscuro });
      }
    }
  }

  if (opciones.tapizado && opciones.colorAcento) {
    const objetivo = piezas.find((p) => p.id === "asiento" || p.id === "colchon");
    if (objetivo) {
      piezas.push({ id: "tapiz", x: objetivo.x, y: objetivo.y + objetivo.tam[1] / 2 + 0.006, z: objetivo.z, tam: [objetivo.tam[0] * 0.85, 0.01, objetivo.tam[2] * 0.85], color: opciones.colorAcento });
    }
  }

  if (opciones.incrustado && opciones.colorAcento) {
    let candidata: Pieza | null = null;
    for (const p of piezas) if (!candidata || p.y > candidata.y) candidata = p;
    if (candidata) {
      piezas.push({ id: "gema", x: candidata.x, y: candidata.y + candidata.tam[1] / 2 - 0.02, z: candidata.z + candidata.tam[2] / 2 + 0.005, tam: [0.04, 0.04, 0.01], color: opciones.colorAcento });
    }
  }

  if (opciones.herraje) {
    const metal = "#3a3733";
    const objetivo = piezas.find((p) => p.id === "cuerpo" || p.id === "tablero" || p.id === "base") || piezas[0];
    piezas.push({ id: "herraje", x: objetivo.x, y: objetivo.y - objetivo.tam[1] / 2 + 0.01, z: objetivo.z, tam: [objetivo.tam[0] * 0.98, 0.015, objetivo.tam[2] * 0.98], color: metal });
  }

  return piezas.map((p) => ({ x: p.x, y: p.y, z: p.z, tam: p.tam, color: p.color! }));
}
