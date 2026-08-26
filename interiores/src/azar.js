"use strict";

// Utilidades de aleatoriedad determinista compartidas — extraídas de
// colocarElementos.js/edificio.js a un módulo hoja sin dependencias
// propias para que catalogoContenido.js pueda usarlas sin crear un
// require circular con colocarElementos.js (que a su vez usa el catálogo
// de contenido para resolver variantes al colocar). Mismo comportamiento
// exacto que tenían antes en sus módulos originales — solo cambia dónde
// vive el código, no lo que hace.

// PRNG determinista pequeño (mulberry32) — misma semilla, mismo resultado.
function crearPRNG(semillaTexto) {
  let h = 1779033703 ^ semillaTexto.length;
  for (let i = 0; i < semillaTexto.length; i++) {
    h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function siguiente() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar(lista, rnd) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Selección ponderada determinista: `lista` es [[valor, peso], ...].
function elegirPonderado(lista, rnd) {
  const total = lista.reduce((s, [, peso]) => s + peso, 0);
  let tirada = rnd() * total;
  for (const [valor, peso] of lista) {
    tirada -= peso;
    if (tirada <= 0) return valor;
  }
  return lista[lista.length - 1][0];
}

module.exports = { crearPRNG, barajar, elegirPonderado };
