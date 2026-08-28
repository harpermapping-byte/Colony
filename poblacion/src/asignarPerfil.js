"use strict";

// Fase 3 (GDD_Poblacion_NPCs.md): qué perfil social le toca a cada NPC —
// determinista, respeta si tiene trabajo (Fase 2) o si es un hijo.
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");

/**
 * @param {object} npc - de exportarPoblacion + asignarUbicacion (ya con .trabajo si le tocó)
 * @param {object} perfilesSociales - poblacion/catalogo/perfilesSociales.json
 * @returns {string} id del perfil elegido
 */
function asignarPerfil(npc, perfilesSociales) {
  const esHijo = npc.rolFamiliar === "hijo";
  const tieneTrabajo = Boolean(npc.trabajo);

  const candidatos = Object.entries(perfilesSociales)
    .filter(([id]) => !id.startsWith("_"))
    .filter(([, p]) => Boolean(p.soloHijos) === esHijo)
    // Coincidencia EXACTA, no solo "vale si tiene trabajo": un perfil
    // requiereTrabajo:false (granjero/ocioso) usa 'campo'/'plaza' como su
    // tramo de "trabajar", nunca 'trabajo' — dárselo a alguien con un
    // oficio de verdad asignado (Fase 2) dejaría su edificio sin usar.
    .filter(([, p]) => Boolean(p.requiereTrabajo) === tieneTrabajo);

  // Nadie encaja (p.ej. adulto sin trabajo y sin perfil requiereTrabajo:false
  // disponible): no debería pasar con el catálogo actual, pero por si el
  // streamer amplía perfiles sin cubrir algún caso, no se rompe el pipeline.
  if (candidatos.length === 0) return null;

  const rnd = crearPRNG(`${npc.slotId}|perfil`);
  return elegirPonderado(
    candidatos.map(([id, p]) => [id, p.peso ?? 1]),
    rnd,
  );
}

module.exports = { asignarPerfil };
