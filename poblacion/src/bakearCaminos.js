"use strict";

// Fase 3 (GDD_Poblacion_NPCs.md): caminos entre los puntos de una rutina,
// bakeados UNA vez sobre la rejilla de terreno del propio asentamiento —
// mismo A* que ya usa ciudades/ para trazar sus calles (ciudades/src/geometria.js),
// nunca pathfinding en directo en el servidor. Con caché: varios NPCs que
// comparten casa/trabajo/taberna (vecinos, compañeros de oficio) reusan el
// mismo camino en vez de recalcularlo.
const { aEstrella } = require("../../ciudades/src/geometria");
const { TRANSITABLES } = require("../../ciudades/src/generar");

function costeDeCiudad(ciudad) {
  return (x, y) => (ciudad.terreno.dentro(x, y) && TRANSITABLES.has(ciudad.terreno.get(x, y)) ? 1 : Infinity);
}

// Un portal (puerta de edificio) puede caer en una casilla no marcada
// transitable si el terreno bajo ella no se talló como camino — se busca
// en espiral la casilla caminable más cercana para no perder el punto.
function puntoCaminableCercano(ciudad, punto, radioMax = 4) {
  const coste = costeDeCiudad(ciudad);
  const x0 = Math.round(punto.x);
  const y0 = Math.round(punto.y);
  if (coste(x0, y0) < Infinity) return { x: x0, y: y0 };
  for (let r = 1; r <= radioMax; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (coste(x, y) < Infinity) return { x, y };
      }
    }
  }
  return null;
}

/**
 * Camino entre dos puntos de ESTE asentamiento, con caché.
 * @returns {Array<{x,y}>|null} null si no hay ruta caminable
 */
function caminoEntre(ciudad, cache, origen, destino) {
  if (!origen || !destino) return null;
  const clave = `${Math.round(origen.x)},${Math.round(origen.y)}|${Math.round(destino.x)},${Math.round(destino.y)}`;
  if (cache.has(clave)) return cache.get(clave);

  const inicio = puntoCaminableCercano(ciudad, origen);
  const fin = puntoCaminableCercano(ciudad, destino);
  const camino = inicio && fin ? aEstrella(ciudad.ancho, ciudad.alto, inicio, fin, costeDeCiudad(ciudad)) : null;
  cache.set(clave, camino);
  return camino;
}

/**
 * Añade `.camino` a cada tramo de una rutina (menos el primero: no hay
 * "desde dónde" moverse hasta que empieza el día) — el tramo N.camino es
 * la ruta desde el punto del tramo N-1 hasta el punto del tramo N.
 * @param {object} ciudad
 * @param {Array} rutina - de generarRutina.js
 * @param {Map} cache - compartida entre NPCs del mismo asentamiento (bakearAsentamiento.js la crea una vez)
 */
function bakearCaminosDeRutina(ciudad, rutina, cache) {
  for (let i = 0; i < rutina.length; i++) {
    const origen = i === 0 ? rutina[rutina.length - 1].punto : rutina[i - 1].punto;
    rutina[i].camino =
      origen && rutina[i].punto && (origen.x !== rutina[i].punto.x || origen.y !== rutina[i].punto.y)
        ? caminoEntre(ciudad, cache, origen, rutina[i].punto)
        : null; // mismo sitio que el tramo anterior (p.ej. comer y socializar los dos en casa): no hace falta caminar
  }
  return rutina;
}

module.exports = { caminoEntre, bakearCaminosDeRutina, puntoCaminableCercano };
