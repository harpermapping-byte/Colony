"use strict";

// Forma de sala ORGÁNICA (cueva) por autómata celular — docs/GDD_Bakeador_Dungeons.md
// §0: siembra ruido de pared, aplica unas pocas iteraciones de la regla de
// vecindad de Moore ("una casilla se vuelve pared si 5+ de sus 8 vecinas lo
// son") y se queda solo con la región de suelo más grande (flood-fill) para
// que la sala sea una sola pieza conexa, sin islas sueltas. Mismo contrato
// de salida que una sala rectangular (una máscara ancho x largo de
// suelo/pared) para que el resto del motor (mobiliario, conectores, render)
// no necesite saber cuál de las dos formas es.

const { crearPRNG } = require("../../interiores/src/azar");

const VECINOS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function contarVecinosPared(grid, ancho, alto, x, y) {
  let n = 0;
  for (const [dx, dy] of VECINOS_8) {
    const nx = x + dx, ny = y + dy;
    // fuera de la rejilla cuenta como pared: así la cueva nunca "escapa" al borde
    if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto || grid[ny * ancho + nx] === 1) n++;
  }
  return n;
}

// Flood-fill de 4 vecinos sobre suelo (0) — la región conectada más grande
// gana, el resto se rellena de vuelta a pared (evita bolsillos sueltos que
// romperían "todas las salas alcanzables", el mismo contrato que ya
// garantiza interiorColision.ts para salas rectangulares).
function regionMasGrande(grid, ancho, alto) {
  const visitado = new Uint8Array(ancho * alto);
  let mejor = null;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i0 = y * ancho + x;
      if (grid[i0] !== 0 || visitado[i0]) continue;
      const region = [];
      const cola = [[x, y]];
      visitado[i0] = 1;
      while (cola.length) {
        const [cx, cy] = cola.pop();
        region.push(cy * ancho + cx);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
          const k = ny * ancho + nx;
          if (grid[k] === 0 && !visitado[k]) { visitado[k] = 1; cola.push([nx, ny]); }
        }
      }
      if (!mejor || region.length > mejor.length) mejor = region;
    }
  }
  return mejor || [];
}

/**
 * Genera la máscara de una sala orgánica. Devuelve { ancho, largo, mascara }
 * donde `mascara` es un string de `ancho*largo` caracteres ('1'=suelo,
 * '0'=pared), recortado al bounding box real del suelo (para no desperdiciar
 * rejilla) — mismo formato que consume `interiorColision.ts`/`interiorVisual.ts`.
 * @param {object} opciones - { ancho, alto, semilla, iteraciones=4, probInicialPared=0.45 }
 */
function generarFormaOrganica({ ancho, alto, semilla, iteraciones = 4, probInicialPared = 0.45 }) {
  const rnd = crearPRNG(semilla);
  let grid = new Uint8Array(ancho * alto);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() < probInicialPared ? 1 : 0;
  // el borde SIEMPRE es pared — sin esto la región de suelo podía tocar el
  // límite de la rejilla y "perder" la forma de cueva cerrada
  for (let x = 0; x < ancho; x++) { grid[x] = 1; grid[(alto - 1) * ancho + x] = 1; }
  for (let y = 0; y < alto; y++) { grid[y * ancho] = 1; grid[y * ancho + ancho - 1] = 1; }

  for (let it = 0; it < iteraciones; it++) {
    const siguiente = new Uint8Array(ancho * alto);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const vecinosPared = contarVecinosPared(grid, ancho, alto, x, y);
        siguiente[y * ancho + x] = vecinosPared >= 5 ? 1 : 0;
      }
    }
    grid = siguiente;
  }

  const region = regionMasGrande(grid, ancho, alto);
  const limpio = new Uint8Array(ancho * alto).fill(1);
  for (const idx of region) limpio[idx] = 0;

  // recorte al bounding box real del suelo
  let minX = ancho, maxX = -1, minY = alto, maxY = -1;
  for (const idx of region) {
    const x = idx % ancho, y = Math.floor(idx / ancho);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) {
    // caso degenerado (semilla/parámetros pésimos, no debería pasar con los
    // rangos del catálogo): un hueco 3x3 mínimo en el centro, mejor eso que nada
    minX = Math.floor(ancho / 2) - 1; maxX = minX + 2;
    minY = Math.floor(alto / 2) - 1; maxY = minY + 2;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) limpio[y * ancho + x] = 0;
  }

  const anchoRecortado = maxX - minX + 1;
  const largoRecortado = maxY - minY + 1;
  let mascara = "";
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) mascara += limpio[y * ancho + x] === 0 ? "1" : "0";
  }
  return { ancho: anchoRecortado, largo: largoRecortado, mascara };
}

module.exports = { generarFormaOrganica };
