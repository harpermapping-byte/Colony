"use strict";

// Galería visual del generador de ANIMALES: varios individuos de las
// especies de prueba (3 plantillas de esqueleto: cuadrúpedo, ave, insecto)
// — para comprobar de un vistazo siluetas, rasgos (orejas/cuernos/cresta/
// rayas/alas) y la variación individual por semilla.
// Uso: node personajes/src/prueba_render_animales.js
// PNG:  NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node personajes/src/prueba_render_png.js

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarAnimal } = require("./generarAnimal");
const { caja } = require("./renderIso");

const catalogos = cargarCatalogos();

// zoom: solo para el encuadre de ESTA galería (los grandes se salían de su
// columna) — el tamaño real relativo entre especies es el de sus proporciones.
const PRUEBAS = [
  { especieId: "conejo", semilla: "fauna-001", zoom: 1 },
  { especieId: "conejo", semilla: "fauna-002", zoom: 1 },
  { especieId: "lobo", semilla: "fauna-001", zoom: 0.75 },
  { especieId: "vaca_salvaje", semilla: "fauna-001", zoom: 0.55 },
  { especieId: "ciervo", semilla: "fauna-001", zoom: 0.6 },
  { especieId: "ciervo", semilla: "fauna-004", zoom: 0.6 },
  { especieId: "gallina_salvaje", semilla: "fauna-001", zoom: 1 },
  { especieId: "abeja", semilla: "fauna-001", zoom: 2.2 },
];

function dibujarAnimal({ piezas }) {
  // criterio del pintor: más lejos de cámara primero (menor x+z), a
  // igualdad de abajo a arriba — mismo orden que la galería de PJs
  const ordenadas = piezas.slice().sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz) || a.y0 - b.y0);
  return ordenadas.map((pz) => caja(pz.cx, pz.y0, pz.cz, pz.w, pz.h, pz.d, pz.color)).join("\n");
}

function renderGaleria() {
  const columnas = PRUEBAS.map((prueba, i) => {
    const resultado = generarAnimal(prueba.especieId, { ...prueba, catalogos });
    const f = resultado.ficha;
    const dx = 110 + i * 195;
    const etiqueta = [
      `${f.especieId} (${prueba.semilla})${prueba.zoom !== 1 ? ` x${prueba.zoom}` : ""}`,
      `${f.esqueleto} · ${f.sexo} · esc=${f.escala}`,
      Object.entries(f.rasgos).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (v === true ? k : `${k}:${v}`)).join(" "),
    ];
    console.log(etiqueta.join(" | "));
    const textos = etiqueta
      .map((linea, j) => `<text x="0" y="${66 + j * 13}" fill="#bbb" font-family="monospace" font-size="9" text-anchor="middle">${linea}</text>`)
      .join("");
    return `<g transform="translate(${dx}, 330)"><g transform="scale(${prueba.zoom})">${dibujarAnimal(resultado)}</g>${textos}</g>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1650" height="460" viewBox="0 0 1650 460">
  <rect width="1650" height="460" fill="#1b1b22"/>
  <text x="16" y="28" fill="#eee" font-family="monospace" font-size="15">Generador de animales — 3 esqueletos (cuadrúpedo/ave/insecto), deterministas por semilla</text>
  ${columnas.join("\n")}
</svg>`;

  const salida = path.join(__dirname, "..", "output", "galeria_animales.svg");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, svg, "utf8");
  console.log(`galería -> ${salida}`);
}

if (require.main === module) renderGaleria();

module.exports = { renderGaleria, PRUEBAS };
