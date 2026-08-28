"use strict";
// Comprobación de "las 4 caras trabajadas, no solo la de delante": pinta cada
// edificio de muestra DOS veces, la segunda girada 180° (espejo del plano
// XZ sobre el centro), para ver la fachada trasera sin tener que exportar
// el .glb y girarlo a mano en un visor 3D.
//   node prueba_turnaround.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const { generarEdificio } = require("./generar_edificio");

function dibujarModelo(modelo, girado) {
  const u = modelo.resolucion;
  const cx0 = modelo.grid[0] / 2 / u;
  const cz0 = modelo.grid[2] / 2 / u;
  const piezas = modelo.cajas.map(([x0, y0, z0, x1, y1, z1, p]) => {
    const hex = modelo.paleta[p];
    let cx = (x0 + x1 + 1) / 2 / u - cx0, cz = (z0 + z1 + 1) / 2 / u - cz0;
    if (girado) { cx = -cx; cz = -cz; } // 180°: espejo sobre el centro en X y Z a la vez
    return { cx, y0: y0 / u, cz, w: (x1 - x0 + 1) / u, h: (y1 - y0 + 1) / u, d: (z1 - z0 + 1) / u, hex };
  });
  piezas.sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz) || a.y0 - b.y0);
  return piezas.map((pz) => caja(pz.cx, pz.y0, pz.cz, pz.w, pz.h, pz.d, pz.hex)).join("\n");
}

const MUESTRA = [
  { id: "casa_humilde", nn: 1, nota: "pobre: madera, tejado de paja" },
  { id: "casa_noble", nn: 1, nota: "rica: zócalo de piedra, entramado Tudor en la planta alta" },
  { id: "castillo", nn: 1, nota: "militar: sillar de piedra en las 4 caras" },
];

const CELDA_W = 820, CELDA_H = 760;
const grupos = MUESTRA.map((m, i) => {
  const modelo = generarEdificio(m.id, m.nn);
  const alturaReal = modelo.grid[1] / modelo.resolucion;
  const zoom = Math.min(1.3, (CELDA_H * 0.5) / (alturaReal * 150));
  const y = 110 + i * CELDA_H + CELDA_H * 0.68;
  const xFrente = 210, xTrasera = 210 + CELDA_W / 2;
  return `
    <text x="16" y="${110 + i * CELDA_H - 12}" fill="#eee" font-family="monospace" font-size="16">${m.id} — ${m.nota}</text>
    <g transform="translate(${xFrente}, ${y})"><g transform="scale(${zoom})">${dibujarModelo(modelo, false)}</g></g>
    <text x="${xFrente}" y="${110 + i * CELDA_H + 14}" fill="#777" font-family="monospace" font-size="12" text-anchor="middle">frente</text>
    <g transform="translate(${xTrasera}, ${y})"><g transform="scale(${zoom})">${dibujarModelo(modelo, true)}</g></g>
    <text x="${xTrasera}" y="${110 + i * CELDA_H + 14}" fill="#777" font-family="monospace" font-size="12" text-anchor="middle">girado 180° (trasera)</text>
  `;
});

const alto = 110 + MUESTRA.length * CELDA_H;
const ancho = CELDA_W + 420;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="34" fill="#fff" font-family="monospace" font-size="18">Turnaround — mismas 4 caras trabajadas, frente y trasera</text>
  ${grupos.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "turnaround.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`-> ${salida}`);
