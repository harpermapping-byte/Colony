import type { VoxelExportado } from "./voxelMalla";

/**
 * PUERTO nativo (TS/ESM) de `taller-vox/generarEdificioVoxel.js` — MISMO
 * algoritmo (docs/GDD_Ropa_Procedural.md §Ingeniero legendario), usado por
 * el panel de la mesa de planos para la vista previa 3D instantánea.
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

interface Pieza { id: string; x: number; y: number; z: number; tam: [number, number, number]; color: string; }

export interface OpcionesEdificio {
  semilla: string;
  forma: string;
  colorMaterial: string;
  colorTecho: string;
  colorAcento?: string | null;
  balcon?: boolean;
  porche?: boolean;
  ventanasGrandes?: boolean;
}

export function generarEdificioVoxel(opciones: OpcionesEdificio): VoxelExportado[] {
  const rnd = crearPRNG(String(opciones.semilla ?? "edificio"));
  const colorMuro = opciones.colorMaterial || "#8a6a3a";
  const colorTecho = opciones.colorTecho || "#d4b84a";
  const colorPuerta = sombrear(colorMuro, 0.5);

  const ANCHO = 3.6, FONDO = 3.0, ALTO = 2.6;
  const piezas: Pieza[] = [];

  piezas.push({ id: "cuerpo", x: 0, y: ALTO / 2, z: 0, tam: [ANCHO, ALTO, FONDO], color: colorMuro });

  if (opciones.forma === "L") {
    const alaAncho = ANCHO * 0.55, alaFondo = FONDO * 0.6, alaAlto = ALTO * 0.85;
    piezas.push({ id: "ala", x: ANCHO / 2 + alaAncho / 2 - 0.05, y: alaAlto / 2, z: FONDO / 2 - alaFondo / 2, tam: [alaAncho, alaAlto, alaFondo], color: colorMuro });
  } else if (opciones.forma === "alargada") {
    piezas[0] = { ...piezas[0], tam: [ANCHO * 1.6, ALTO * 0.85, FONDO * 0.75] };
  }

  const cuerpo = piezas[0];
  piezas.push({ id: "techo", x: cuerpo.x, y: cuerpo.tam[1] + 0.15, z: cuerpo.z, tam: [cuerpo.tam[0] + 0.3, 0.3, cuerpo.tam[2] + 0.3], color: colorTecho });
  piezas.push({ id: "puerta", x: 0, y: 0.55, z: FONDO / 2 + 0.01, tam: [0.5, 1.1, 0.02], color: colorPuerta });

  const colorVentana = opciones.colorAcento || "#bcdff0";
  const nVentanas = opciones.ventanasGrandes ? 4 : 2;
  const tamVentana = opciones.ventanasGrandes ? 0.55 : 0.4;
  for (let i = 0; i < nVentanas; i++) {
    const x = (i % 2 === 0 ? -1 : 1) * (ANCHO * 0.28);
    const y = ALTO * (i < 2 ? 0.62 : 0.35);
    piezas.push({ id: "ventana", x, y, z: FONDO / 2 + 0.01, tam: [tamVentana, tamVentana, 0.02], color: colorVentana });
  }

  if (opciones.balcon) {
    piezas.push({ id: "balcon", x: 0, y: ALTO * 0.62, z: FONDO / 2 + 0.35, tam: [ANCHO * 0.6, 0.08, 0.7], color: sombrear(colorMuro, 1.1) });
    piezas.push({ id: "barandilla", x: 0, y: ALTO * 0.62 + 0.35, z: FONDO / 2 + 0.68, tam: [ANCHO * 0.6, 0.6, 0.04], color: "#3a3733" });
  }

  if (opciones.porche) {
    piezas.push({ id: "porche_techo", x: 0, y: 1.9, z: FONDO / 2 + 0.55, tam: [1.4, 0.08, 1.1], color: colorTecho });
    piezas.push({ id: "porche_pilar", x: -0.6, y: 0.95, z: FONDO / 2 + 1.0, tam: [0.08, 1.9, 0.08], color: sombrear(colorMuro, 0.8) });
    piezas.push({ id: "porche_pilar", x: 0.6, y: 0.95, z: FONDO / 2 + 1.0, tam: [0.08, 1.9, 0.08], color: sombrear(colorMuro, 0.8) });
  }

  for (const p of piezas) {
    if (p.id === "cuerpo" || p.id === "ala") {
      const factor = 0.96 + rnd() * 0.08;
      p.color = sombrear(p.color, factor);
    }
  }

  return piezas.map((p) => ({ x: p.x, y: p.y, z: p.z, tam: p.tam, color: p.color }));
}
