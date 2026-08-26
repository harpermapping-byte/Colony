"use strict";

// Ruido de valor con fBm (fractal Brownian motion), sin dependencias externas.
// No es Simplex/Perlin de verdad, pero da resultados orgánicos suficientes
// para el bakeador, y evita instalar cualquier paquete de npm.

function semillaDesdeTexto(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// PRNG mulberry32: determinista, rápido, suficiente para generación de mundo.
function crearPRNG(semilla) {
  let a = semilla >>> 0;
  return function siguiente() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function suavizado(t) {
  return t * t * (3 - 2 * t);
}

function interpolar(a, b, t) {
  return a + (b - a) * t;
}

// Genera una capa de ruido de valor 2D con una semilla propia.
class CapaRuido {
  constructor(semillaTexto, escala = 64) {
    // Semilla numérica fija de esta capa: la función de ruido es pura en
    // (ix, iy) para una semilla dada, nunca depende de un generador con
    // estado — así el mismo punto siempre da el mismo valor, se llame
    // como se llame y las veces que se llame.
    this.semilla = semillaDesdeTexto(semillaTexto);
    this.escala = escala;
  }

  _valorEntero(ix, iy) {
    let x = ix * 374761393 + iy * 668265263 + this.semilla * 2246822519;
    x = Math.imul(x ^ (x >>> 15), 2654435761);
    x = x ^ (x >>> 13);
    const s = Math.sin(x * 0.0001) * 43758.5453;
    return s - Math.floor(s);
  }

  // Ruido de valor suavizado en (x, y), en unidades de mundo (se divide por escala dentro).
  ruido2D(x, y) {
    const fx = x / this.escala;
    const fy = y / this.escala;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = suavizado(fx - ix);
    const ty = suavizado(fy - iy);

    const v00 = this._valorEntero(ix, iy);
    const v10 = this._valorEntero(ix + 1, iy);
    const v01 = this._valorEntero(ix, iy + 1);
    const v11 = this._valorEntero(ix + 1, iy + 1);

    const a = interpolar(v00, v10, tx);
    const b = interpolar(v01, v11, tx);
    return interpolar(a, b, ty); // 0..1
  }

  // Fractal Brownian motion: suma varias octavas para más detalle orgánico.
  fbm(x, y, octavas = 4, persistencia = 0.5) {
    let total = 0;
    let amplitud = 1;
    let amplitudMax = 0;
    let frecuencia = 1;
    for (let i = 0; i < octavas; i++) {
      total += this.ruido2D(x * frecuencia, y * frecuencia) * amplitud;
      amplitudMax += amplitud;
      amplitud *= persistencia;
      frecuencia *= 2;
    }
    return total / amplitudMax; // 0..1
  }
}

// Domain warping: distorsiona las coordenadas antes de leer otra capa de ruido,
// rompe el aspecto "ondulado reconocible" del ruido puro (ver GDD sección 3).
function conDomainWarp(capaBase, capaWarpX, capaWarpY, x, y, fuerza = 40) {
  const wx = x + (capaWarpX.fbm(x, y, 3) - 0.5) * fuerza;
  const wy = y + (capaWarpY.fbm(x, y, 3) - 0.5) * fuerza;
  return capaBase.fbm(wx, wy, 4);
}

module.exports = { semillaDesdeTexto, crearPRNG, CapaRuido, conDomainWarp };
