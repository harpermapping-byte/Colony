"use strict";

// A* sobre una rejilla reducida (GDD sección 7 y 12.6) para conectar la
// ciudad con los POIs importantes. Se corre en la rejilla de "paso" en vez
// de tile a tile, porque en un mapa de 200x200 chunks buscar tile a tile
// sería demasiado lento — el resultado se reconstruye a coordenadas de tile
// después, y se traza como una franja de un par de casillas de ancho.
function crearBuscadorCaminos({ anchoTiles, altoTiles, paso, costoEn }) {
  const cols = Math.ceil(anchoTiles / paso);
  const filas = Math.ceil(altoTiles / paso);
  const idx = (cx, cy) => cy * cols + cx;

  function heuristica(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  function buscar(origenTile, destinoTile) {
    const ox = Math.round(origenTile.x / paso);
    const oy = Math.round(origenTile.y / paso);
    const dx = Math.round(destinoTile.x / paso);
    const dy = Math.round(destinoTile.y / paso);

    const abierto = new Set([idx(ox, oy)]);
    const vino = new Map();
    const gScore = new Map([[idx(ox, oy), 0]]);
    const fScore = new Map([[idx(ox, oy), heuristica(ox, oy, dx, dy)]]);

    const vecinos8 = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ];

    while (abierto.size > 0) {
      let actual = null;
      let mejorF = Infinity;
      for (const i of abierto) {
        const f = fScore.get(i) ?? Infinity;
        if (f < mejorF) {
          mejorF = f;
          actual = i;
        }
      }
      if (actual === null) break;

      const acx = actual % cols;
      const acy = Math.floor(actual / cols);
      if (acx === dx && acy === dy) {
        const camino = [];
        let nodo = actual;
        while (nodo !== undefined) {
          camino.unshift({ x: (nodo % cols) * paso, y: Math.floor(nodo / cols) * paso });
          nodo = vino.get(nodo);
        }
        return camino;
      }

      abierto.delete(actual);
      for (const [ddx, ddy] of vecinos8) {
        const nx = acx + ddx;
        const ny = acy + ddy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
        const costo = costoEn(nx * paso, ny * paso);
        if (costo === Infinity) continue;
        const j = idx(nx, ny);
        const gTentativo = (gScore.get(actual) ?? Infinity) + costo;
        if (gTentativo < (gScore.get(j) ?? Infinity)) {
          vino.set(j, actual);
          gScore.set(j, gTentativo);
          fScore.set(j, gTentativo + heuristica(nx, ny, dx, dy));
          abierto.add(j);
        }
      }
    }
    return null; // sin ruta posible con estas restricciones
  }

  return { buscar };
}

module.exports = { crearBuscadorCaminos };
