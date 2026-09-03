"use strict";
// Selector profesión -> prenda (docs/GDD_Ropa_Procedural.md, pedido
// 2026-08-30) — hasta ahora `tagsProfesion` (prendas.json) y `tagsPrenda`
// (profesiones.json) existían pero NADA los cruzaba: la ropa de un NPC
// salía siempre hardcodeada a mano en personajes/catalogo/npcs.json. Esto
// hace el cruce real: puntúa cada prenda de un tipoPrenda por cuántos tags
// comparte con la profesión y elige entre las mejor puntuadas — "comun" ya
// lo llevan casi todas las prendas Y casi todas las profesiones, así que
// como mínimo SIEMPRE hay candidata (nunca null salvo que no exista NINGUNA
// prenda de ese tipoPrenda en el catálogo).

const { crearPRNG } = require("../../interiores/src/azar");

/**
 * @param {Record<string, object>} prendas catálogo de prendas.json (sin la clave "_nota")
 * @param {{tagsPrenda: string[]}} profesion entrada de profesiones.json
 * @param {"camisa"|"pantalon"|"gorro"|"guante"|"bota"|"capa"} tipoPrenda
 * @param {() => number} rnd generador determinista (mulberry32, crearPRNG)
 * @returns {string|null} id de prenda elegida, null si no hay ninguna de ese tipoPrenda
 */
function elegirPrendaPorProfesion(prendas, profesion, tipoPrenda, rnd) {
  const candidatas = Object.entries(prendas)
    .filter(([, p]) => p.tipoPrenda === tipoPrenda)
    .map(([id, p]) => ({
      id,
      coincidencias: (p.tagsProfesion || []).filter((t) => (profesion.tagsPrenda || []).includes(t)).length,
    }));
  if (candidatas.length === 0) return null;
  // solo entran las que comparten AL MENOS un tag — una prenda sin ningún
  // tag en común con la profesión no es candidata, aunque sea del tipo correcto
  const conMatch = candidatas.filter((c) => c.coincidencias > 0);
  if (conMatch.length === 0) return null;
  const mejor = Math.max(...conMatch.map((c) => c.coincidencias));
  const empatadas = conMatch.filter((c) => c.coincidencias === mejor);
  return empatadas[Math.floor(rnd() * empatadas.length)].id;
}

/** Conjunto completo (camisa+pantalon+gorro+guante+bota+capa, los 6 tipoPrenda que existen hoy — mantener en sync al añadir un tipoPrenda nuevo) para una profesión — semilla determinista por nombre de profesión, misma profesión = mismo conjunto siempre. guante/bota/capa son opcionales de verdad: si ninguna prenda de ese tipo comparte tag con la profesión, `elegirPrendaPorProfesion` da null y el NPC simplemente no lleva ese hueco puesto (nunca falla). */
function elegirConjuntoPorProfesion(prendas, profesion, profesionId) {
  const rnd = crearPRNG(`ropa|${profesionId}`);
  const tipos = ["camisa", "pantalon", "gorro", "guante", "bota", "capa"];
  const resultado = {};
  for (const tipo of tipos) {
    const id = elegirPrendaPorProfesion(prendas, profesion, tipo, rnd);
    if (id) resultado[tipo] = id;
  }
  return resultado;
}

module.exports = { elegirPrendaPorProfesion, elegirConjuntoPorProfesion };
