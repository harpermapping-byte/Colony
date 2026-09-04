"use strict";
// Galería visual de los hitos de plaza (pozo/fuente/estatua) — las 3
// variantes de cada pieza, dibujadas desde sus cajas de vóxeles reales con
// el mini-render isométrico compartido (personajes/src/renderIso.js, 6
// caras por caja). Comprobación visual previa a subir nada a assets/: si
// aquí se lee bien, el .glb también — mismo patrón que
// prueba_render_naturaleza.js.
//   node prueba_render_hitos_plaza.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarTodo } = require("./generar_hitos_plaza");

const { resultado } = generarTodo();

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
  const cx0 = modelo.grid[0] / 2 / u;
  const cz0 = modelo.grid[2] / 2 / u;
  return piezas.map((pz) => caja(pz.cx - cx0, pz.y0, pz.cz - cz0, pz.w, pz.h, pz.d, pz.hex)).join("\n");
}

const IDS_BASE = ["pozo_agua", "fuente_piedra", "estatua_piedra"];
const ZOOM = { POZO: 0.55, FUENTE: 0.5, ESTATUA: 0.5 };
const PASO = 220;
const FILA = 340;

const filas = IDS_BASE.map((idBase, fila) => {
  const columnas = [1, 2, 3].map((n) => {
    const nn = String(n).padStart(2, "0");
    const modelo = resultado[`${idBase}_${nn}`];
    const dx = 130 + (n - 1) * PASO;
    const dy = 260 + fila * FILA;
    const zoom = ZOOM[modelo.arquetipo] || 1;
    console.log(`${idBase}_${nn}: ${modelo.cajas.length} cajas, grid ${modelo.grid.join("x")}`);
    const textos = `<text x="0" y="115" fill="#bbb" font-family="monospace" font-size="11" text-anchor="middle">${idBase}_${nn}</text>
<text x="0" y="130" fill="#777" font-family="monospace" font-size="9" text-anchor="middle">${modelo.arquetipo} · ${modelo.cajas.length} cajas</text>`;
    return `<g transform="translate(${dx}, ${dy})"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
  });
  return columnas.join("\n");
});

const ancho = 130 + 3 * PASO;
const alto = 50 + IDS_BASE.length * FILA;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="28" fill="#eee" font-family="monospace" font-size="15">Hitos de plaza (ciudades/) — pozo_agua / fuente_piedra / estatua_piedra, 3 variantes cada uno — PENDIENTE DE APROBAR</text>
  ${filas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_hitos_plaza.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
