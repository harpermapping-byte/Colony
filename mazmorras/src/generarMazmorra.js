"use strict";

// Generador de interior de MAZMORRA — docs/GDD_Bakeador_Dungeons.md. Hermano
// de interiores/src/edificio.js: MISMO contrato de salida (plantas con
// salas/puertasConexion/conectoresVerticales, consumido tal cual por
// server/mundo/interiorColision.ts y client/render3d/interiorVisual.ts —
// escaleras=TP entre plantas se reutiliza sin tocarlo) pero con una
// composición de sala distinta: en vez de una fila + pasillo (edificios
// normales, plantas pequeñas), aquí las salas se ESPARCEN por un lienzo
// grande y se conectan por un árbol de expansión mínima (MST) de corredores
// — el patrón de layout que usan los roguelikes de verdad para dungeons
// grandes y muy conectadas (ver docs/GDD_Bakeador_Dungeons.md §0).
//
// Cada sala puede ser:
// - "rectangular": el motor de interiores/ de siempre (colocarSala.js,
//   con los tipos de sala grandes de mazmorra añadidos a tipos_sala.json).
// - "organica": autómata celular (celular.js) + un colocador de mobiliario
//   propio y más simple (sin el sistema de anclaje a pared de interiores/,
//   que asume paredes rectas) — dispersión de piezas por casillas de suelo
//   libres, válido para cualquier forma.
// Ambas comparten el MISMO contrato de salida por sala:
//   { ancho, largo, colocados: [...], mascara?: string, puerta?: {x,y} }
// `mascara` (nueva, opcional) es un string ancho*largo de '1'/'0' — cuando
// está presente, solo esas casillas son suelo real (interiorColision.ts y
// interiorVisual.ts la respetan; su AUSENCIA es el comportamiento de
// siempre, rectángulo completo = suelo, cero cambio para edificios ya
// existentes).

const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");
const { colocarSala } = require("../../interiores/src/colocarElementos");
const { generarFormaOrganica } = require("./celular");

function elegirEntero([min, max], rnd) {
  return min + Math.floor(rnd() * (max - min + 1));
}

// --- Mobiliario de sala orgánica: dispersión simple sobre casillas de
// suelo libres (sin anclaje a pared — una cueva no tiene paredes rectas).
// Cada pieza válida para `tipoSalaId` (mismo campo tiposSalaValidos que ya
// usa colocarElementos.js) se intenta colocar en una casilla libre al azar
// que quepa entera dentro de la máscara y no pise nada ya colocado.
function colocarMobiliarioOrganico({ ancho, largo, mascara, tipoSalaId, catalogos, riqueza, semilla, cantidadObjetivo }) {
  const rnd = crearPRNG(`${semilla}:mobiliario`);
  const candidatos = Object.entries(catalogos.elementos)
    .filter(([id]) => !id.startsWith("_"))
    .filter(([, def]) => (def.tiposSalaValidos || []).includes(tipoSalaId))
    .map(([id, def]) => ({ id, def }));
  if (candidatos.length === 0) return [];

  const esLibre = (x, y) => x >= 0 && y >= 0 && x < ancho && y < largo && mascara[y * ancho + x] === "1";
  const ocupado = new Set();
  const colocados = [];

  const intentarColocar = ({ id, def }) => {
    const [hw, hl] = def.huella;
    for (let intento = 0; intento < 25; intento++) {
      const x0 = Math.floor(rnd() * ancho), y0 = Math.floor(rnd() * largo);
      let cabe = true;
      for (let dy = 0; dy < hl && cabe; dy++) {
        for (let dx = 0; dx < hw && cabe; dx++) {
          const x = x0 + dx, y = y0 + dy;
          if (!esLibre(x, y) || ocupado.has(`${x}_${y}`)) cabe = false;
        }
      }
      if (!cabe) continue;
      for (let dy = 0; dy < hl; dy++) for (let dx = 0; dx < hw; dx++) ocupado.add(`${x0 + dx}_${y0 + dy}`);
      colocados.push({ id, x: x0, y: y0, ancho: hw, largo: hl, colorDebug: def.colorDebug, capa: def.capa });
      return true;
    }
    return false;
  };

  // obligatorias primero (altar, cofre de jefe...), luego relleno hasta el objetivo
  for (const c of candidatos.filter((c) => c.def.isMandatory)) intentarColocar(c);
  let colocadas = colocados.length;
  let vueltas = 0;
  while (colocadas < cantidadObjetivo && vueltas < cantidadObjetivo * 4) {
    vueltas++;
    const elegido = candidatos[Math.floor(rnd() * candidatos.length)];
    if (intentarColocar(elegido)) colocadas++;
  }
  return colocados;
}

function generarSalaMazmorra({ formaSala, tipoSalaId, catalogosInteriores, riqueza, semilla, anchoObjetivo, largoObjetivo, cantidadMobiliario }) {
  if (formaSala === "rectangular") {
    const resultado = colocarSala({
      tipoSalaId, catalogos: catalogosInteriores, riqueza, amueblado: "completo", semilla,
      anchoForzado: anchoObjetivo, largoForzado: largoObjetivo,
    });
    return resultado;
  }
  const forma = generarFormaOrganica({ ancho: anchoObjetivo, alto: largoObjetivo, semilla: `${semilla}:forma` });
  const colocados = colocarMobiliarioOrganico({
    ancho: forma.ancho, largo: forma.largo, mascara: forma.mascara,
    tipoSalaId, catalogos: catalogosInteriores, riqueza, semilla, cantidadObjetivo: cantidadMobiliario,
  });
  return { tipoSalaId, ancho: forma.ancho, largo: forma.largo, mascara: forma.mascara, colocados, puerta: null };
}

function seSolapan(a, b, margen) {
  return !(
    a.offsetX + a.resultado.ancho + margen <= b.offsetX ||
    b.offsetX + b.resultado.ancho + margen <= a.offsetX ||
    a.offsetY + a.resultado.largo + margen <= b.offsetY ||
    b.offsetY + b.resultado.largo + margen <= a.offsetY
  );
}

// Casilla de suelo real de una sala más cercana a un punto (x,y) del mundo —
// para organicas mira la máscara, para rectangulares cualquier casilla del
// rectángulo vale (todo el rectángulo es suelo).
function casillaMasCercanaA(sala, tx, ty) {
  const { offsetX, offsetY, resultado } = sala;
  let mejor = null, mejorDist = Infinity;
  for (let y = 0; y < resultado.largo; y++) {
    for (let x = 0; x < resultado.ancho; x++) {
      if (resultado.mascara && resultado.mascara[y * resultado.ancho + x] !== "1") continue;
      const gx = offsetX + x, gy = offsetY + y;
      const d = Math.hypot(gx - tx, gy - ty);
      if (d < mejorDist) { mejorDist = d; mejor = { x: gx, y: gy }; }
    }
  }
  return mejor;
}

// Árbol de expansión mínima (Prim) sobre los centros de las salas — conecta
// TODAS las salas con el mínimo de aristas, garantía de que se puede
// caminar de cualquier sala a cualquier otra (pedido explícito: "se puede
// caminar por todos los sitios").
function construirMST(salas) {
  if (salas.length < 2) return [];
  const centro = (s) => [s.offsetX + s.resultado.ancho / 2, s.offsetY + s.resultado.largo / 2];
  const centros = salas.map(centro);
  const enArbol = new Set([0]);
  const aristas = [];
  while (enArbol.size < salas.length) {
    let mejor = null, mejorDist = Infinity;
    for (const i of enArbol) {
      for (let j = 0; j < salas.length; j++) {
        if (enArbol.has(j)) continue;
        const d = Math.hypot(centros[i][0] - centros[j][0], centros[i][1] - centros[j][1]);
        if (d < mejorDist) { mejorDist = d; mejor = [i, j]; }
      }
    }
    if (!mejor) break;
    aristas.push(mejor);
    enArbol.add(mejor[1]);
  }
  return aristas;
}

// Profundidad BFS desde la sala 0 (la raíz con la que arranca construirMST,
// tratada aquí como "entrada") sobre las aristas de un árbol/grafo de
// salas — pedido 2026-08-31 ("salas más grandes/temáticas" según lo lejos
// que están de la entrada). 0 = la propia entrada; sube 1 por cada salto.
function bfsProfundidades(numSalas, aristas) {
  const adyacencia = Array.from({ length: numSalas }, () => []);
  for (const [i, j] of aristas) { adyacencia[i].push(j); adyacencia[j].push(i); }
  const profundidad = new Array(numSalas).fill(0);
  const visitado = new Array(numSalas).fill(false);
  if (numSalas > 0) {
    visitado[0] = true;
    const cola = [0];
    while (cola.length) {
      const actual = cola.shift();
      for (const vecino of adyacencia[actual]) {
        if (visitado[vecino]) continue;
        visitado[vecino] = true;
        profundidad[vecino] = profundidad[actual] + 1;
        cola.push(vecino);
      }
    }
  }
  return profundidad;
}

// Bucles sobre el MST (pedido 2026-08-31, idea vista en un generador de
// dungeons de Three.js ajeno — mismo algoritmo base que ya teníamos
// nosotros, room-scatter+MST, salvo que ellos reinsertan algunas aristas
// del grafo de proximidad que el MST descarta): un MST conecta TODO con el
// mínimo de corredores, o sea siempre hay un ÚNICO camino entre dos salas
// cualesquiera — nunca se puede rodear. Aquí se reinserta una fracción de
// las aristas "casi tan cortas" como la que cada sala ya usa en su propio
// MST (nunca una arista lejana/rara), con un tope proporcional al nº de
// salas para no disparar el número de corredores.
const FACTOR_CERCANIA_BUCLE = 1.4;
const PROB_BUCLE = 0.35;
const TOPE_BUCLES_POR_SALA = 0.25; // ~1 bucle extra cada 4 salas, como mucho
function elegirAristasBucle(salas, aristasMST, rnd) {
  if (salas.length < 3) return [];
  const centro = (s) => [s.offsetX + s.resultado.ancho / 2, s.offsetY + s.resultado.largo / 2];
  const centros = salas.map(centro);
  const conectados = new Set(aristasMST.map(([i, j]) => `${Math.min(i, j)}_${Math.max(i, j)}`));
  const distanciaMstPorNodo = new Map(); // nodo -> distancia de SU arista MST (referencia de "cercanía razonable" para ese nodo)
  for (const [i, j] of aristasMST) {
    const d = Math.hypot(centros[i][0] - centros[j][0], centros[i][1] - centros[j][1]);
    distanciaMstPorNodo.set(i, Math.min(distanciaMstPorNodo.get(i) ?? Infinity, d));
    distanciaMstPorNodo.set(j, Math.min(distanciaMstPorNodo.get(j) ?? Infinity, d));
  }
  const candidatas = [];
  for (let i = 0; i < salas.length; i++) {
    for (let j = i + 1; j < salas.length; j++) {
      if (conectados.has(`${i}_${j}`)) continue;
      const d = Math.hypot(centros[i][0] - centros[j][0], centros[i][1] - centros[j][1]);
      const referencia = Math.max(distanciaMstPorNodo.get(i) ?? Infinity, distanciaMstPorNodo.get(j) ?? Infinity);
      if (d <= referencia * FACTOR_CERCANIA_BUCLE) candidatas.push([i, j, d]);
    }
  }
  candidatas.sort((a, b) => a[2] - b[2]); // bucles cortos/baratos primero
  const tope = Math.max(0, Math.floor(salas.length * TOPE_BUCLES_POR_SALA));
  const elegidas = [];
  for (const [i, j] of candidatas) {
    if (elegidas.length >= tope) break;
    if (rnd() < PROB_BUCLE) elegidas.push([i, j]);
  }
  return elegidas;
}

// Corredor recto en L entre la casilla de suelo de `salaA` más cercana a
// `salaB` y viceversa — cada tile del camino se registra como puerta de
// conexión (mismo mecanismo que ya usa interiorColision.ts para despejar
// huecos entre salas, sin tocar ese código: una lista de puntos más larga
// simplemente despeja un pasillo entero en vez de una sola casilla).
function carvarCorredor(salaA, salaB) {
  const centroB = [salaB.offsetX + salaB.resultado.ancho / 2, salaB.offsetY + salaB.resultado.largo / 2];
  const centroA = [salaA.offsetX + salaA.resultado.ancho / 2, salaA.offsetY + salaA.resultado.largo / 2];
  const pA = casillaMasCercanaA(salaA, centroB[0], centroB[1]);
  const pB = casillaMasCercanaA(salaB, centroA[0], centroA[1]);
  if (!pA || !pB) return [];
  const puntos = [];
  let x = pA.x, y = pA.y;
  puntos.push({ x, y });
  while (x !== pB.x) { x += x < pB.x ? 1 : -1; puntos.push({ x, y }); }
  while (y !== pB.y) { y += y < pB.y ? 1 : -1; puntos.push({ x, y }); }
  return puntos;
}

function generarPlantaMazmorra({ nivel, rol, def, catalogosInteriores, semilla }) {
  const rnd = crearPRNG(`${semilla}:planta:${nivel}`);
  const numSalas = elegirEntero(def.rangoSalasPorPlanta, rnd);
  const riquezaMap = { humilde: "humilde", modesta: "modesta", rica: "noble" };
  const riqueza = riquezaMap[def.riquezaLoot] || "modesta";

  // lienzo compartido: bastante más grande que la suma de salas, para que
  // la colocación al azar (rechazo si se solapa) encuentre sitio sin
  // demasiados reintentos incluso con salas grandes de mazmorra
  const AREA_MEDIA_SALA = def.formaSala === "rectangular" ? 200 : 140;
  const lado = Math.max(40, Math.ceil(Math.sqrt(numSalas * AREA_MEDIA_SALA * 2.6)));

  // --- Fase de topología aproximada (pedido 2026-08-31: "salas más
  // grandes/temáticas" según lo lejos que están de la entrada) — para
  // decidir el TAMAÑO de una sala hace falta saber su profundidad en el
  // grafo de conexión, pero el grafo se construye sobre posiciones YA
  // colocadas, y las posiciones reales (más abajo) dependen del tamaño real
  // de cada sala. Se rompe el círculo con un scatter barato de cuadrados
  // del mismo tamaño medio (mismo lienzo, mismo criterio de rechazo por
  // solape) SOLO para tener centros con los que calcular MST+profundidad
  // BFS por adelantado — la colocación real de abajo puede acabar en
  // posiciones algo distintas (asumido: es una estimación de profundidad
  // para dimensionar, no la mazmorra final — MST/corredores/sala de jefe se
  // recalculan sobre las posiciones REALES más abajo).
  const ladoAprox = Math.round(Math.sqrt(AREA_MEDIA_SALA));
  const rndAprox = crearPRNG(`${semilla}:topologia:${nivel}`);
  const preliminares = [];
  for (let i = 0; i < numSalas; i++) {
    let mejorCandidata = null;
    for (let intento = 0; intento < 40; intento++) {
      const offsetX = 1 + Math.floor(rndAprox() * Math.max(1, lado - ladoAprox - 2));
      const offsetY = 1 + Math.floor(rndAprox() * Math.max(1, lado - ladoAprox - 2));
      const candidata = { resultado: { ancho: ladoAprox, largo: ladoAprox }, offsetX, offsetY };
      mejorCandidata = candidata; // si los 40 intentos solapan, la última vale igual — solo es una estimación
      if (!preliminares.some((s) => seSolapan(s, candidata, 1))) break;
    }
    preliminares.push(mejorCandidata);
  }
  const profundidadPorIndice = bfsProfundidades(preliminares.length, construirMST(preliminares));
  const profundidadMaximaAprox = Math.max(1, ...profundidadPorIndice);

  const tiposSalaCiclo = def.salasPermitidas || [];
  const salasColocadas = [];
  for (let i = 0; i < numSalas; i++) {
    const tipoSalaId = def.formaSala === "rectangular"
      ? tiposSalaCiclo[Math.floor(rnd() * tiposSalaCiclo.length)]
      : "guarida_bestia";
    const semillaSala = `${semilla}:sala:${nivel}:${i}`;
    // 0 = pegada a la entrada, 1 = el punto más profundo del grafo estimado.
    const factorProfundidad = profundidadPorIndice[i] / profundidadMaximaAprox;
    let anchoObjetivo, largoObjetivo;
    if (def.formaSala === "organica") {
      const minLado = 9 + Math.round(factorProfundidad * 4); // 9 → 13
      const maxLado = 18 + Math.round(factorProfundidad * 10); // 18 → 28
      anchoObjetivo = minLado + Math.floor(rnd() * (maxLado - minLado + 1));
      largoObjetivo = minLado + Math.floor(rnd() * (maxLado - minLado + 1));
    } else {
      // rectangular: sesga DENTRO del rango propio de tipoSalaId (nunca se
      // sale de lo que ese tipo de sala declara en tipos_sala.json) hacia
      // su máximo cuanto más profunda — antes era un tamaño al azar en todo
      // el rango, sin relación con la posición en la mazmorra.
      const defSala = catalogosInteriores.tiposSala[tipoSalaId];
      if (defSala) {
        const sesgo = Math.min(1, factorProfundidad + rnd() * 0.3); // nunca 100% determinista por profundidad — algo de variación
        anchoObjetivo = Math.round(defSala.anchoTiles[0] + (defSala.anchoTiles[1] - defSala.anchoTiles[0]) * sesgo);
        largoObjetivo = Math.round(defSala.largoTiles[0] + (defSala.largoTiles[1] - defSala.largoTiles[0]) * sesgo);
      }
    }
    let resultado;
    try {
      resultado = generarSalaMazmorra({
        formaSala: def.formaSala, tipoSalaId, catalogosInteriores, riqueza, semilla: semillaSala,
        anchoObjetivo, largoObjetivo, cantidadMobiliario: 4 + Math.floor(rnd() * 5),
      });
    } catch {
      continue; // tipo de sala mal referenciado en el catálogo: se omite esa sala, no rompe la mazmorra entera
    }

    let colocada = false;
    for (let intento = 0; intento < 80 && !colocada; intento++) {
      const offsetX = 1 + Math.floor(rnd() * Math.max(1, lado - resultado.ancho - 2));
      const offsetY = 1 + Math.floor(rnd() * Math.max(1, lado - resultado.largo - 2));
      const candidata = { resultado, offsetX, offsetY, tipoSalaId, nivel, rol, origen: "generado" };
      if (!salasColocadas.some((s) => seSolapan(s, candidata, 2))) {
        salasColocadas.push(candidata);
        colocada = true;
      }
    }
    // si no encontró hueco en 80 intentos, esa sala se omite (dungeon con
    // menos salas de las pedidas — más vale eso que un lienzo enorme y lento)
  }

  const aristasMST = construirMST(salasColocadas);
  const puertasConexion = [];
  for (const [i, j] of aristasMST) {
    for (const p of carvarCorredor(salasColocadas[i], salasColocadas[j])) puertasConexion.push(p);
  }
  // Bucles (pedido 2026-08-31, ver elegirAristasBucle más arriba): reinserta
  // algunas aristas cercanas que el MST descarta, para que no sea siempre
  // un único camino entre dos salas — rutas alternativas reales.
  for (const [i, j] of elegirAristasBucle(salasColocadas, aristasMST, rnd)) {
    for (const p of carvarCorredor(salasColocadas[i], salasColocadas[j])) puertasConexion.push(p);
  }

  // Sala principal para el conector vertical (escaleras) y slot de jefe:
  // la MÁS PROFUNDA del grafo REAL ya colocado (antes: simplemente "la más
  // grande", sin relación con la posición en la mazmorra) — empate roto por
  // área, mismo criterio de "más grande" como desempate razonable.
  const profundidadReal = bfsProfundidades(salasColocadas.length, aristasMST);
  let salaConector = null, mejorProfundidad = -1, mejorArea = -1;
  salasColocadas.forEach((sala, idx) => {
    const p = profundidadReal[idx] ?? 0;
    const area = sala.resultado.ancho * sala.resultado.largo;
    if (p > mejorProfundidad || (p === mejorProfundidad && area > mejorArea)) {
      mejorProfundidad = p; mejorArea = area; salaConector = sala;
    }
  });

  // spawns de enemigos: varios puntos por sala + 1 slot de jefe en la sala
  // más grande (docs/GDD_Bakeador_Dungeons.md §4.2 — bake coloca CANDIDATOS,
  // el servidor decide en runtime cuántos/cuáles se activan cada visita).
  // Cada punto se comprueba contra la máscara (sala orgánica) Y contra el
  // mobiliario ya colocado — sin esto un spawn podía caer encima de un
  // cofre/altar, casilla sólida real (bug real, encontrado con la prueba
  // de interiorColision.ts contra un bake real).
  const casillaLibreParaSpawn = (sala, x, y) => {
    const lx = x - sala.offsetX, ly = y - sala.offsetY;
    if (sala.resultado.mascara && sala.resultado.mascara[ly * sala.resultado.ancho + lx] !== "1") return false;
    for (const item of sala.resultado.colocados) {
      if (lx >= item.x && lx < item.x + item.ancho && ly >= item.y && ly < item.y + item.largo) return false;
    }
    return true;
  };
  const rndSpawns = crearPRNG(`${semilla}:spawns:${nivel}`);
  const spawnsEnemigos = [];
  for (const sala of salasColocadas) {
    const esSalaJefe = sala === salaConector;
    const nPuntos = 3 + Math.floor(rndSpawns() * 5);
    for (let k = 0; k < nPuntos; k++) {
      for (let intento = 0; intento < 15; intento++) {
        const x = sala.offsetX + Math.floor(rndSpawns() * sala.resultado.ancho);
        const y = sala.offsetY + Math.floor(rndSpawns() * sala.resultado.largo);
        if (!casillaLibreParaSpawn(sala, x, y)) continue;
        spawnsEnemigos.push({ x, y, temasEnemigo: def.temasEnemigo, esBossSlot: false });
        break;
      }
    }
    if (esSalaJefe) {
      let centro = casillaMasCercanaA(sala, sala.offsetX + sala.resultado.ancho / 2, sala.offsetY + sala.resultado.largo / 2);
      // el centro geométrico puede caer sobre el cofre de jefe (isMandatory,
      // se coloca ahí a propósito) — si no está libre, cualquier casilla
      // libre de la sala vale para el slot de jefe.
      if (centro && !casillaLibreParaSpawn(sala, centro.x, centro.y)) {
        centro = null;
        for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && !centro; y++) {
          for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho; x++) {
            if (casillaLibreParaSpawn(sala, x, y)) { centro = { x, y }; break; }
          }
        }
      }
      // temasEnemigo del slot de jefe: los MISMOS temas que un enemigo
      // normal de esta mazmorra (no def.bossPool — eso son IDs de enemigo
      // concretos, no temas; quien resuelve el slot en runtime, DungeonRoom,
      // filtra por tema + esBoss:true, así encuentra exactamente los jefes
      // de personajes/catalogo/enemigos.json etiquetados con estos temas —
      // bug real: pasar aquí def.bossPool hacía que el filtro por tema
      // nunca encontrara nada, el slot de jefe se quedaba siempre vacío).
      if (centro) spawnsEnemigos.push({ x: centro.x, y: centro.y, temasEnemigo: def.temasEnemigo, esBossSlot: true });
    }
  }

  return { nivel, rol, ancho: lado, alto: lado, salas: salasColocadas, salaConector, puertasConexion, spawnsEnemigos };
}

// Conector vertical entre dos plantas — MISMA lógica de búsqueda de hueco
// que interiores/src/edificio.js (huella del conector, cae en cascada a
// una más pequeña si no cabe), adaptada para respetar la máscara cuando
// la sala anfitriona es orgánica.
function buscarHuecoConectorMazmorra(sala, huella, rnd, reservas) {
  const { ancho, largo, mascara, colocados } = sala.resultado;
  const [hw, hl] = huella;
  if (hw > ancho || hl > largo) return null;
  const listaReservas = reservas.get(sala) || [];
  const libre = (x0, y0) => {
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        const cx = x0 + dx, cy = y0 + dy;
        if (mascara && mascara[cy * ancho + cx] !== "1") return false;
        for (const item of colocados) {
          if (cx >= item.x && cx < item.x + item.ancho && cy >= item.y && cy < item.y + item.largo) return false;
        }
        for (const r of listaReservas) {
          if (cx >= r.x && cx < r.x + r.ancho && cy >= r.y && cy < r.y + r.largo) return false;
        }
      }
    }
    return true;
  };
  const candidatos = [];
  for (let y = 0; y <= largo - hl; y++) for (let x = 0; x <= ancho - hw; x++) if (libre(x, y)) candidatos.push({ x, y });
  if (candidatos.length === 0) return null;
  return candidatos[Math.floor(rnd() * candidatos.length)];
}

function generarMazmorra({ tipoDungeonId, catalogosMazmorra, catalogosInteriores, semilla = "mazmorra" }) {
  const def = catalogosMazmorra.tiposDungeon[tipoDungeonId];
  if (!def) throw new Error(`tipoDungeon desconocido: ${tipoDungeonId}`);
  if (def.estiloExterior === "asentamiento") {
    throw new Error(
      `${tipoDungeonId}: estiloExterior "asentamiento" no genera interior con generarMazmorra — ` +
      `usa ciudades/hornearCiudad(def.tierAsentamiento, ...) igual que un POI aldea normal (docs/GDD_Bakeador_Dungeons.md §1).`
    );
  }

  const rndPlantas = crearPRNG(`${semilla}:numPlantas`);
  const numPlantas = elegirEntero(def.rangoPlantas, rndPlantas);
  const plantas = [];
  for (let nivel = 0; nivel < numPlantas; nivel++) {
    plantas.push(generarPlantaMazmorra({
      nivel, rol: nivel === 0 ? "planta_baja" : "planta_alta", def, catalogosInteriores, semilla,
    }));
  }

  // Conector vertical entre cada par de plantas consecutivas — mismo
  // esquema de posicionAbajo/posicionArriba+huella que interiores/edificio.js
  // (server/mundo/interiorColision.ts ya sabe leerlo, escaleras=TP intacto).
  const conectoresVerticales = [];
  const huellaEscalera = [1, 3]; // escalera_recta — mazmorra grande, huella de sobra en salas de 9+
  const rndConector = crearPRNG(`${semilla}:conectorPos`);
  const reservas = new Map();
  for (let i = 0; i < plantas.length - 1; i++) {
    const abajo = plantas[i], arriba = plantas[i + 1];
    if (!abajo.salaConector || !arriba.salaConector) continue;
    const localAbajo = buscarHuecoConectorMazmorra(abajo.salaConector, huellaEscalera, rndConector, reservas);
    const localArriba = buscarHuecoConectorMazmorra(arriba.salaConector, huellaEscalera, rndConector, reservas);
    if (!localAbajo || !localArriba) continue;
    const reservar = (sala, local) => {
      const lista = reservas.get(sala) || [];
      lista.push({ x: local.x, y: local.y, ancho: huellaEscalera[0], largo: huellaEscalera[1] });
      reservas.set(sala, lista);
      return { x: sala.offsetX + local.x, y: sala.offsetY + local.y };
    };
    conectoresVerticales.push({
      tipoConectorId: "escalera_recta",
      entreNiveles: [abajo.nivel, arriba.nivel],
      salaAbajo: abajo.salaConector.tipoSalaId,
      salaArriba: arriba.salaConector.tipoSalaId,
      posicionAbajo: reservar(abajo.salaConector, localAbajo),
      posicionArriba: reservar(arriba.salaConector, localArriba),
      huella: huellaEscalera,
    });
  }

  return {
    id: `${tipoDungeonId}_${semilla}`,
    tipoDungeonId,
    semilla,
    plantas,
    conectoresVerticales,
    origen: "generado",
  };
}

module.exports = { generarMazmorra, generarPlantaMazmorra, construirMST, carvarCorredor, bfsProfundidades, elegirAristasBucle };
