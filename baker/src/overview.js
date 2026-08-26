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

// Genera la imagen de resumen del mapa entero (GDD sección 12): en vez de un
// único bloque de color por chunk (que convertía cualquier río o camino fino
// en un cuadrado del tamaño de medio chunk — la queja real de "veo el agua
// como cuadrados azules"), se muestrea el terreno tile a tile a una
// resolución más fina dentro de cada chunk, así ríos/costas/caminos salen
// con su forma orgánica real en vez de una rejilla.
function generarImagenResumen({ anchoChunks, altoChunks, tamanoChunk, muestrearTile, catalogoTerrenos, catalogoBiomas, pois, subMuestras = 8 }) {
  const ancho = anchoChunks * subMuestras;
  const alto = altoChunks * subMuestras;
  const rgba = Buffer.alloc(ancho * alto * 4, 255);
  const paso = Math.max(1, Math.floor(tamanoChunk / subMuestras));

  function pintarPixel(px, py, color) {
    if (px < 0 || py < 0 || px >= ancho || py >= alto) return;
    const i = (py * ancho + px) * 4;
    rgba[i] = color.r;
    rgba[i + 1] = color.g;
    rgba[i + 2] = color.b;
    rgba[i + 3] = 255;
  }

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      for (let sy = 0; sy < subMuestras; sy++) {
        for (let sx = 0; sx < subMuestras; sx++) {
          const x = cx * tamanoChunk + sx * paso;
          const y = cy * tamanoChunk + sy * paso;
          const { idTerreno, biomaId } = muestrearTile(x, y);

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
          pintarPixel(cx * subMuestras + sx, cy * subMuestras + sy, color);
        }
      }
    }
  }

  for (const poi of pois) {
    const px = Math.round(poi.chunkX * subMuestras + subMuestras / 2);
    const py = Math.round(poi.chunkY * subMuestras + subMuestras / 2);
    const color = poi.legendario ? { r: 255, g: 210, b: 0 } : { r: 220, g: 40, b: 40 };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        pintarPixel(px + dx, py + dy, color);
      }
    }
  }

  return codificarPNG(ancho, alto, rgba);
}

module.exports = { generarImagenResumen };
