"use strict";
// Galería de verificación visual del pase de mejoras (tarea streamer
// 2026-08-28): casa_noble en madera a niveles 1/2/3 (entramado+corbeles+
// jardineras+tejado variable), casa_modesta en madera (entramado ya no
// exclusivo de noble), y una posada/taberna (jetty+tudor siempre).
//   node prueba_render_niveles.js
const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarEdificio } = require("./generar_edificio");

function dibujarModelo(modelo) {
  const u = modelo.resolucion;
  const piezas = modelo.cajas.map(([x0, y0, z0, x1, y1, z1, p]) => {
    const hex = modelo.paleta[p];
    return {
      cx: (x0 + x1 + 1) / 2 / u, y0: y0 / u, cz: (z0 + z1 + 1) / 2 / u,
      w: (x1 - x0 + 1) / u, h: (y1 - y0 + 1) / u, d: (z1 - z0 + 1) / u, hex,
    };
  });
  piezas.sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz) || a.y0 - b.y0);
  const cx0 = modelo.grid[0] / 2 / u;
  const cz0 = modelo.grid[2] / 2 / u;
  return piezas.map((pz) => caja(pz.cx - cx0, pz.y0, pz.cz - cz0, pz.w, pz.h, pz.d, pz.hex)).join("\n");
}

// Forzar semillas hasta que el material salga "madera" (elegirMaterial es
// ponderado, no todas las semillas dan madera) — así la galería SIEMPRE
// enseña entramado, que es justo lo que hay que revisar.
function buscarSemillaMadera(tipoId, nivel, maxIntentos = 40) {
  for (let n = 1; n <= maxIntentos; n++) {
    const m = generarEdificio(tipoId, n, null, nivel);
    if (m.material === "madera") return m;
  }
  return generarEdificio(tipoId, 1, null, nivel);
}

const items = [
  { id: "casa_noble n1", modelo: buscarSemillaMadera("casa_noble", 1) },
  { id: "casa_noble n2", modelo: buscarSemillaMadera("casa_noble", 2) },
  { id: "casa_noble n3", modelo: buscarSemillaMadera("casa_noble", 3) },
  { id: "casa_modesta n2", modelo: buscarSemillaMadera("casa_modesta", 2) },
  { id: "casa_modesta n3", modelo: buscarSemillaMadera("casa_modesta", 3) },
  { id: "posada", modelo: buscarSemillaMadera("posada", 2) },
  { id: "taberna", modelo: buscarSemillaMadera("taberna", 3) },
  { id: "molino", modelo: generarEdificio("molino", 1, null, 2) },
];

const COLS = 4;
const CELDA_W = 640, CELDA_H = 640;
const columnas = items.map(({ id, modelo }, i) => {
  const fila = Math.floor(i / COLS), col = i % COLS;
  const dx = 60 + col * CELDA_W + CELDA_W / 2;
  const dy = 90 + fila * CELDA_H + CELDA_H * 0.72;
  const alturaReal = modelo.grid[1] / modelo.resolucion;
  const zoom = Math.min(1.6, (CELDA_H * 0.6) / (alturaReal * 150));
  console.log(`${id}: material=${modelo.material}, ${modelo.cajas.length} cajas, grid ${modelo.grid.join("x")}`);
  const textos = `<text x="0" y="40" fill="#bbb" font-family="monospace" font-size="16" text-anchor="middle">${id}</text>
<text x="0" y="58" fill="#777" font-family="monospace" font-size="12" text-anchor="middle">${modelo.material} · ${modelo.estiloVentana}/${modelo.estiloVentanaAlt}</text>`;
  return `<g transform="translate(${dx}, ${dy})"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
});

const filas = Math.ceil(items.length / COLS);
const ancho = 60 + COLS * CELDA_W + 60;
const alto = 90 + filas * CELDA_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="34" fill="#eee" font-family="monospace" font-size="18">Verificación: niveles de mejora + entramado Tudor real + jardineras + corbeles</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_niveles.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
