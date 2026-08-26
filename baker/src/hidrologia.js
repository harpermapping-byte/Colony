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

  function celdaMasCercana(x, y) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round(x / paso)));
    const cy = Math.min(filas - 1, Math.max(0, Math.round(y / paso)));
    return idx(cx, cy);
  }

  function consultar(x, y) {
    const i = celdaMasCercana(x, y);
    return {
      caudal: flujo[i],
      esRio: flujo[i] >= umbralRio && !esLago[i],
      esLago: !!esLago[i],
    };
  }

  return { consultar, cols, filas, paso };
}

module.exports = { generarHidrologia };
