"use strict";
// Galería visual de PRUEBA de los generadores de ítems (armas/herramientas/
// objetos/comida) — misma técnica que prueba_render_naturaleza.js: dibuja
// las cajas de vóxeles reales con el mini-render isométrico compartido
// (personajes/src/renderIso.js). Solo la MUESTRA pequeña (--muestra de cada
// generador), no el catálogo completo — pedido 2026-09-01: esto es para que
// el streamer revise que la HERRAMIENTA funciona, no un bakeo de producción.
//   node prueba_render_items.js
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node prueba_render_png_items.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarArma } = require("./generar_armas");
const { generarHerramienta } = require("./generar_herramientas");
const { generarObjeto } = require("./generar_objetos");
const { generarComida } = require("./generar_comida");

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

function panel(id, subtitulo, modelo, dx, dy, zoomBase) {
  // los ítems varían mucho más en tamaño real que los muebles (de una vara
  // fina de 0.05 casillas a una lanza de casi 3): encoge por la DIMENSIÓN
  // MAYOR de las tres (alto/ancho/fondo), no solo el alto, para que ni las
  // armas largas ni los objetos anchos (arco, ballesta) se salgan de su celda.
  const dimMax = Math.max(...modelo.grid) / modelo.resolucion;
  const zoom = Math.min(zoomBase, (280 * 0.6) / (Math.max(0.25, dimMax) * 150));
  const textos = `<text x="0" y="40" fill="#bbb" font-family="monospace" font-size="15" text-anchor="middle">${id}</text>
<text x="0" y="57" fill="#777" font-family="monospace" font-size="11" text-anchor="middle">${subtitulo}</text>`;
  return `<g transform="translate(${dx}, ${dy})"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
}

const MUESTRAS = [
  { grupo: "ARMA", ids: ["daga", "espada_larga", "hacha_combate", "maza_guerra", "lanza", "arco_largo", "ballesta", "honda"], fn: generarArma },
  { grupo: "HERRAMIENTA", ids: ["hacha_talar", "pico_minero", "martillo_forja_hierro", "cuchillo_desollar", "tenazas_cuello_largo", "cana_pesca", "pluma_tintero"], fn: generarHerramienta },
  { grupo: "OBJETO", ids: ["plato", "caldero", "jarra_cerveza", "sarten", "silla_montar", "libro", "brasero", "jaula_pajaro"], fn: generarObjeto },
  { grupo: "COMIDA", ids: ["asado_carne_roja", "pan", "jarra_agua", "pocion_alquimica", "venda", "queso"], fn: generarComida },
];

const items = [];
for (const { grupo, ids, fn } of MUESTRAS) {
  for (const id of ids) {
    const m = fn(id);
    if (!m) continue;
    items.push({ id: `${grupo}: ${id}`, subtitulo: `${m.arquetipo} · ${m.paleta.length} colores · ${m.cajas.length} cajas`, modelo: m, zoom: 5.5 });
  }
}

const CELDA_W = 300, CELDA_H = 300;
const COLS = 6;
const columnas = items.map((it, i) => {
  const fila = Math.floor(i / COLS), col = i % COLS;
  const dx = 40 + col * CELDA_W + CELDA_W / 2;
  const dy = 90 + fila * CELDA_H + CELDA_H * 0.72;
  console.log(`${it.id}: ${it.subtitulo}`);
  return panel(it.id, it.subtitulo, it.modelo, dx, dy, it.zoom);
});

const filas = Math.ceil(items.length / COLS);
const ancho = 40 + COLS * CELDA_W + 40;
const alto = 80 + filas * CELDA_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="34" fill="#eee" font-family="monospace" font-size="18">Muestra de la herramienta generar_armas/herramientas/objetos/comida.js (pedido 2026-09-01, NO es el bakeo de produccion)</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_items_muestra.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
