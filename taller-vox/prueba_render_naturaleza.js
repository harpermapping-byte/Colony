"use strict";
// Galería visual del generador de naturaleza: una variante de cada especie
// del subconjunto de prueba, dibujada desde sus cajas de vóxeles reales con
// el mini-render isométrico compartido (personajes/src/renderIso.js — 6
// caras por caja, regla del streamer). Es la comprobación visual previa a
// exportar .glb: si aquí se lee como un roble/seta/coral, el .glb también.
//   node prueba_render_naturaleza.js
//   NODE_PATH=... PLAYWRIGHT_BROWSERS_PATH=... node prueba_render_png_naturaleza.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarTodo, ESPECIES_PRUEBA } = require("./generar_naturaleza");

const { resultado } = generarTodo(true);

function dibujarModelo(modelo) {
  const u = modelo.resolucion;
  const piezas = modelo.cajas.map(([x0, y0, z0, x1, y1, z1, p]) => {
    const hex = modelo.paleta[p];
    return {
      cx: (x0 + x1 + 1) / 2 / u,
      y0: y0 / u,
      cz: (z0 + z1 + 1) / 2 / u,
      w: (x1 - x0 + 1) / u,
      h: (y1 - y0 + 1) / u,
      d: (z1 - z0 + 1) / u,
      hex,
    };
  });
  piezas.sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz) || a.y0 - b.y0);
  // centrar en el origen: el grid ancla en la esquina, la galería en el centro
  const cx0 = modelo.grid[0] / 2 / u;
  const cz0 = modelo.grid[2] / 2 / u;
  return piezas.map((pz) => caja(pz.cx - cx0, pz.y0, pz.cz - cz0, pz.w, pz.h, pz.d, pz.hex)).join("\n");
}

// zoom de ENCUADRE por arquetipo (los árboles miden 2-3 casillas y los
// renders isométricos van a 150px/casilla — sin esto se salen de columna);
// el tamaño real relativo es el de los modelos, esto es solo la galería.
const ZOOM = { ARBOL_CADUCO: 0.42, CONIFERA: 0.5, PALMERA: 0.45, SAUCE: 0.45, ARBOL_SECO: 0.55, CACTUS: 0.6, ARBUSTO: 1, HIERBA: 1.2, FLOR: 1.4, SETA: 1.4, ALGA: 1, CORAL: 1.1, ROCA: 1, CRISTAL: 1.2 };

const PASO = 210;
const columnas = ESPECIES_PRUEBA.map((id, i) => {
  const modelo = resultado[`${id}_01`];
  const dx = 110 + i * PASO;
  const zoom = ZOOM[modelo.arquetipo] || 1;
  console.log(`${id}: ${modelo.cajas.length} cajas, grid ${modelo.grid.join("x")}`);
  const textos = `<text x="0" y="70" fill="#bbb" font-family="monospace" font-size="10" text-anchor="middle">${id}</text>
<text x="0" y="84" fill="#777" font-family="monospace" font-size="9" text-anchor="middle">${modelo.arquetipo} · var 01 de ${Object.keys(resultado).filter((k) => k.startsWith(id + "_")).length}</text>`;
  return `<g transform="translate(${dx}, 350)"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
});

const ancho = 110 + ESPECIES_PRUEBA.length * PASO;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="480" viewBox="0 0 ${ancho} 480">
  <rect width="${ancho}" height="480" fill="#1b1b22"/>
  <text x="16" y="28" fill="#eee" font-family="monospace" font-size="15">Generador de naturaleza — 14 arquetipos desde los catálogos reales del baker (variante 01 de cada especie de prueba)</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_naturaleza.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
