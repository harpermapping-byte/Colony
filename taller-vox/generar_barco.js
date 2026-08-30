"use strict";
// Generador de BARCOS del taller de vóxeles (docs/GDD_Barcos.md, pedido
// 2026-08-30). Lee DIRECTAMENTE items/catalogo/items.json filtrado a
// esBarco:true (barco_1..4) — su huella/plazas ya son la fuente de verdad
// (server/src/mundo/catalogoBarcos.ts las usa igual), cero catálogo nuevo.
// Mismo formato de salida {grid, paleta, cajas} que generar_modelos.js/
// generar_naturaleza.js (U=10 subdivisiones por casilla) — exportar_glb.js
// los convierte a .glb.
//
// Casco tallado a proa (más estrecho hacia +z), borda elevada, cubierta,
// 1 mástil+vela hasta 2 plazas, 2 mástiles+vela a partir de 3 (docs/GDD_
// Barcos.md: "crecen en tamaño... añadiendo alguna vela más"), remos a los
// lados (uno por plaza). Determinista por el propio catálogo (sin PRNG:
// solo hay UNA variante por talla, a diferencia de naturaleza/muebles).
//
//   node generar_barco.js   # genera barcos_generados.json
//
// SIN exportar_lote.js: a diferencia de edificios/muebles (decisión propia
// del streamer, ver exportar_lote.js), esto NO tiene autorización explícita
// para saltarse el flujo de aprobación pieza a pieza de CLAUDE.md — generar
// el .glb real y subirlo a assets/barcos/ queda pendiente de que el
// streamer lo revise en el visor.

const fs = require("fs");
const path = require("path");
const items = require("../items/catalogo/items.json");

const U = 10;
const MADERA = "#5a3a20";
const MADERA_OSCURA = "#3f2a17";
const VELA = "#e8ddc0";
const METAL = "#4a4a4a";

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function Builder() {
  const paleta = [];
  const cajas = [];
  function color(hex) {
    let i = paleta.indexOf(hex);
    if (i === -1) { i = paleta.length; paleta.push(hex); }
    return i;
  }
  function caja(x0, y0, z0, x1, y1, z1, hex) {
    if (x1 < x0 || y1 < y0 || z1 < z0) return;
    cajas.push([Math.round(x0), Math.round(y0), Math.round(z0), Math.round(x1), Math.round(y1), Math.round(z1), color(hex)]);
  }
  return { caja, color, paleta, cajas };
}

/** huella=[ancho,largo] en casillas (items.json) -> grid en subdivisiones, con margen para el casco tallado. */
function generarBarco(huella, plazas) {
  const [hx, hz] = huella;
  const gx = Math.round(hx * U);
  const gz = Math.round(hz * U);
  const altoCasco = Math.round(U * 0.9);
  const gy = altoCasco + Math.round(U * (plazas >= 3 ? 3.6 : 3.0)); // sitio de sobra para mástil+vela
  const b = Builder();

  // Casco: capas horizontales que se ESTRECHAN hacia proa (z alto) y popa (z
  // bajo) — tabla de estrechamiento simple (más ancho en el centro).
  for (let y = 0; y < altoCasco; y++) {
    const frac = y / altoCasco; // 0 quilla, 1 borda
    const anchoY = Math.round(gx * (0.35 + 0.65 * frac)); // la quilla es bastante más estrecha que la cubierta
    const x0 = Math.round((gx - anchoY) / 2);
    const x1 = x0 + anchoY - 1;
    for (let z = 0; z < gz; z++) {
      // estrechamiento hacia proa/popa: el 22% final de cada punta se afina
      const distPunta = Math.min(z, gz - 1 - z) / gz;
      const factorPunta = distPunta < 0.22 ? 0.35 + (distPunta / 0.22) * 0.65 : 1;
      const anchoZ = Math.max(2, Math.round(anchoY * factorPunta));
      const cx0 = Math.round((gx - anchoZ) / 2);
      b.caja(cx0, y, z, cx0 + anchoZ - 1, y, z, y < altoCasco * 0.3 ? MADERA_OSCURA : MADERA);
    }
  }
  // Borda (gunwale) — reborde elevado en el perímetro de la cubierta, para
  // que no se lea como una balsa plana.
  const yCubierta = altoCasco;
  const bordaH = Math.max(2, Math.round(U * 0.18));
  b.caja(0, yCubierta, 0, gx - 1, yCubierta + bordaH - 1, Math.round(U * 0.15), MADERA_OSCURA);
  b.caja(0, yCubierta, gz - Math.round(U * 0.15) - 1, gx - 1, yCubierta + bordaH - 1, gz - 1, MADERA_OSCURA);
  b.caja(0, yCubierta, 0, Math.round(U * 0.12), yCubierta + bordaH - 1, gz - 1, MADERA_OSCURA);
  b.caja(gx - Math.round(U * 0.12) - 1, yCubierta, 0, gx - 1, yCubierta + bordaH - 1, gz - 1, MADERA_OSCURA);
  // Cubierta (tapa el interior del casco)
  b.caja(Math.round(U * 0.12), yCubierta, Math.round(U * 0.15), gx - Math.round(U * 0.12) - 1, yCubierta, gz - Math.round(U * 0.15) - 1, sombrear(MADERA, 1.15));

  // Mástil(es) + vela — 1 hasta 2 plazas, 2 a partir de 3 (docs/GDD_Barcos.md).
  const nMastiles = plazas >= 3 ? 2 : 1;
  const mastilW = Math.max(2, Math.round(U * 0.14));
  const mastilAltoY = gy - 1;
  const velaAncho = Math.round(gx * 0.5);
  const velaAlto = Math.round((mastilAltoY - yCubierta) * 0.55);
  for (let m = 0; m < nMastiles; m++) {
    const cz = nMastiles === 1 ? Math.round(gz / 2) : Math.round(gz * (0.32 + m * 0.36));
    const cx = Math.round(gx / 2);
    b.caja(cx - mastilW / 2, yCubierta + bordaH, cz - mastilW / 2, cx + mastilW / 2, mastilAltoY, cz + mastilW / 2, MADERA_OSCURA);
    // vela: panel plano colgado a un lado del mástil
    const velaY0 = yCubierta + bordaH + Math.round(U * 0.4);
    b.caja(cx - velaAncho / 2, velaY0, cz - 1, cx + velaAncho / 2, velaY0 + velaAlto, cz, VELA);
  }

  // Remos: un nudo a cada lado por plaza, a lo largo del casco.
  const remoW = Math.max(1, Math.round(U * 0.08));
  const remoLargo = Math.round(U * 0.5);
  for (let p = 0; p < plazas; p++) {
    const cz = Math.round(gz * (0.25 + (p / Math.max(1, plazas - 1 || 1)) * 0.5));
    const cy = yCubierta + Math.round(bordaH / 2);
    b.caja(-remoLargo, cy, cz - remoW / 2, -1, cy + remoW - 1, cz + remoW / 2, METAL);
    b.caja(gx, cy, cz - remoW / 2, gx + remoLargo - 1, cy + remoW - 1, cz + remoW / 2, METAL);
  }

  return { grid: [gx + remoLargo, gy, gz], paleta: b.paleta, cajas: b.cajas.map(([x0, y0, z0, x1, y1, z1, p]) => [x0 + remoLargo, y0, z0, x1 + remoLargo, y1, z1, p]) };
}

function generarTodo() {
  const resultado = {};
  const conteo = {};
  for (const [id, v] of Object.entries(items)) {
    if (id.startsWith("_") || !v || typeof v !== "object" || !v.esBarco) continue;
    const modelo = generarBarco(v.huella, v.plazas || 1);
    resultado[`${id}_01`] = { nombre: id.replace(/_/g, " "), arquetipo: "BARCO", resolucion: U, ...modelo };
    conteo[id] = v.plazas;
  }
  return { resultado, conteo };
}

if (require.main === module) {
  const { resultado, conteo } = generarTodo();
  fs.writeFileSync(path.join(__dirname, "barcos_generados.json"), JSON.stringify(resultado));
  console.log(`Generados: ${Object.keys(resultado).length} barcos`);
  console.log("Plazas por tipo:", conteo);
}

module.exports = { generarTodo, generarBarco, U };
