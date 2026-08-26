"use strict";

const zlib = require("zlib");

// Encoder PNG mínimo, sin dependencias — usa solo el zlib nativo de Node
// para la compresión DEFLATE del bloque IDAT. Suficiente para la imagen de
// resumen del mapa (GDD sección 12), no pretende ser un encoder completo.

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = TABLA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const tipoBuf = Buffer.from(tipo, "ascii");
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([tipoBuf, datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([longitud, cuerpo, crc]);
}

// rgba: Uint8Array/Buffer de longitud ancho*alto*4 (R,G,B,A por pixel).
function codificarPNG(ancho, alto, rgba) {
  const firma = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrDatos = Buffer.alloc(13);
  ihdrDatos.writeUInt32BE(ancho, 0);
  ihdrDatos.writeUInt32BE(alto, 4);
  ihdrDatos[8] = 8; // profundidad de bit
  ihdrDatos[9] = 6; // color type: RGBA
  ihdrDatos[10] = 0;
  ihdrDatos[11] = 0;
  ihdrDatos[12] = 0;
  const ihdr = chunk("IHDR", ihdrDatos);

  // Cada línea lleva un byte de filtro (0 = sin filtro) delante.
  const crudo = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const inicioLinea = y * (ancho * 4 + 1);
    crudo[inicioLinea] = 0;
    rgba.copy(crudo, inicioLinea + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }
  const comprimido = zlib.deflateSync(crudo);
  const idat = chunk("IDAT", comprimido);

  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([firma, ihdr, idat, iend]);
}

module.exports = { codificarPNG };
