"use strict";

// NPCs ESPECIALES y turnos de guardia (GDD_Agentes_Moviles.md, pedido del
// streamer 2026-08-28): fuerza el perfil social de los arquetipos del
// catálogo `especiales.json` ANTES del reparto aleatorio de asignarPerfil,
// y reparte a la guardia por índice: 2 por puerta de muralla (turno de día
// + turno de noche en la MISMA puerta) y el resto a rondas alternando
// día/noche. Devuelve el perfil forzado o null si el NPC no es especial.

/**
 * @param {object} npc - de exportarPoblacion (con .ficha) — se le puede
 *   escribir .puestoPuerta (índice de puerta de muralla) y .grito
 * @param {object} ctx - { indiceGuardia: contador mutable {n}, nPuertas }
 * @param {object} especiales - poblacion/catalogo/especiales.json
 * @returns {string|null} id de perfil forzado, o null (reparto normal)
 */
function perfilEspecial(npc, ctx, especiales) {
  const arquetipo = npc.npcId;

  const guardia = especiales.guardia;
  if (guardia && arquetipo === guardia.arquetipo) {
    const i = ctx.indiceGuardia.n++;
    const puestosPuerta = ctx.nPuertas * guardia.turnosPuerta.length;
    if (i < puestosPuerta) {
      npc.puestoPuerta = Math.floor(i / guardia.turnosPuerta.length);
      return guardia.turnosPuerta[i % guardia.turnosPuerta.length];
    }
    return guardia.turnosRonda[(i - puestosPuerta) % guardia.turnosRonda.length];
  }

  const entrada = especiales.porArquetipo?.[arquetipo];
  if (!entrada) return null;
  if (entrada.grito) npc.grito = entrada.grito;
  return entrada.perfil;
}

module.exports = { perfilEspecial };
