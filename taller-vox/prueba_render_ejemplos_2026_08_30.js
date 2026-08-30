"use strict";
// Galería de verificación visual de la pasada "afinar parámetros de los
// bakeadores" (pedido 2026-08-30): muestra el ANTES/DESPUÉS de cada
// sistema — variantes de mueble con material+tallado+desgaste reales,
// edificio con ala en L + ventanas de un solo estilo.
//   node prueba_render_ejemplos_2026_08_30.js
const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarEdificio } = require("./generar_edificio");
const modelosMuebles = require("./modelos_generados.json");

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
  const alturaReal = modelo.grid[1] / modelo.resolucion;
  const zoom = Math.min(zoomBase, (500 * 0.55) / (alturaReal * 150));
  const textos = `<text x="0" y="40" fill="#bbb" font-family="monospace" font-size="15" text-anchor="middle">${id}</text>
<text x="0" y="57" fill="#777" font-family="monospace" font-size="11" text-anchor="middle">${subtitulo}</text>`;
  return `<g transform="translate(${dx}, ${dy})"><g transform="scale(${zoom})">${dibujarModelo(modelo)}</g>${textos}</g>`;
}

const CELDA_W = 400, CELDA_H = 500;
const items = [];

// --- Muebles: base vs 3 variantes reales de cama_individual ---
const idsMuebles = ["cama_individual", "cama_individual_pino", "cama_individual_roble_tallado", "cama_individual_desgastada"];
for (const id of idsMuebles) {
  const m = modelosMuebles[id];
  items.push({ id, subtitulo: `${m.paleta.length} colores · ${m.cajas.length} cajas`, modelo: m, zoom: 1.8 });
}

// --- Edificios: templo normal vs templo con ala + ventana única ---
const temploNormal = generarEdificio("templo", 3);
const temploAmpliado = (() => {
  // busca una semilla que saque ala (42% de probabilidad, no todas la traen)
  for (let n = 1; n <= 30; n++) {
    const m = generarEdificio("templo", n, null, null, { estiloVentanaUnico: true });
    if (m.enL) return m;
  }
  return generarEdificio("templo", 1, null, null, { estiloVentanaUnico: true });
})();
items.push({ id: "templo (antes)", subtitulo: `ventanas ${temploNormal.estiloVentana}/${temploNormal.estiloVentanaAlt} · enL=${temploNormal.enL}`, modelo: temploNormal, zoom: 0.42 });
items.push({ id: "templo (ala+ventanaUnica)", subtitulo: `ventanas ${temploAmpliado.estiloVentana}/${temploAmpliado.estiloVentanaAlt} · enL=${temploAmpliado.enL}`, modelo: temploAmpliado, zoom: 0.42 });

const COLS = 3;
const columnas = items.map((it, i) => {
  const fila = Math.floor(i / COLS), col = i % COLS;
  const dx = 40 + col * CELDA_W + CELDA_W / 2;
  const dy = 100 + fila * CELDA_H + CELDA_H * 0.62;
  console.log(`${it.id}: ${it.subtitulo}`);
  return panel(it.id, it.subtitulo, it.modelo, dx, dy, it.zoom);
});

const filas = Math.ceil(items.length / COLS);
const ancho = 40 + COLS * CELDA_W + 40;
const alto = 90 + filas * CELDA_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="34" fill="#eee" font-family="monospace" font-size="18">Ejemplos 2026-08-30: variantes de mueble (material+tallado+desgaste) y edificio (ala+ventana única)</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "ejemplos_2026_08_30.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
