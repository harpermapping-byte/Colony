"use strict";

// docs/GDD_IA_NPCs.md (pedido streamer 2026-09-08: "la idea es tener varios
// perfiles de npc ia") — qué TONO de conversación le toca a cada NPC.
// Determinista por semilla, mismo patrón que asignarPerfil.js (perfil
// SOCIAL/rutina) pero un sorteo independiente: un NPC "trabajador" (rutina)
// puede ser "chismoso" o "gruñón" (tono) indistintamente, no hay relación
// entre los dos catálogos.
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");

/**
 * @param {object} npc - de exportarPoblacion (necesita .slotId)
 * @param {object} perfilesConversacionales - poblacion/catalogo/perfilesConversacionales.json
 * @returns {string} id del perfil elegido
 */
function asignarPerfilConversacional(npc, perfilesConversacionales) {
  const candidatos = Object.entries(perfilesConversacionales).filter(([id]) => !id.startsWith("_"));
  if (candidatos.length === 0) return null;
  const rnd = crearPRNG(`${npc.slotId}|perfilConversacional`);
  return elegirPonderado(
    candidatos.map(([id, p]) => [id, p.peso ?? 1]),
    rnd,
  );
}

module.exports = { asignarPerfilConversacional };
