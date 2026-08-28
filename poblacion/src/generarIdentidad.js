"use strict";

// Nombre + apellido de un individuo (GDD_Poblacion_NPCs.md). El apellido
// se comparte dentro de una unidad familiar (mismo apellido para cabeza,
// cónyuge e hijos — simplificación v1, no distingue patronímico/matronímico
// pese al catálogo nórdico).
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");

function elegir(lista, rnd) {
  return elegirPonderado(lista, rnd);
}

/**
 * @param {object} slot - de generarCenso
 * @param {"hombre"|"mujer"} sexo
 * @param {object} catalogos - poblacion/src/catalogo.js
 * @param {string|undefined} apellidoFamilia - si ya se eligió para la familia, se reusa
 */
function generarIdentidad(slot, sexo, catalogos, apellidoFamilia) {
  const rnd = crearPRNG(`${slot.semilla}|identidad`);
  const listaNombres = sexo === "mujer" ? catalogos.nombres.femeninos : catalogos.nombres.masculinos;
  const nombre = elegir(listaNombres, rnd);
  const apellido = apellidoFamilia ?? elegir(catalogos.nombres.apellidos, rnd);
  return { nombre, apellido };
}

/** Elige (determinista) el apellido de una unidad familiar, una sola vez. */
function apellidoDeFamilia(familiaId, catalogos) {
  const rnd = crearPRNG(`${familiaId}|apellido`);
  return elegir(catalogos.nombres.apellidos, rnd);
}

module.exports = { generarIdentidad, apellidoDeFamilia };
