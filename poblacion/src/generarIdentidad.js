"use strict";

// Nombre + apellido de un individuo (GDD_Poblacion_NPCs.md). El apellido
// se comparte dentro de una unidad familiar (mismo apellido para cabeza,
// cónyuge e hijos — simplificación v1, no distingue patronímico/matronímico).
//
// Nombres de políticos españoles (pedido 2026-08-30, "meme de la comunidad
// del streamer: que los NPC tengan nombres de políticos, cualquier partido,
// desde el inicio de la democracia"): `catalogos.nombres` ya no es un
// catálogo nórdico, son personas reales — ver poblacion/catalogo/nombres.json.
// La MAYORÍA de las veces (PROB_PAREJA_REAL) se usa un nombre+apellidos
// REAL tal cual salió de la lista, que es la gracia del meme; el resto (y
// SIEMPRE que el NPC ya hereda apellido de familia) remezcla un nombre y un
// apellido de dos personas distintas de la lista — "si se acaban esos
// nombres, se generan a partir de primer nombre de uno con apellido de
// otro", pedido literal — así la lista nunca se queda corta por muchos NPC
// que hagan falta.
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");

const PROB_PAREJA_REAL = 0.7;

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
  const parejas = catalogos.nombres.parejas;
  if (parejas && parejas.length && !apellidoFamilia && rnd() < PROB_PAREJA_REAL) {
    const sexoCatalogo = sexo === "mujer" ? "f" : "m";
    const candidatas = parejas.filter((p) => p.sexo === sexoCatalogo);
    if (candidatas.length) {
      const elegida = candidatas[Math.floor(rnd() * candidatas.length)];
      return { nombre: elegida.nombre, apellido: elegida.apellidos };
    }
  }
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
