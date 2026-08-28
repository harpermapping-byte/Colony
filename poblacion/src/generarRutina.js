"use strict";

// Fase 3 (GDD_Poblacion_NPCs.md): la rutina horaria CONCRETA de un NPC —
// resuelve los tramos abstractos del perfil (casa/trabajo/taberna/plaza)
// a coordenadas reales de SU asentamiento, y a qué sala de SU casa va
// para cada acción de puertas adentro. Determinista por (NPC, día): la
// variación diaria es un jitter pequeño en los horarios, nunca cambia la
// plantilla — "dentro de lo habitual".
const { crearPRNG } = require("../../interiores/src/azar");

const JITTER_MAX_HORAS = 0.75;

function centroPuerta(edificio) {
  return { x: edificio.puerta.x, y: edificio.puerta.y };
}

function edificioDe(ciudad, edificioId) {
  return ciudad.edificios.find((e) => e.interior?.id === edificioId);
}

function buscarTaberna(ciudad) {
  const t = ciudad.edificios.find((e) => e.tipoEdificioId === "taberna" || e.tipoEdificioId === "posada");
  return t ? centroPuerta(t) : null;
}

// Huertos intramuros reales del bake (ciudades/src/generar.js: zonas verdes
// con un 45% de salir como "tierra_labrada") — no todo asentamiento tiene
// uno. Se cachea por ciudad: escanear la rejilla entera es barato UNA vez,
// caro si se hiciera por cada NPC con perfil "granjero".
const cacheHuertos = new WeakMap();
function tilesDeHuerto(ciudad) {
  if (cacheHuertos.has(ciudad)) return cacheHuertos.get(ciudad);
  const tiles = [];
  for (let y = 0; y < ciudad.alto; y++) {
    for (let x = 0; x < ciudad.ancho; x++) {
      if (ciudad.terreno.get(x, y) === "tierra_labrada") tiles.push({ x, y });
    }
  }
  cacheHuertos.set(ciudad, tiles);
  return tiles;
}

function puntoDeCampo(ciudad, casaPunto) {
  const tiles = tilesDeHuerto(ciudad);
  if (tiles.length === 0) return null; // este bake no tiene huerto: se resolverá al placeholder junto a la puerta
  let mejor = tiles[0];
  let mejorDist = Infinity;
  for (const t of tiles) {
    const d = Math.hypot(t.x - casaPunto.x, t.y - casaPunto.y);
    if (d < mejorDist) { mejorDist = d; mejor = t; }
  }
  return mejor;
}

function salaParaAccion(edificio, accion, accionesPorSala) {
  const tipos = accionesPorSala[accion];
  if (!tipos || !edificio?.interior) return null;
  for (const planta of edificio.interior.plantas) {
    for (const sala of planta.salas) {
      if (tipos.includes(sala.tipoSalaId)) return { tipoSalaId: sala.tipoSalaId, planta: planta.nivel };
    }
  }
  return null; // su casa no tiene esa sala: se queda junto a la puerta, no rompe nada
}

function resolverLugar(lugar, ctx) {
  switch (lugar) {
    case "casa":
      return ctx.casaPunto;
    case "trabajo":
      return ctx.trabajoPunto ?? ctx.casaPunto;
    case "taberna":
      return ctx.tabernaPunto ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "plaza":
      return ctx.plazaPunto ?? ctx.casaPunto;
    case "campo":
      // Huerto real del bake (tierra_labrada) más cercano a su casa; si
      // este asentamiento no tiene ninguno, cae junto a su propia puerta
      // (placeholder v1, GDD "Qué falta" — no todo bake tiene huerto).
      return ctx.campoPunto ?? ctx.casaPunto;
    default:
      return ctx.casaPunto;
  }
}

function jitter(rnd) {
  return (rnd() * 2 - 1) * JITTER_MAX_HORAS;
}

/**
 * @param {object} npc - con .vivienda/.trabajo (Fase 2) y .perfilSocial (asignarPerfil)
 * @param {object} ciudad - de ciudades/src/generar.js generarCiudad()
 * @param {object} catalogos - poblacion/src/catalogo.js (perfilesSociales, accionesPorSala)
 * @param {number} dia - día de juego, para la variación determinista dentro de lo habitual
 * @returns {Array<{lugar, accion, horaInicio, horaFin, punto: {x,y}, sala: {tipoSalaId,planta}|null}>}
 */
function generarRutina(npc, ciudad, catalogos, dia = 0) {
  const perfil = catalogos.perfilesSociales[npc.perfilSocial];
  if (!perfil) return [];

  const edificioCasa = npc.vivienda ? edificioDe(ciudad, npc.vivienda.edificioId) : null;
  if (!edificioCasa) return []; // sin vivienda (déficit de Fase 2): sin desde-dónde partir, sin rutina

  const edificioTrabajo = npc.trabajo ? edificioDe(ciudad, npc.trabajo.edificioId) : null;
  const ctx = {
    casaPunto: centroPuerta(edificioCasa),
    trabajoPunto: edificioTrabajo ? centroPuerta(edificioTrabajo) : null,
    tabernaPunto: buscarTaberna(ciudad),
    plazaPunto: ciudad.focal ?? null,
    campoPunto: puntoDeCampo(ciudad, centroPuerta(edificioCasa)),
  };

  const rnd = crearPRNG(`${npc.slotId}|rutina|dia${dia}`);
  return perfil.tramos.map((tramo) => ({
    lugar: tramo.lugar,
    accion: tramo.accion,
    horaInicio: Number((tramo.horaInicio + jitter(rnd)).toFixed(2)),
    horaFin: Number((tramo.horaFin + jitter(rnd)).toFixed(2)),
    punto: resolverLugar(tramo.lugar, ctx),
    sala: tramo.lugar === "casa" ? salaParaAccion(edificioCasa, tramo.accion, catalogos.accionesPorSala) : null,
  }));
}

module.exports = { generarRutina };
