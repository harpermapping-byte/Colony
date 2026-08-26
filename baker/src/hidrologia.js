"use strict";

// Hidrología: versión "seguir la pendiente" del GDD (sección 4) — más simple
// que la erosión hidráulica por partículas descrita como mejora futura, pero
// ya da ríos, lagos y caudal reales. Corre sobre una rejilla reducida (no
// tile a tile) para que sea rápido incluso en mapas de 200x200 chunks.
function generarHidrologia({ anchoTiles, altoTiles, paso, elevacionEn, umbralRio }) {
  const cols = Math.ceil(anchoTiles / paso);
  const filas = Math.ceil(altoTiles / paso);
  const total = cols * filas;

  const elevaciones = new Float64Array(total);
  const flujo = new Float64Array(total).fill(1);
  const destino = new Int32Array(total).fill(-1);

  const idx = (cx, cy) => cy * cols + cx;

  for (let cy = 0; cy < filas; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      elevaciones[idx(cx, cy)] = elevacionEn(cx * paso, cy * paso);
    }
  }

  // Orden descendente de elevación: procesamos de arriba a abajo para que,
  // cuando acumulamos flujo en el destino, ese destino ya reciba lo que le
  // llega de aguas arriba antes de repartir el suyo propio.
  const orden = Array.from({ length: total }, (_, i) => i).sort(
    (a, b) => elevaciones[b] - elevaciones[a]
  );

  const vecinos = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (const i of orden) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    let mejorVecino = -1;
    let menorElevacion = elevaciones[i];
    for (const [dx, dy] of vecinos) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
      const j = idx(nx, ny);
      if (elevaciones[j] < menorElevacion) {
        menorElevacion = elevaciones[j];
        mejorVecino = j;
      }
    }
    destino[i] = mejorVecino;
    if (mejorVecino !== -1) {
      flujo[mejorVecino] += flujo[i];
    }
  }

  // Lagos: mínimos locales (sin vecino más bajo) con suficiente flujo entrante.
  const esLago = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (destino[i] === -1 && flujo[i] >= umbralRio * 0.6) {
      esLago[i] = 1;
    }
  }

  // Charca garantizada: en mapas pequeños o de relieve muy plano puede no
  // salir ningún lago natural. Para que nunca falte un cuerpo de agua
  // quieta, forzamos una charca pequeña en el punto más bajo del interior
  // del mapa (con margen del 10% para no meterla pegada a un borde, donde
  // podría solaparse con un océano si el borde es de tipo mar_abierto).
  let hayLago = false;
  for (let i = 0; i < total; i++) {
    if (esLago[i]) {
      hayLago = true;
      break;
    }
  }
  if (!hayLago) {
    const margenCols = Math.max(1, Math.floor(cols * 0.1));
    const margenFilas = Math.max(1, Math.floor(filas * 0.1));
    let mejorI = -1;
    let menorElev = Infinity;
    for (let cy = margenFilas; cy < filas - margenFilas; cy++) {
      for (let cx = margenCols; cx < cols - margenCols; cx++) {
        const i = idx(cx, cy);
        if (elevaciones[i] < menorElev) {
          menorElev = elevaciones[i];
          mejorI = i;
        }
      }
    }
    if (mejorI !== -1) {
      const cx0 = mejorI % cols;
      const cy0 = Math.floor(mejorI / cols);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx0 + dx;
          const ny = cy0 + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
          esLago[idx(nx, ny)] = 1;
        }
      }
    }
  }

  function celdaMasCercana(x, y) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round(x / paso)));
    const cy = Math.min(filas - 1, Math.max(0, Math.round(y / paso)));
    return idx(cx, cy);
  }

  // Dibujar el río/lago directamente como "toda la celda de rejilla más
  // cercana" da bloques cuadrados de hasta `paso` tiles de lado (con
  // paso=16, casi medio chunk) — se ve como cuadrados azules pegados unos a
  // otros, no como un río. En vez de eso, trazamos una línea fina real
  // entre cada celda de río y la celda a la que fluye (garantizado
  // continuo: el caudal solo crece aguas abajo, así que si una celda supera
  // el umbral, su destino también lo supera, hasta llegar a un lago/borde),
  // y los lagos se rellenan como un círculo en vez de un cuadrado.
  //
  // Claves numéricas (y*anchoTiles+x) en vez de strings `${x}_${y}`: un Set
  // de strings paga boxing + hashing de texto por cada entrada, mientras que
  // un Set de enteros pequeños es mucho más compacto (~230MB medidos de
  // diferencia en el mapa principal de 200x200 chunks). También se descartan
  // aquí los puntos fuera de la rejilla de tiles en vez de guardarlos sin
  // usarlos nunca.
  const tilesRio = new Set();
  const tilesLago = new Set();
  const dentro = (x, y) => x >= 0 && y >= 0 && x < anchoTiles && y < altoTiles;
  const clave = (x, y) => y * anchoTiles + x;

  function trazarLinea(x0, y0, x1, y1, radio, destinoSet) {
    const largo = Math.hypot(x1 - x0, y1 - y0);
    const pasosLinea = Math.max(1, Math.ceil(largo));
    for (let s = 0; s <= pasosLinea; s++) {
      const t = s / pasosLinea;
      const px = Math.round(x0 + (x1 - x0) * t);
      const py = Math.round(y0 + (y1 - y0) * t);
      for (let ddy = -radio; ddy <= radio; ddy++) {
        for (let ddx = -radio; ddx <= radio; ddx++) {
          const x = px + ddx;
          const y = py + ddy;
          if (dentro(x, y)) destinoSet.add(clave(x, y));
        }
      }
    }
  }

  function estamparDisco(cx, cy, radio, destinoSet) {
    for (let dy = -radio; dy <= radio; dy++) {
      for (let dx = -radio; dx <= radio; dx++) {
        if (dx * dx + dy * dy > radio * radio) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (dentro(x, y)) destinoSet.add(clave(x, y));
      }
    }
  }

  for (let i = 0; i < total; i++) {
    if (esLago[i] || flujo[i] < umbralRio) continue;
    const j = destino[i];
    if (j === -1) continue;
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const jx = j % cols;
    const jy = Math.floor(j / cols);
    // Más caudal = río algo más ancho, acotado para que no se desmadre.
    const radio = Math.min(3, 1 + Math.floor(flujo[i] / (umbralRio * 4)));
    trazarLinea(cx * paso, cy * paso, jx * paso, jy * paso, radio, tilesRio);
  }

  const radioLago = Math.max(4, Math.round(paso * 0.6));
  for (let i = 0; i < total; i++) {
    if (!esLago[i]) continue;
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    estamparDisco(cx * paso, cy * paso, radioLago, tilesLago);
  }

  function consultar(x, y) {
    const i = celdaMasCercana(x, y);
    const k = dentro(x, y) ? clave(x, y) : -1;
    return {
      caudal: flujo[i],
      esRio: k !== -1 && tilesRio.has(k),
      esLago: k !== -1 && tilesLago.has(k),
    };
  }

  return { consultar, cols, filas, paso };
}

module.exports = { generarHidrologia };
