"use strict";

// Genera los vóxeles (formato VoxelExportado del cliente: {x,y,z centro,
// tam,color}) de un mueble legendario del carpintero a partir de los
// parámetros que ya resolvió interpretarPromptMueble.js. Geometría simple
// (4-8 cajas por arquetipo) a propósito — no es el pipeline offline de
// taller-vox/generar_modelos.js (ese bakea los 560 muebles ESTÁTICOS del
// juego a .glb, aprobados a mano antes de subir; esto genera en vivo, sin
// aprobación humana posible por diseño, así que tiene que ser código propio
// y barato). Reutiliza el MISMO PRNG determinista que el resto del proyecto
// (interiores/src/azar.js) — misma semilla, mismo mueble siempre.
//
// Puerto TS gemelo: client/src/render3d/generarMuebleVoxel.ts (MISMO
// algoritmo, mantenido en sincronía a mano — mismo límite real de bundling
// CommonJS/Vite que ya documentan generarPrendaVoxel.ts y el resto de
// puertos de ropa/personajes).

const { crearPRNG } = require("../interiores/src/azar.js");

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = ajustar((n >> 16) & 255), g = ajustar((n >> 8) & 255), b = ajustar(n & 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Geometría base por tipoMueble, en metros, centrada en (0, 0, 0) sobre el
 * suelo (y=0 = suelo). Proporciones de referencia genéricas medievales, no
 * de ningún mueble concreto del catálogo estático.
 */
function cajasBase(tipoMueble) {
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

/**
 * `opciones`: { semilla, tipoMueble, colorMadera, colorAcento, tallado,
 * desgaste, roto, tapizado, incrustado, herraje } — MISMOS campos que
 * devuelve `interpretarPromptMueble`. Devuelve VoxelExportado[].
 */
function generarMuebleVoxel(opciones) {
  const rnd = crearPRNG(String(opciones.semilla ?? "mueble"));
  const base = cajasBase(opciones.tipoMueble);
  const colorMadera = opciones.colorMadera || "#5a3d20";

  let piezas = base.map((c) => ({ ...c, color: colorMadera }));

  // Desgaste: oscurece al azar ~1 de cada 3 piezas (mismo criterio que
  // aplicarDesgaste en generar_modelos.js, adaptado a piezas con nombre).
  if (opciones.desgaste) {
    piezas = piezas.map((p) => (rnd() < 0.4 ? { ...p, color: sombrear(p.color, 0.8 + rnd() * 0.12) } : p));
  }

  // Roto: la pata/pieza más pequeña se astilla (se encoge, deja hueco real
  // en vez de solo oscurecer) — nunca la pieza principal, eso desmontaría el mueble.
  if (opciones.roto) {
    let iMenor = -1, volMenor = Infinity;
    piezas.forEach((p, i) => {
      const vol = p.tam[0] * p.tam[1] * p.tam[2];
      if (vol < volMenor) { volMenor = vol; iMenor = i; }
    });
    if (iMenor >= 0) {
      const p = piezas[iMenor];
      piezas[iMenor] = { ...p, tam: [p.tam[0] * 0.5, p.tam[1] * 0.55, p.tam[2] * 0.5], color: sombrear(p.color, 0.7) };
    }
  }

  // Tallado: ranuras oscuras verticales en la pieza más ancha y plana
  // (tablero/respaldo/tapa) — mismo espíritu que aplicarTallado, adaptado a coordenadas en metros.
  if (opciones.tallado) {
    let candidata = null;
    for (const p of piezas) if (!candidata || p.tam[0] * p.tam[2] > candidata.tam[0] * candidata.tam[2]) candidata = p;
    if (candidata) {
      const oscuro = sombrear(candidata.color, 0.55);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const offset = (i - (n - 1) / 2) * (candidata.tam[0] / (n + 1));
        piezas.push({ id: "talla", x: candidata.x + offset, y: candidata.y, z: candidata.z + candidata.tam[2] / 2 + 0.005, tam: [0.02, candidata.tam[1] * 0.7, 0.01], color: oscuro });
      }
    }
  }

  // Tapizado: franja de color de acento sobre la superficie de asiento/colchón.
  if (opciones.tapizado && opciones.colorAcento) {
    const objetivo = piezas.find((p) => p.id === "asiento" || p.id === "colchon");
    if (objetivo) {
      piezas.push({ id: "tapiz", x: objetivo.x, y: objetivo.y + objetivo.tam[1] / 2 + 0.006, z: objetivo.z, tam: [objetivo.tam[0] * 0.85, 0.01, objetivo.tam[2] * 0.85], color: opciones.colorAcento });
    }
  }

  // Incrustación: acento puntual (gema/oro) en la pieza más alta.
  if (opciones.incrustado && opciones.colorAcento) {
    let candidata = null;
    for (const p of piezas) if (!candidata || p.y > candidata.y) candidata = p;
    if (candidata) {
      piezas.push({ id: "gema", x: candidata.x, y: candidata.y + candidata.tam[1] / 2 - 0.02, z: candidata.z + candidata.tam[2] / 2 + 0.005, tam: [0.04, 0.04, 0.01], color: opciones.colorAcento });
    }
  }

  // Herraje: ribete metálico fino en la pieza principal (arcón/cuerpo/tablero).
  if (opciones.herraje) {
    const metal = "#3a3733";
    const objetivo = piezas.find((p) => p.id === "cuerpo" || p.id === "tablero" || p.id === "base") || piezas[0];
    piezas.push({ id: "herraje", x: objetivo.x, y: objetivo.y - objetivo.tam[1] / 2 + 0.01, z: objetivo.z, tam: [objetivo.tam[0] * 0.98, 0.015, objetivo.tam[2] * 0.98], color: metal });
  }

  return piezas.map((p) => ({ x: p.x, y: p.y, z: p.z, tam: p.tam, color: p.color }));
}

module.exports = { generarMuebleVoxel, cajasBase };
