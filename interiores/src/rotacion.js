"use strict";

// Rotación de footprint/tiles de interacción — sección 7 del pedido de
// integración. Un mueble se puede intentar en 0°/90°/180°/270°; rotar el
// footprint [ancho,largo] a 90°/270° intercambia ancho y largo, y el tile
// de interacción (offset relativo al origen del footprint en 0°) rota con
// él sobre la misma esquina de referencia.

const ORIENTACIONES = [0, 90, 180, 270];

function rotarHuella([ancho, largo], grados) {
  return grados === 90 || grados === 270 ? [largo, ancho] : [ancho, largo];
}

// offset relativo (dx,dy) dentro de una huella [ancho,largo] en 0°, rotado
// `grados` alrededor de la esquina superior-izquierda del footprint.
function rotarOffset([dx, dy], [ancho, largo], grados) {
  switch (grados) {
    case 90: return [largo - 1 - dy, dx];
    case 180: return [ancho - 1 - dx, largo - 1 - dy];
    case 270: return [dy, ancho - 1 - dx];
    default: return [dx, dy];
  }
}

module.exports = { ORIENTACIONES, rotarHuella, rotarOffset };
