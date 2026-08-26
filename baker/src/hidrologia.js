"use strict";

// Hidrología: versión "seguir la pendiente" del GDD (sección 4) — más simple
// que la erosión hidráulica por partículas descrita como mejora futura, pero
// ya da ríos, lagos y caudal reales. Corre sobre una rejilla reducida (no
// tile a tile) para que sea rápido incluso en mapas de 200x200 chunks.
//
// Rediseñado para hidrología real (montaña → mar, afluentes que se suman a
// un río principal, pocos lagos significativos) en vez de "cualquier celda
// que supere un umbral dibuja su propio segmento": antes cualquier hondonada
// del ruido de elevación se convertía en lago (charquitos por todas partes)
// y un río podía terminar en cualquier mínimo local sin salida real (ríos
// que "acaban en nada"). Ahora solo se dibuja un río si su cadena de flujo
// llega de verdad al mar o a un lago seleccionado, y solo se seleccionan
// unos pocos lagos/desembocaduras — los más importantes por caudal — en vez
// de todos los candidatos posibles.
//
// Relleno de depresiones (priority-flood/Planchon-Darboux) antes de calcular
// dirección de flujo: sin esto, el descenso más pronunciado puro (D8) cae en
// el primer hoyo del ruido de elevación y ahí se para — con terreno con
// ruido, eso pasa cada pocas celdas, así que casi ningún camino de flujo
// llega de verdad al mar, solo fragmentos sueltos cerca de cada extremo
// (justo el síntoma de "ríos que acaban en nada"). Rellenar cada hondonada
// hasta su punto de desagüe real (subiendo su elevación efectiva lo justo
// para que el agua pueda seguir bajando por encima) hace que el flujo sí
// recorra de verdad desde la montaña hasta el mar, acumulando afluentes por
// el camino — mismo algoritmo que usan las herramientas de hidrología real
// sobre modelos de elevación.
//
// Semillas = solo celdas que YA son mar de verdad (elevación < nivelMar),
// estén donde estén en la rejilla — nunca "todo el borde del mapa". Un
// borde tipo montana/cerrado no es una salida real de agua (es un muro), así
// que si se sembrara ahí el agua "atravesaría" el muro sin motivo. Con solo
// el mar como semilla, una cuenca de verdad cerrada por montañas se rellena
// hasta su punto de desagüe real (y si nunca llega tan alto, se queda como
// lago genuino — el mismo mecanismo detecta ríos y lagos grandes a la vez,
// sin heurísticas aparte).
// Devuelve { rellenas, orden } — `orden` es en qué paso del propio relleno
// se visitó cada celda (0 = una semilla, procesada primero). Rellenar deja
// mesetas grandes exactamente a la misma altura (todas las celdas de una
// hondonada suben hasta el mismo punto de desagüe) y con solo la elevación
// no hay forma de saber, dentro de esa meseta, hacia qué lado sigue bajando
// de verdad — por eso el flujo D8 de más abajo desempata comparando `orden`
// en vez de solo elevación: la celda vecina que se rellenó ANTES (más cerca
// del mar en términos del propio relleno) es la downhill real, aunque las
// dos tengan exactamente la misma elevación rellena.
function rellenarDepresiones(elevaciones, cols, filas, nivelMar) {
  const total = cols * filas;
  const rellenas = Float64Array.from(elevaciones);
  const orden = new Int32Array(total).fill(-1);
  const visitado = new Uint8Array(total);

  // Heap binario mínimo sencillo, sin dependencias — [elevacion, indice].
  const heapE = [];
  const heapI = [];
  function heapPush(e, i) {
    heapE.push(e);
    heapI.push(i);
    let c = heapE.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapE[p] <= heapE[c]) break;
      [heapE[p], heapE[c]] = [heapE[c], heapE[p]];
      [heapI[p], heapI[c]] = [heapI[c], heapI[p]];
      c = p;
    }
  }
  function heapPop() {
    const e0 = heapE[0];
    const i0 = heapI[0];
    const eUlt = heapE.pop();
    const iUlt = heapI.pop();
    if (heapE.length > 0) {
      heapE[0] = eUlt;
      heapI[0] = iUlt;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = c * 2 + 2;
        let m = c;
        if (l < heapE.length && heapE[l] < heapE[m]) m = l;
        if (r < heapE.length && heapE[r] < heapE[m]) m = r;
        if (m === c) break;
        [heapE[m], heapE[c]] = [heapE[c], heapE[m]];
        [heapI[m], heapI[c]] = [heapI[c], heapI[m]];
        c = m;
      }
    }
    return [e0, i0];
  }

  let huboSemilla = false;
  let contador = 0;
  for (let i = 0; i < total; i++) {
    if (elevaciones[i] < nivelMar) {
      visitado[i] = 1;
      orden[i] = contador++;
      heapPush(rellenas[i], i);
      huboSemilla = true;
    }
  }
  // Mapa totalmente sin mar (todos los bordes son montana/cerrado/tierra):
  // no hay ninguna salida real, así que no tiene sentido rellenar nada —
  // se queda con la elevación tal cual y el mecanismo de charca garantizada
  // (más abajo) se encarga de que igualmente haya algo de agua quieta.
  if (!huboSemilla) return { rellenas, orden };

  const vecinos8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  while (heapE.length > 0) {
    const [e, i] = heapPop();
    const cx = i % cols;
    const cy = (i / cols) | 0;
    for (const [dx, dy] of vecinos8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
      const j = ny * cols + nx;
      if (visitado[j]) continue;
      visitado[j] = 1;
      if (rellenas[j] < e) rellenas[j] = e; // sube la hondonada hasta su punto de desagüe
      orden[j] = contador++;
      heapPush(rellenas[j], j);
    }
  }
  return { rellenas, orden };
}

function generarHidrologia({ anchoTiles, altoTiles, paso, elevacionEn, umbralRio, nivelMar = 0.22, maxRiosPrincipales, maxLagos }) {
  const cols = Math.ceil(anchoTiles / paso);
  const filas = Math.ceil(altoTiles / paso);
  const total = cols * filas;

  if (maxRiosPrincipales === undefined) {
    maxRiosPrincipales = Math.max(2, Math.round(Math.sqrt(cols * filas) / 15));
  }
  if (maxLagos === undefined) {
    maxLagos = Math.max(1, Math.round(maxRiosPrincipales / 3));
  }
  const distMinCeldas = Math.max(3, Math.round(Math.min(cols, filas) * 0.06));

  const elevaciones = new Float64Array(total); // elevación real — se usa para decidir "esto ya es mar"
  const flujo = new Float64Array(total).fill(1);
  const destino = new Int32Array(total).fill(-1);

  const idx = (cx, cy) => cy * cols + cx;

  for (let cy = 0; cy < filas; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      elevaciones[idx(cx, cy)] = elevacionEn(cx * paso, cy * paso);
    }
  }

  // Elevación "rellena" — solo para decidir hacia dónde fluye cada celda
  // (sección de arriba). El mar/nivelMar se sigue comprobando contra la
  // elevación real, nunca contra la rellena. `orden` desempata mesetas
  // (varias celdas rellenas exactamente a la misma altura) por cercanía real
  // al mar en el propio relleno — ver el comentario de rellenarDepresiones.
  const { rellenas: elevacionesFlujo, orden: ordenRelleno } = rellenarDepresiones(elevaciones, cols, filas, nivelMar);

  // Orden descendente de elevación (rellena): procesamos de arriba a abajo
  // para que, cuando acumulamos flujo en el destino, ese destino ya reciba
  // lo que le llega de aguas arriba antes de repartir el suyo propio. Cada
  // celda fluye a su vecino más bajo (D8, desempatado por `ordenRelleno`
  // dentro de una meseta) — así el caudal (flujo) de un tramo es
  // literalmente cuánta rejilla de aguas arriba desagua por ahí, y por eso
  // un río crece de verdad según se acerca al mar según se le suman
  // afluentes.
  const ordenDescendente = Array.from({ length: total }, (_, i) => i).sort((a, b) => {
    if (elevacionesFlujo[b] !== elevacionesFlujo[a]) return elevacionesFlujo[b] - elevacionesFlujo[a];
    return ordenRelleno[b] - ordenRelleno[a];
  });

  const vecinos = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (const i of ordenDescendente) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    let mejorVecino = -1;
    let menorElevacion = elevacionesFlujo[i];
    let menorOrden = ordenRelleno[i];
    for (const [dx, dy] of vecinos) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= filas) continue;
      const j = idx(nx, ny);
      const esMejor = elevacionesFlujo[j] < menorElevacion || (elevacionesFlujo[j] === menorElevacion && ordenRelleno[j] < menorOrden);
      if (esMejor) {
        menorElevacion = elevacionesFlujo[j];
        menorOrden = ordenRelleno[j];
        mejorVecino = j;
      }
    }
    destino[i] = mejorVecino;
    if (mejorVecino !== -1) {
      flujo[mejorVecino] += flujo[i];
    }
  }

  function distanciaCeldas(i, j) {
    const dx = (i % cols) - (j % cols);
    const dy = Math.floor(i / cols) - Math.floor(j / cols);
    return Math.hypot(dx, dy);
  }

  // Selecciona hasta `maximo` candidatos por caudal, sin coger dos que estén
  // demasiado juntos (misma desembocadura/lago "duplicado" por resolución de
  // rejilla) — de mayor a menor caudal, codicioso.
  function seleccionarPorCaudal(candidatos, maximo) {
    candidatos.sort((a, b) => flujo[b] - flujo[a]);
    const elegidos = [];
    for (const c of candidatos) {
      if (elegidos.length >= maximo) break;
      if (elegidos.some((e) => distanciaCeldas(c, e) < distMinCeldas)) continue;
      elegidos.push(c);
    }
    return elegidos;
  }

  // --- Lagos: solo mínimos locales (sin vecino más bajo) con caudal alto de
  // verdad, y como mucho maxLagos en todo el mapa — no cualquier hondonada.
  const candidatosLago = [];
  for (let i = 0; i < total; i++) {
    if (destino[i] === -1 && flujo[i] >= umbralRio * 2.5) candidatosLago.push(i);
  }
  const lagosElegidos = seleccionarPorCaudal(candidatosLago, maxLagos);
  const esLagoSeleccionado = new Uint8Array(total);
  for (const i of lagosElegidos) esLagoSeleccionado[i] = 1;

  // Charca garantizada: si el relieve es muy plano o no hay mínimo local con
  // caudal suficiente, forzamos una charca pequeña en el punto más bajo del
  // interior del mapa — solo visual (no forma parte de la red de ríos), para
  // que nunca falte un cuerpo de agua quieta en un mapa pequeño/plano.
  let charcaGarantizadaIdx = -1;
  if (lagosElegidos.length === 0) {
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
    charcaGarantizadaIdx = mejorI;
  }

  // --- Desembocaduras: la última celda de tierra antes de entrar en el mar
  // (elevación por debajo de nivelMar), rankeadas por caudal — solo las
  // maxRiosPrincipales más importantes se convierten en ríos de verdad. Así
  // en vez de "un hilo de agua por cada valle que baja hacia el mar" salen
  // unos pocos ríos principales de verdad, con sus afluentes ya fusionados.
  const candidatosBoca = [];
  for (let i = 0; i < total; i++) {
    const j = destino[i];
    if (j === -1) continue;
    if (elevaciones[i] >= nivelMar && elevaciones[j] < nivelMar) candidatosBoca.push(i);
  }
  const bocasElegidas = seleccionarPorCaudal(candidatosBoca, maxRiosPrincipales);
  const esBocaSeleccionada = new Uint8Array(total);
  for (const i of bocasElegidas) esBocaSeleccionada[i] = 1;

  // --- Propagación "esto forma parte de un río/lago real": ascendente en
  // elevación, así destino[i] (siempre más bajo) ya está resuelto cuando le
  // toca el turno a i. Una celda cuenta si es una desembocadura/lago
  // seleccionado, o si su destino ya cuenta — así un afluente que se une a
  // un río principal seleccionado también se dibuja, y una cadena que muere
  // en un mínimo local sin ser lago real simplemente no se dibuja nunca
  // (nada de "ríos que acaban en nada").
  const formaParteDeRedReal = new Uint8Array(total);
  for (const i of lagosElegidos) formaParteDeRedReal[i] = 1;
  for (const i of bocasElegidas) formaParteDeRedReal[i] = 1;

  const ordenAscendente = ordenDescendente.slice().reverse();
  for (const i of ordenAscendente) {
    if (formaParteDeRedReal[i]) continue; // ya es una raíz (lago o boca), no lo pisamos
    const j = destino[i];
    if (j !== -1 && formaParteDeRedReal[j]) formaParteDeRedReal[i] = 1;
  }

  function celdaMasCercana(x, y) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round(x / paso)));
    const cy = Math.min(filas - 1, Math.max(0, Math.round(y / paso)));
    return idx(cx, cy);
  }

  // Dibujar el río/lago directamente como "toda la celda de rejilla más
  // cercana" da bloques cuadrados de hasta `paso` tiles de lado — se ve como
  // cuadrados azules pegados unos a otros, no como un río. En vez de eso,
  // trazamos una línea fina real entre cada celda de río y la celda a la que
  // fluye, y los lagos se rellenan como un círculo en vez de un cuadrado.
  //
  // Claves numéricas (y*anchoTiles+x), no strings `${x}_${y}` — este Set se
  // consulta hasta una vez por casilla en el bucle principal del bakeador,
  // y un string nuevo por consulta es basura innecesaria en el punto más
  // caliente de todo el pipeline.
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
    if (esLagoSeleccionado[i] || flujo[i] < umbralRio || !formaParteDeRedReal[i]) continue;
    const j = destino[i];
    if (j === -1) continue;
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const jx = j % cols;
    const jy = Math.floor(j / cols);
    // Más caudal = río más ancho, así se nota de verdad que crece según se
    // acerca al mar y le van cayendo afluentes — acotado para que no se
    // desmadre en el tramo final de un río muy largo.
    const radio = Math.min(5, 1 + Math.floor(flujo[i] / (umbralRio * 6)));
    trazarLinea(cx * paso, cy * paso, jx * paso, jy * paso, radio, tilesRio);
  }

  const radioLago = Math.max(4, Math.round(paso * 0.6));
  for (const i of lagosElegidos) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    // Un lago con más caudal entrante es un lago más grande.
    const factor = Math.min(2.2, 1 + flujo[i] / (umbralRio * 12));
    estamparDisco(cx * paso, cy * paso, Math.round(radioLago * factor), tilesLago);
  }
  if (charcaGarantizadaIdx !== -1) {
    const cx = charcaGarantizadaIdx % cols;
    const cy = Math.floor(charcaGarantizadaIdx / cols);
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

  return {
    consultar,
    cols,
    filas,
    paso,
    numeroRiosPrincipales: bocasElegidas.length,
    numeroLagos: lagosElegidos.length + (charcaGarantizadaIdx !== -1 ? 1 : 0),
  };
}

module.exports = { generarHidrologia };
