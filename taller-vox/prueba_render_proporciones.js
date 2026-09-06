"use strict";
// Comprobación visual puntual (pedido streamer: "las sillas son GIGANTES,
// cama y mesa ENORMES en proporción a los NPC") — dibuja cada mueble
// recalibrado JUNTO a una caja del tamaño real del rig humano (medidas de
// client/src/render3d/proporcionesRig.json) con el mismo mini-render
// isométrico que ya usa prueba_render_hitos_plaza.js, a la MISMA escala
// para que la comparación de tamaño sea real. Solo para verificación propia
// antes de dar por bueno el ajuste — no es el flujo de aprobación de arte
// nuevo (los muebles de interiores/ ya están exentos de esa revisión pieza
// a pieza, ver exportar_lote.js).
//   node prueba_render_proporciones.js

const fs = require("fs");
const path = require("path");
const { caja } = require("../personajes/src/renderIso");
const proporcionesRig = require("../client/src/render3d/proporcionesRig.json");

const modelos = require("./modelos_generados.json");

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

/** Caja simple del tamaño real de una persona de pie (mismas medidas que rigHumanoide.ts). */
function dibujarPersona() {
  const altoTotal = proporcionesRig.altoPierna + proporcionesRig.altoTorso + proporcionesRig.ladoCabeza;
  const ancho = proporcionesRig.torso.w;
  const partes = [
    caja(0, 0, 0, ancho, proporcionesRig.altoPierna, proporcionesRig.torso.d, "#6a6a78"), // piernas (bloque simplificado)
    caja(0, proporcionesRig.altoPierna, 0, ancho, proporcionesRig.altoTorso, proporcionesRig.torso.d, "#8a8a9a"), // torso
    caja(0, proporcionesRig.altoPierna + proporcionesRig.altoTorso, 0, proporcionesRig.ladoCabeza, proporcionesRig.ladoCabeza, proporcionesRig.ladoCabeza, "#c9a878"), // cabeza
  ].join("\n");
  return { svg: partes, altoTotal };
}

const IDS = ["silla", "banco", "mecedora", "trono", "cama_individual", "cama_doble", "mesa_comedor", "yunque_tocon"];
const PASO = 260;
const ZOOM = 0.45; // igual orden de magnitud que prueba_render_hitos_plaza.js (U=150 ya viene escalado dentro de caja())

const columnas = IDS.map((id, i) => {
  const modelo = modelos[id];
  if (!modelo) return `<text x="${i * PASO}" y="260" fill="red">falta ${id}</text>`;
  const dx = 130 + i * PASO;
  const dy = 320;
  const { svg: personaSvg } = dibujarPersona();
  console.log(`${id}: grid=${modelo.grid.join("x")} resolucion=${modelo.resolucion} altura=${(modelo.grid[1] / modelo.resolucion).toFixed(2)}u`);
  return `<g transform="translate(${dx}, ${dy}) scale(${ZOOM})">
    <g transform="translate(-90, 0)">${personaSvg}</g>
    <g transform="translate(60, 0)">${dibujarModelo(modelo)}</g>
    </g>
    <text x="${dx}" y="30" fill="#ddd" font-family="monospace" font-size="12" text-anchor="middle">${id}</text>
    <text x="${dx}" y="46" fill="#888" font-family="monospace" font-size="10" text-anchor="middle">alto ${(modelo.grid[1] / modelo.resolucion).toFixed(2)}u (persona 1.57u)</text>`;
});

const ancho = 130 + IDS.length * PASO;
const alto = 620;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect width="${ancho}" height="${alto}" fill="#1b1b22"/>
  <text x="16" y="580" fill="#eee" font-family="monospace" font-size="13">Muebles recalibrados junto a una persona de referencia (gris) — comprobación de proporción, no arte final</text>
  ${columnas.join("\n")}
</svg>`;

fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
const salida = path.join(__dirname, "output", "galeria_proporciones.svg");
fs.writeFileSync(salida, svg, "utf8");
console.log(`galería -> ${salida}`);
