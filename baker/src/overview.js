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

// Genera la imagen de resumen del mapa entero (GDD sección 12): un bloque de
// píxeles por chunk con el color de depuración de su bioma, más marcas para
// ríos/lagos, caminos y POIs — para revisar el mapa de un vistazo sin volar
// por él entero.
function generarImagenResumen({ anchoChunks, altoChunks, biomaDelChunk, catalogoBiomas, esAguaChunk, esCaminoChunk, pois, escalaPixel = 3 }) {
  const ancho = anchoChunks * escalaPixel;
  const alto = altoChunks * escalaPixel;
  const rgba = Buffer.alloc(ancho * alto * 4, 255);

  function pintarBloque(cx, cy, color) {
    for (let dy = 0; dy < escalaPixel; dy++) {
      for (let dx = 0; dx < escalaPixel; dx++) {
        const px = cx * escalaPixel + dx;
        const py = cy * escalaPixel + dy;
        const i = (py * ancho + px) * 4;
        rgba[i] = color.r;
        rgba[i + 1] = color.g;
        rgba[i + 2] = color.b;
        rgba[i + 3] = 255;
      }
    }
  }

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      const bioma = biomaDelChunk(cx, cy);
      let color = { r: 40, g: 40, b: 40 };
      if (bioma && catalogoBiomas[bioma]) {
        color = hexARGB(catalogoBiomas[bioma].colorDebug);
      }
      if (esAguaChunk(cx, cy)) {
        color = { r: 47, g: 111, b: 176 };
      }
      pintarBloque(cx, cy, color);
      if (esCaminoChunk(cx, cy)) {
        pintarBloque(cx, cy, { r: 184, g: 154, b: 106 });
      }
    }
  }

  for (const poi of pois) {
    const cx = Math.floor(poi.chunkX);
    const cy = Math.floor(poi.chunkY);
    const color = poi.legendario ? { r: 255, g: 210, b: 0 } : { r: 220, g: 40, b: 40 };
    pintarBloque(cx, cy, color);
  }

  return codificarPNG(ancho, alto, rgba);
}

module.exports = { generarImagenResumen };
