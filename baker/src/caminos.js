"use strict";

// Cola de prioridad binaria (min-heap) por fScore — sin esto, A* tiene que
// recorrer todos los nodos abiertos en cada paso para encontrar el mejor,
// lo que en mapas grandes (o cuando un POI resulta inalcanzable y hay que
// explorar casi todo el mapa antes de rendirse) se vuelve extremadamente
// lento. Con el heap, encontrar/sacar el mejor nodo es O(log n) en vez de
// O(n) — la diferencia entre segundos y minutos en un mapa grande.
class ColaPrioridad {
  constructor() {
    this.datos = []; // [{ id, f }]
  }
  get size() {
    return this.datos.length;
  }
  insertar(id, f) {
    this.datos.push({ id, f });
    let i = this.datos.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.datos[padre].f <= this.datos[i].f) break;
      [this.datos[padre], this.datos[i]] = [this.datos[i], this.datos[padre]];
      i = padre;
    }
  }
  extraerMinimo() {
    const min = this.datos[0];
    const ultimo = this.datos.pop();
    if (this.datos.length > 0) {
      this.datos[0] = ultimo;
      let i = 0;
      while (true) {
        const izq = 2 * i + 1;
        const der = 2 * i + 2;
        let menor = i;
        if (izq < this.datos.length && this.datos[izq].f < this.datos[menor].f) menor = izq;
        if (der < this.datos.length && this.datos[der].f < this.datos[menor].f) menor = der;
        if (menor === i) break;
        [this.datos[menor], this.datos[i]] = [this.datos[i], this.datos[menor]];
        i = menor;
      }
    }
    return min;
  }
}

// A* / Dijkstra sobre una rejilla reducida (GDD sección 7 y 12.6) para
// conectar la ciudad con los POIs importantes. Se corre en la rejilla de
// "paso" en vez de tile a tile, porque en un mapa grande buscar tile a tile
// sería demasiado lento — el resultado se reconstruye a coordenadas de tile
// después, y se traza como una franja de un par de casillas de ancho.
//
// El coste es por ARISTA (costoArista(x0,y0,x1,y1)), no por nodo — así el
// propio pathfinding conoce la pendiente real entre dos nodos consecutivos
// y penaliza subir en línea recta, prefiriendo rodear/serpentear cuando
// hace falta ganar altura. El zigzag de montaña nace así en la geometría
// real de la ruta, en vez de ser solo un adorno cosmético pintado encima
// de una línea recta (ver marcarSegmentoComoCamino en generar.js, que
// ahora solo añade un serpenteo sutil adicional).
function crearBuscadorCaminos({ anchoTiles, altoTiles, paso, costoArista, maxNodosExplorados = 60000 }) {
  const cols = Math.ceil(anchoTiles / paso);
  const filas = Math.ceil(altoTiles / paso);
  const idx = (cx, cy) => cy * cols + cx;
  const idxDeTile = (x, y) => idx(Math.round(x / paso), Math.round(y / paso));
  const tileDeIdx = (id) => ({ x: (id % cols) * paso, y: Math.floor(id / cols) * paso });

  const vecinos8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  function heuristica(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  function reconstruir(vino, idFinal) {
    const camino = [];
    let nodo = idFinal;
    while (nodo !== undefined) {
      camino.unshift(tileDeIdx(nodo));
      nodo = vino.get(nodo);
    }
    return camino;
  }

  // Ruta punto a punto de origen a destino (usada para el primer camino,
  // el que sale de la ciudad).
  function buscar(origenTile, destinoTile) {
    const ox = Math.round(origenTile.x / paso);
    const oy = Math.round(origenTile.y / paso);
    const dx = Math.round(destinoTile.x / paso);
    const dy = Math.round(destinoTile.y / paso);
    const idOrigen = idx(ox, oy);

    const cola = new ColaPrioridad();
    cola.insertar(idOrigen, heuristica(ox, oy, dx, dy));
    const vino = new Map();
    const gScore = new Map([[idOrigen, 0]]);
    const cerrado = new Set();

    let explorados = 0;
    while (cola.size > 0) {
      const { id: actual } = cola.extraerMinimo();
      if (cerrado.has(actual)) continue; // entrada obsoleta del heap (no hay decrease-key), se ignora
      cerrado.add(actual);

      // Red de seguridad: si un POI es inalcanzable, no dejamos que la
      // búsqueda explore el mapa entero indefinidamente — se rinde antes.
      explorados++;
      if (explorados > maxNodosExplorados) return null;

      const acx = actual % cols;
      const acy = Math.floor(actual / cols);
      if (acx === dx && acy === dy) return reconstruir(vino, actual);

      for (const [ddx, ddy] of vecinos8) {
        const nx = acx + ddx;
        const ny = acy + ddy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
        const j = idx(nx, ny);
        if (cerrado.has(j)) continue;
        const costo = costoArista(acx * paso, acy * paso, nx * paso, ny * paso);
        if (costo === Infinity) continue;
        const gTentativo = (gScore.get(actual) ?? Infinity) + costo;
        if (gTentativo < (gScore.get(j) ?? Infinity)) {
          vino.set(j, actual);
          gScore.set(j, gTentativo);
          cola.insertar(j, gTentativo + heuristica(nx, ny, dx, dy));
        }
      }
    }
    return null; // sin ruta posible con estas restricciones
  }

  // Dijkstra desde origen hasta el nodo MÁS CERCANO que ya forme parte de
  // la red (nodosDeRed: Set de ids de nodo, ver idxDeTile). No hay un
  // único destino fijo, así que no hay heurística — se para en cuanto se
  // saca de la cola un nodo que ya está en la red. Esto es lo que hace
  // que los caminos se ramifiquen desde troncos ya trazados en vez de que
  // cada POI trace su propia línea independiente hasta la ciudad.
  function buscarHastaRed(origenTile, nodosDeRed) {
    const idOrigen = idxDeTile(origenTile.x, origenTile.y);
    if (nodosDeRed.has(idOrigen)) return [tileDeIdx(idOrigen)];

    const cola = new ColaPrioridad();
    cola.insertar(idOrigen, 0);
    const vino = new Map();
    const gScore = new Map([[idOrigen, 0]]);
    const cerrado = new Set();

    let explorados = 0;
    while (cola.size > 0) {
      const { id: actual } = cola.extraerMinimo();
      if (cerrado.has(actual)) continue;
      cerrado.add(actual);

      explorados++;
      if (explorados > maxNodosExplorados) return null;

      if (nodosDeRed.has(actual)) return reconstruir(vino, actual);

      const acx = actual % cols;
      const acy = Math.floor(actual / cols);
      for (const [ddx, ddy] of vecinos8) {
        const nx = acx + ddx;
        const ny = acy + ddy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
        const j = idx(nx, ny);
        if (cerrado.has(j)) continue;
        const costo = costoArista(acx * paso, acy * paso, nx * paso, ny * paso);
        if (costo === Infinity) continue;
        const gTentativo = (gScore.get(actual) ?? Infinity) + costo;
        if (gTentativo < (gScore.get(j) ?? Infinity)) {
          vino.set(j, actual);
          gScore.set(j, gTentativo);
          cola.insertar(j, gTentativo);
        }
      }
    }
    return null; // la red es inalcanzable desde aquí con estas restricciones
  }

  return { buscar, buscarHastaRed, idxDeTile };
}

module.exports = { crearBuscadorCaminos };
