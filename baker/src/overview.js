"use strict";

const { codificarPNG } = require("./png");

function hexARGB(hex) {
  const limpio = hex.replace("#", "");
  return {
    r: parseInt(limpio.substring(0, 2), 16),
    g: parseInt(limpio.substring(2, 4), 16),
    b: parseInt(limpio.substring(4, 6), 16),
  };
}

const COLOR_AGUA = { r: 47, g: 111, b: 176 };
const COLOR_AGUA_PROFUNDA = { r: 27, g: 79, b: 138 };
const COLOR_CAMINO = { r: 184, g: 154, b: 106 };

// Color por banda de elevación 0..6 (GDD sección 3.1: 0 agua profunda, 1
// agua/orilla, 2 playa/bajíos, 3 llanura, 4 colinas, 5 montaña, 6 cumbre) —
// una rampa tipo mapa topográfico, de azul oscuro a blanco.
const COLOR_POR_BANDA = [
  { r: 13, g: 44, b: 74 },
  { r: 47, g: 111, b: 176 },
  { r: 216, g: 196, b: 119 },
  { r: 111, g: 174, b: 74 },
  { r: 156, g: 138, b: 74 },
  { r: 138, g: 138, b: 138 },
  { r: 244, g: 246, b: 248 },
];

function colorPOI(poi) {
  return poi.legendario ? { r: 255, g: 210, b: 0 } : { r: 220, g: 40, b: 40 };
}

// Genera las dos imágenes de resumen del mapa entero (GDD sección 12) en un
// único muestreo: "mapa_general" (terreno/bioma real) y "mapa_elevacion"
// (solo la banda de elevación, como un mapa topográfico) — útil para ver de
// un vistazo el desnivel completo del mapa, de mar profundo a cumbre.
//
// Antes esto pintaba un único bloque de color por chunk entero (un río o
// camino fino salía como un cuadrado del tamaño de medio chunk — la queja
// real de "veo el agua como cuadrados azules"). Ahora se muestrea el
// terreno tile a tile a una resolución más fina dentro de cada chunk, así
// ríos/costas/caminos salen con su forma orgánica real.
function generarImagenesResumen({ anchoChunks, altoChunks, tamanoChunk, muestrearTile, catalogoTerrenos, catalogoBiomas, pois, subMuestras = 8 }) {
  const ancho = anchoChunks * subMuestras;
  const alto = altoChunks * subMuestras;
  const rgbaGeneral = Buffer.alloc(ancho * alto * 4, 255);
  const rgbaElevacion = Buffer.alloc(ancho * alto * 4, 255);
  const paso = Math.max(1, Math.floor(tamanoChunk / subMuestras));

  function pintarPixel(buffer, px, py, color) {
    if (px < 0 || py < 0 || px >= ancho || py >= alto) return;
    const i = (py * ancho + px) * 4;
    buffer[i] = color.r;
    buffer[i + 1] = color.g;
    buffer[i + 2] = color.b;
    buffer[i + 3] = 255;
  }

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      for (let sy = 0; sy < subMuestras; sy++) {
        for (let sx = 0; sx < subMuestras; sx++) {
          const x = cx * tamanoChunk + sx * paso;
          const y = cy * tamanoChunk + sy * paso;
          const { idTerreno, biomaId, banda, esCamino } = muestrearTile(x, y);
          const px = cx * subMuestras + sx;
          const py = cy * subMuestras + sy;

          let color = { r: 40, g: 40, b: 40 };
          if (idTerreno === "agua_profunda") {
            color = COLOR_AGUA_PROFUNDA;
          } else if (idTerreno === "agua") {
            color = COLOR_AGUA;
          } else if (idTerreno === "camino") {
            color = COLOR_CAMINO;
          } else if (biomaId && catalogoBiomas[biomaId]) {
            color = hexARGB(catalogoBiomas[biomaId].colorDebug);
          } else if (catalogoTerrenos[idTerreno]) {
            color = hexARGB(catalogoTerrenos[idTerreno].colorDebug);
          }
          pintarPixel(rgbaGeneral, px, py, color);

          let colorElevacion = COLOR_POR_BANDA[Math.max(0, Math.min(6, banda))];
          if (esCamino) colorElevacion = COLOR_CAMINO;
          pintarPixel(rgbaElevacion, px, py, colorElevacion);
        }
      }
    }
  }

  for (const poi of pois) {
    const px = Math.round(poi.chunkX * subMuestras + subMuestras / 2);
    const py = Math.round(poi.chunkY * subMuestras + subMuestras / 2);
    const color = colorPOI(poi);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        pintarPixel(rgbaGeneral, px + dx, py + dy, color);
        pintarPixel(rgbaElevacion, px + dx, py + dy, color);
      }
    }
  }

  return {
    mapaGeneral: codificarPNG(ancho, alto, rgbaGeneral),
    mapaElevacion: codificarPNG(ancho, alto, rgbaElevacion),
  };
}

module.exports = { generarImagenesResumen };
