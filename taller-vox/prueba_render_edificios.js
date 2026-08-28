"use strict";
// Galería visual del generador de edificios: los 10 arquetipos de prueba,
// dibujados desde sus cajas de vóxeles reales con el mismo mini-render
// isométrico que naturaleza/personajes (personajes/src/renderIso.js). Es la
// comprobación visual previa a exportar .glb.
//   node prueba_render_edificios.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarTodo, TIPOS_PRUEBA } = require("./generar_edificio");

const { resultado } = generarTodo(true);

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

// Un edificio por celda en una rejilla 5x2, con ZOOM ajustado a la altura
// real de cada modelo (grid[1]) para que cada uno llene bien su celda —
// a un zoom fijo pequeño para los 10 a la vez el trazo fino se ve como
// rayado (artefacto del preview, no del modelo: ver galeria_edificios.svg
// anterior vs. el .glb real, que no tiene ese problema).
const COLS = 5;
const CELDA_W = 620, CELDA_H = 620;
const columnas = TIPOS_PRUEBA.map((id, i) => {
  const modelo = resultado[`${id}_01`];
  const fila = Math.floor(i / COLS), col = i % COLS;
  const dx = 60 + col * CELDA_W + CELDA_W / 2;
  const dy = 90 + fila * CELDA_H + CELDA_H * 0.72;
  const alturaReal = modelo.grid[1] / modelo.resolucion; // vóxeles -> casillas/metros (renderIso ya multiplica por su propio U=150px/unidad)
  const zoom = Math.min(1.2, (CELDA_H * 0.55) / (alturaReal * 150));
  console.log(`${id}: ${modelo.arquetipo}, ${modelo.cajas.length} cajas, grid ${modelo.grid.join("x")}, huella ${modelo.huella.join("x")}, zoom ${zoom.toFixed(2)}`);
  const textos = `<text x="0" y="40" fill="#bbb" font-family="monospace" font-size="14" text-anchor="middle">${id}</text>
<text x="0" y="58" fill="#777" font-family="monospace" font-size="11" text-anchor="middle">${modelo.arquetipo} · huella ${modelo.huella.join("x")}</text>`;
  return `<g transform="translate(${dx}, ${dy})"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
});

const filas = Math.ceil(TIPOS_PRUEBA.length / COLS);
const ancho = 60 + COLS * CELDA_W + 60;
const alto = 90 + filas * CELDA_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="34" fill="#eee" font-family="monospace" font-size="18">Generador de edificios — 10 arquetipos desde tipos_edificio.json + huellas.json + materiales.json</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_edificios.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
