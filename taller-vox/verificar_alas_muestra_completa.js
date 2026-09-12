"use strict";
// Script de verificación SUELTO (no forma parte de `node --test`, ver
// docs/GDD_Motor_3D_Props.md "Ventanas por ala/anexo sin solape") — la
// muestra COMPLETA que se usó para medir el bug real original de ventanas
// enterradas por un ala/anexo (2026-09-12): 17 tipoEdificio con ala reales
// (ciudades/catalogo/huellas.json::alas) × 60 semillas × 3 formas forzadas
// (T, L-derecha, L-izquierda, replicando EXACTAMENTE ciudades/src/generar.js
// líneas ~306-313) = 3.060 planes — el mismo tamaño de muestra citado en la
// investigación previa ("confirmado con 3060 planes reales", 2545/3060,
// 83.2%, antes del fix de la Parte A de generar_edificio.js).
//
// `test_edificio.js` ya cubre esto en la suite normal con una muestra más
// pequeña (17×3×20=1020, rápida de re-ejecutar en cada `node --test`) — este
// script es para reconfirmar con la muestra grande cuando haga falta, sin
// alargar el test suite habitual.
//
//   node taller-vox/verificar_alas_muestra_completa.js

const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const huellasCat = require("../ciudades/catalogo/huellas.json");
const { generarEdificio, CRISTAL } = require("./generar_edificio");

function cajasSeSolapan(c, x0, y0, z0, x1, y1, z1) {
  let [cx0, cy0, cz0, cx1, cy1, cz1] = c;
  if (cx1 < cx0) [cx0, cx1] = [cx1, cx0];
  if (cy1 < cy0) [cy0, cy1] = [cy1, cy0];
  if (cz1 < cz0) [cz0, cz1] = [cz1, cz0];
  return cx0 <= x1 && cx1 >= x0 && cy0 <= y1 && cy1 >= y0 && cz0 <= z1 && cz1 >= z0;
}
function cajaContenida(c, x0, y0, z0, x1, y1, z1) {
  let [cx0, cy0, cz0, cx1, cy1, cz1] = c;
  if (cx1 < cx0) [cx0, cx1] = [cx1, cx0];
  if (cy1 < cy0) [cy0, cy1] = [cy1, cy0];
  if (cz1 < cz0) [cz0, cz1] = [cz1, cz0];
  return cx0 >= x0 && cx1 <= x1 && cy0 >= y0 && cy1 <= y1 && cz0 >= z0 && cz1 <= z1;
}
function hexARgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// ¿a qué PIEZA (0=cuerpo principal, 1=primer ala, 2=segunda...) pertenece el
// índice `idx` de `cajas`? Usa `m.limitesPiezas` (campo del modelo, Parte
// A4 — fronteras reales entre piezas en índices de caja).
function piezaDe(idx, limitesPiezas) {
  for (let i = 0; i < limitesPiezas.length; i++) if (idx < limitesPiezas[i]) return i;
  return limitesPiezas.length;
}
// Misma implementación (restringida al volumen de cada ventana, no al
// edificio entero, y solo cuenta un solape con OTRA pieza fusionada — nunca
// un solape puramente interno de la MISMA pieza, como el frontón de un
// pórtico institucional cruzando una ventana de su propio piso de arriba,
// un problema real pero DISTINTO de "enterrada por el ala") que
// taller-vox/test_edificio.js::ventanaEnterrada — duplicada aquí a
// propósito: este script no debe depender del test suite para poder
// correrse suelto.
function ventanaEnterrada(m) {
  const idxCristal = m.paleta.indexOf(CRISTAL);
  if (idxCristal === -1) return false;
  const rgbCristal = hexARgb(CRISTAL);
  for (let idx = 0; idx < m.cajas.length; idx++) {
    const c = m.cajas[idx];
    if (c[6] !== idxCristal) continue;
    let [x0, y0, z0, x1, y1, z1] = c;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const mx0 = x0 === x1 ? x0 : x0 - 1, mx1 = x0 === x1 ? x1 : x1 + 1;
    const my0 = y0 - 1, my1 = y1 + 1;
    const mz0 = z0 === z1 ? z0 : z0 - 1, mz1 = z0 === z1 ? z1 : z1 + 1;
    const piezaVentana = piezaDe(idx, m.limitesPiezas);
    const posteriores = [];
    for (let j = idx + 1; j < m.cajas.length; j++) {
      const p = m.cajas[j];
      if (piezaDe(j, m.limitesPiezas) === piezaVentana) continue;
      if (!cajasSeSolapan(p, x0, y0, z0, x1, y1, z1)) continue;
      if (cajaContenida(p, mx0, my0, mz0, mx1, my1, mz1)) continue;
      posteriores.push(p);
    }
    if (posteriores.length === 0) continue;
    const ocupado = new Map();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) ocupado.set(`${x},${y},${z}`, rgbCristal);
    for (const p of posteriores) {
      let [px0, py0, pz0, px1, py1, pz1, pp] = p;
      if (px1 < px0) [px0, px1] = [px1, px0];
      if (py1 < py0) [py0, py1] = [py1, py0];
      if (pz1 < pz0) [pz0, pz1] = [pz1, pz0];
      const prgb = hexARgb(m.paleta[pp]);
      for (let x = Math.max(x0, px0); x <= Math.min(x1, px1); x++)
        for (let y = Math.max(y0, py0); y <= Math.min(y1, py1); y++)
          for (let z = Math.max(z0, pz0); z <= Math.min(z1, pz1); z++)
            ocupado.set(`${x},${y},${z}`, prgb);
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const f = ocupado.get(`${x},${y},${z}`);
      if (f[0] !== rgbCristal[0] || f[1] !== rgbCristal[1] || f[2] !== rgbCristal[2]) return true;
    }
  }
  return false;
}

function planForzado(tipoId, forma, n) {
  const base = huellasCat.porTipo[tipoId] || huellasCat.porRiqueza[tiposEdificio[tipoId].riqueza];
  const [w, h] = base;
  const ala = huellasCat.alas[tipoId];
  const oy = -(h / 2 + ala[1] / 2); // mismo cálculo real que ciudades/src/generar.js (oy siempre "detrás")
  const piezas = [{ ox: 0, oy: 0, w, h }];
  if (forma === "T") piezas.push({ ox: 0, oy, w: ala[0], h: ala[1] });
  else if (forma === "L-derecha") piezas.push({ ox: w / 2 - ala[0] / 2, oy, w: ala[0], h: ala[1] });
  else piezas.push({ ox: -(w / 2 - ala[0] / 2), oy, w: ala[0], h: ala[1] });
  return { semilla: `${tipoId}:${forma}:${n}`, w, h, piezas };
}

function main() {
  const tiposConAla = Object.keys(huellasCat.alas || {});
  const N_SEMILLAS = 60;
  const FORMAS = ["T", "L-derecha", "L-izquierda"];
  let total = 0, enterradas = 0;
  const porTipo = {};
  const inicio = Date.now();
  for (const tipoId of tiposConAla) {
    let tEnterradas = 0, tTotal = 0;
    for (const forma of FORMAS) {
      for (let n = 1; n <= N_SEMILLAS; n++) {
        const plan = planForzado(tipoId, forma, n);
        const m = generarEdificio(tipoId, n, plan);
        total++; tTotal++;
        if (ventanaEnterrada(m)) { enterradas++; tEnterradas++; }
      }
    }
    porTipo[tipoId] = `${tEnterradas}/${tTotal}`;
  }
  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`Muestra: ${tiposConAla.length} tipos × ${N_SEMILLAS} semillas × ${FORMAS.length} formas = ${total} planes (${seg}s)`);
  console.log("Por tipo:", porTipo);
  console.log(`TOTAL: ${enterradas}/${total} con al menos una ventana enterrada (${(100 * enterradas / total).toFixed(1)}%)`);
  if (enterradas > 0) process.exitCode = 1;
}

main();
