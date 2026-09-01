"use strict";

// Genera los vóxeles (formato VoxelExportado del cliente) de un edificio
// legendario del ingeniero a partir de los parámetros que ya resolvió
// interpretarPromptEdificio.js. Mismo criterio que generarMuebleVoxel.js:
// geometría propia y barata (cajas simples: cuerpo/techo/ventanas/puerta/
// balcón/porche), NO el pipeline offline de taller-vox/generar_edificio.js
// (ese exige aprobación humana antes de subir a assets/ — aquí no hay
// aprobación posible, cada ingeniero genera la suya). Determinista por
// semilla (interiores/src/azar.js). Puerto TS gemelo:
// client/src/render3d/generarEdificioVoxel.ts.

const { crearPRNG } = require("../interiores/src/azar.js");

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = ajustar((n >> 16) & 255), g = ajustar((n >> 8) & 255), b = ajustar(n & 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * `opciones`: { semilla, forma, colorMaterial, colorTecho, colorAcento,
 * balcon, porche, ventanasGrandes } — MISMOS campos que devuelve
 * `interpretarPromptEdificio`. Devuelve VoxelExportado[], edificio centrado
 * en (0,0,0), suelo en y=0, en metros (ANCHO/FONDO/ALTO ~4-5m, escala de
 * referencia — no las medidas reales de huellaExterior del catálogo, esto
 * es solo la vista previa del panel).
 */
function generarEdificioVoxel(opciones) {
  const rnd = crearPRNG(String(opciones.semilla ?? "edificio"));
  const colorMuro = opciones.colorMaterial || "#8a6a3a";
  const colorTecho = opciones.colorTecho || "#d4b84a";
  const colorPuerta = sombrear(colorMuro, 0.5);

  const ANCHO = 3.6, FONDO = 3.0, ALTO = 2.6;
  const piezas = [];

  // Cuerpo principal.
  piezas.push({ id: "cuerpo", x: 0, y: ALTO / 2, z: 0, tam: [ANCHO, ALTO, FONDO], color: colorMuro });

  // Ala en L (pedido "en forma de L") — un segundo volumen más pequeño
  // pegado a una esquina, mismo espíritu que el módulo "ala" real del
  // bakeador offline (taller-vox/generar_edificio.js).
  if (opciones.forma === "L") {
    const alaAncho = ANCHO * 0.55, alaFondo = FONDO * 0.6, alaAlto = ALTO * 0.85;
    piezas.push({ id: "ala", x: ANCHO / 2 + alaAncho / 2 - 0.05, y: alaAlto / 2, z: FONDO / 2 - alaFondo / 2, tam: [alaAncho, alaAlto, alaFondo], color: colorMuro });
  } else if (opciones.forma === "alargada") {
    piezas[0] = { ...piezas[0], tam: [ANCHO * 1.6, ALTO * 0.85, FONDO * 0.75] };
  }

  const cuerpo = piezas[0];

  // Techo a dos aguas simplificado: dos cajas inclinadas simuladas como una
  // caja ligeramente más ancha que el cuerpo (representación estilizada,
  // no geometría de tejado real — coherente con el resto de vóxeles "cajas").
  piezas.push({ id: "techo", x: cuerpo.x, y: cuerpo.tam[1] + 0.15, z: cuerpo.z, tam: [cuerpo.tam[0] + 0.3, 0.3, cuerpo.tam[2] + 0.3], color: colorTecho });

  // Puerta centrada en la fachada frontal (z+).
  piezas.push({ id: "puerta", x: 0, y: 0.55, z: FONDO / 2 + 0.01, tam: [0.5, 1.1, 0.02], color: colorPuerta });

  // Ventanas: 2 por defecto, 4 si "ventanas grandes" (más grandes y más
  // numerosas), color de acento si el texto lo pidió, si no un cristal genérico.
  const colorVentana = opciones.colorAcento || "#bcdff0";
  const nVentanas = opciones.ventanasGrandes ? 4 : 2;
  const tamVentana = opciones.ventanasGrandes ? 0.55 : 0.4;
  for (let i = 0; i < nVentanas; i++) {
    const x = ((i % 2 === 0) ? -1 : 1) * (ANCHO * 0.28);
    const y = ALTO * (i < 2 ? 0.62 : 0.35);
    piezas.push({ id: "ventana", x, y, z: FONDO / 2 + 0.01, tam: [tamVentana, tamVentana, 0.02], color: colorVentana });
  }

  // Balcón: ledge sobre la fachada frontal, a media altura.
  if (opciones.balcon) {
    piezas.push({ id: "balcon", x: 0, y: ALTO * 0.62, z: FONDO / 2 + 0.35, tam: [ANCHO * 0.6, 0.08, 0.7], color: sombrear(colorMuro, 1.1) });
    piezas.push({ id: "barandilla", x: 0, y: ALTO * 0.62 + 0.35, z: FONDO / 2 + 0.68, tam: [ANCHO * 0.6, 0.6, 0.04], color: "#3a3733" });
  }

  // Porche: techo pequeño + suelo a la entrada.
  if (opciones.porche) {
    piezas.push({ id: "porche_techo", x: 0, y: 1.9, z: FONDO / 2 + 0.55, tam: [1.4, 0.08, 1.1], color: colorTecho });
    piezas.push({ id: "porche_pilar", x: -0.6, y: 0.95, z: FONDO / 2 + 1.0, tam: [0.08, 1.9, 0.08], color: sombrear(colorMuro, 0.8) });
    piezas.push({ id: "porche_pilar", x: 0.6, y: 0.95, z: FONDO / 2 + 1.0, tam: [0.08, 1.9, 0.08], color: sombrear(colorMuro, 0.8) });
  }

  // Variación natural leve de tono por pieza de muro (mismo criterio que
  // "variarColor" de la ropa) — nunca sobre techo/ventanas/puerta, solo el material del cuerpo.
  for (const p of piezas) {
    if (p.id === "cuerpo" || p.id === "ala") {
      const factor = 0.96 + rnd() * 0.08;
      p.color = sombrear(p.color, factor);
    }
  }

  return piezas.map((p) => ({ x: p.x, y: p.y, z: p.z, tam: p.tam, color: p.color }));
}

module.exports = { generarEdificioVoxel };
