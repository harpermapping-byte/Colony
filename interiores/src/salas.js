"use strict";

// Detección/definición de habitaciones sobre una rejilla de tiles —
// implementa la tercera opción pedida ("detección de área cerrada por
// paredes"), la que es compatible con nuestro modelo de rejilla de tiles
// sin añadir nada complejo. Selección manual y herramienta rectangular son
// formas de EDITAR qué tiles pertenecen a una sala (una herramienta de
// nivel/menú de construcción, sección 8bis de Backlog_Mecanicas_Futuras.md)
// — no algo que el bakeador offline necesite generar él mismo. Por eso una
// Sala aquí se define solo como "un conjunto de tiles + metadatos", no como
// un rectángulo: da igual si esos tiles salieron de flood-fill, de una
// selección a mano o de una herramienta rectangular, la estructura es la
// misma y el resto del motor (colocarElementos.js, estadisticas.js) no
// necesita saber cuál de las tres se usó.

const TIPO_TILE = { SUELO: "suelo", PARED: "pared", PUERTA: "puerta", VENTANA: "ventana", VACIO: "vacio" };

function crearRejilla(ancho, alto, relleno = TIPO_TILE.VACIO) {
  const celdas = new Array(ancho * alto).fill(relleno);
  const idx = (x, y) => y * ancho + x;
  return {
    ancho,
    alto,
    get(x, y) {
      return x < 0 || y < 0 || x >= ancho || y >= alto ? TIPO_TILE.VACIO : celdas[idx(x, y)];
    },
    set(x, y, tipo) {
      if (x >= 0 && y >= 0 && x < ancho && y < alto) celdas[idx(x, y)] = tipo;
    },
  };
}

const VECINOS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Flood-fill de 4 vecinos sobre tiles de SUELO — cada región conectada de
// suelo es una sala. Las puertas/ventanas que tocan el borde de la región
// se anotan como aberturas de esa sala (fiable: no depende de adivinar
// nada, solo de qué tiles son suelo/pared/puerta/ventana).
function detectarSalas(rejilla) {
  const { ancho, alto } = rejilla;
  const visitado = new Set();
  const salas = [];
  let contador = 0;

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const clave = `${x}_${y}`;
      if (visitado.has(clave) || rejilla.get(x, y) !== TIPO_TILE.SUELO) continue;

      const tiles = new Set();
      const puertas = new Set();
      const ventanas = new Set();
      const pila = [[x, y]];
      visitado.add(clave);
      let minX = x, maxX = x, minY = y, maxY = y;

      while (pila.length) {
        const [cx, cy] = pila.pop();
        tiles.add(`${cx}_${cy}`);
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (const [dx, dy] of VECINOS_4) {
          const nx = cx + dx, ny = cy + dy;
          const nTipo = rejilla.get(nx, ny);
          if (nTipo === TIPO_TILE.SUELO) {
            const k = `${nx}_${ny}`;
            if (!visitado.has(k)) { visitado.add(k); pila.push([nx, ny]); }
          } else if (nTipo === TIPO_TILE.PUERTA) {
            puertas.add(`${nx}_${ny}`);
          } else if (nTipo === TIPO_TILE.VENTANA) {
            ventanas.add(`${nx}_${ny}`);
          }
        }
      }

      salas.push({
        id: `sala_${contador++}`,
        tiles, puertas, ventanas,
        minX, maxX, minY, maxY,
        ancho: maxX - minX + 1,
        largo: maxY - minY + 1,
      });
    }
  }
  return salas;
}

// Comprueba que, quitando las casillas de `ocupadas` (footprints de
// muebles ya colocados) de las casillas de suelo de la sala, el resto
// sigue formando UNA sola región conectada alcanzable desde la puerta —
// "no puede bloquear la circulación principal" sin adivinar rutas, solo
// flood-fill otra vez desde la puerta sobre lo que queda libre.
function circulacionIntacta(sala, ocupadas, origenXY) {
  const libres = new Set([...sala.tiles].filter((t) => !ocupadas.has(t)));
  if (libres.size === 0) return true; // sala completamente amueblada, no hay circulación que romper
  const origen = `${origenXY[0]}_${origenXY[1]}`;
  if (!libres.has(origen)) return true; // el propio origen (ej. la puerta) está ocupado, no es este chequeo el que debe rechazarlo
  const visitado = new Set([origen]);
  const pila = [origenXY];
  while (pila.length) {
    const [cx, cy] = pila.pop();
    for (const [dx, dy] of VECINOS_4) {
      const nx = cx + dx, ny = cy + dy;
      const k = `${nx}_${ny}`;
      if (libres.has(k) && !visitado.has(k)) { visitado.add(k); pila.push([nx, ny]); }
    }
  }
  return visitado.size === libres.size;
}

module.exports = { TIPO_TILE, crearRejilla, detectarSalas, circulacionIntacta };
