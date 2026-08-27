"use strict";

// Ruido de GRADIENTE (estilo Perlin mejorado) con fBm, sin dependencias
// externas. Antes esto era ruido de valor con interpolación bilineal — más
// simple, pero con artefactos cuadriculados alineados con los ejes (las
// "esquinas" sutiles que se veían en costas y fronteras de bioma). El ruido
// de gradiente interpola PENDIENTES por celda en vez de valores, con curva
// de suavizado quíntica (la del paper de Perlin mejorado, derivada segunda
// continua) — el estándar de la generación procedural profesional. La API
// (CapaRuido/fbm/conDomainWarp) no cambia; misma semilla ≠ mismo mapa que
// antes (el campo de ruido es otro), así que los mapas existentes deben
// rehornearse.

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

// Curva de suavizado quíntica de Perlin mejorado: 6t⁵-15t⁴+10t³. A
// diferencia de la smoothstep cúbica, su segunda derivada también es 0 en
// los extremos — sin ella, las costuras entre celdas de rejilla se marcan
// como pliegues visibles al derivar (normales/pendientes del terreno).
function suavizadoQuintico(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function interpolar(a, b, t) {
  return a + (b - a) * t;
}

// Genera una capa de ruido de gradiente 2D con una semilla propia.
class CapaRuido {
  constructor(semillaTexto, escala = 64) {
    // Semilla numérica fija de esta capa: la función de ruido es pura en
    // (ix, iy) para una semilla dada, nunca depende de un generador con
    // estado — así el mismo punto siempre da el mismo valor, se llame
    // como se llame y las veces que se llame.
    this.semilla = semillaDesdeTexto(semillaTexto);
    this.escala = escala;
  }

  // Hash entero por esquina de celda → ángulo de gradiente unitario.
  _hashEsquina(ix, iy) {
    let x = ix * 374761393 + iy * 668265263 + this.semilla * 2246822519;
    x = Math.imul(x ^ (x >>> 15), 2654435761);
    return (x ^ (x >>> 13)) >>> 0;
  }

  // Producto escalar entre el gradiente de la esquina (ix,iy) y el vector
  // desde esa esquina hasta el punto muestreado (dx,dy).
  _gradiente(ix, iy, dx, dy) {
    const h = this._hashEsquina(ix, iy);
    const angulo = (h / 4294967296) * Math.PI * 2;
    return Math.cos(angulo) * dx + Math.sin(angulo) * dy;
  }

  // Ruido de gradiente en (x, y), en unidades de mundo (se divide por
  // escala dentro). Salida normalizada a 0..1 como el ruido de valor de
  // antes, para que ningún consumidor (rangos de bioma, umbrales) cambie.
  ruido2D(x, y) {
    const fx = x / this.escala;
    const fy = y / this.escala;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const dx = fx - ix;
    const dy = fy - iy;
    const tx = suavizadoQuintico(dx);
    const ty = suavizadoQuintico(dy);

    const g00 = this._gradiente(ix, iy, dx, dy);
    const g10 = this._gradiente(ix + 1, iy, dx - 1, dy);
    const g01 = this._gradiente(ix, iy + 1, dx, dy - 1);
    const g11 = this._gradiente(ix + 1, iy + 1, dx - 1, dy - 1);

    const a = interpolar(g00, g10, tx);
    const b = interpolar(g01, g11, tx);
    const v = interpolar(a, b, ty); // ~[-0.71, 0.71] (máx = √2/2 con gradientes unitarios)
    return Math.min(1, Math.max(0, v * 0.70710678 + 0.5)); // → 0..1
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
