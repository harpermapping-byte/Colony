"use strict";

// Composición Edificio → Piso → Habitación (sección 1/2 del pedido de
// edificios/editor) — NO reescribe colocarSala ni salas.js, los llama
// varias veces y compone el resultado en un plano de planta compartido.
// Cada habitación sigue siendo la misma Sala rectangular ya validada; lo
// nuevo aquí es solo "dónde cae cada una dentro de la planta" y "qué
// puerta conecta cuál con cuál".
//
// Estrategia de layout (una sola, fiable, no una colección de heurísticas):
// - Si la planta incluye un `pasillo` (tipos_sala.pasillo, esPasillo:true),
//   las demás habitaciones de esa planta se ponen en fila justo encima,
//   alineadas por el muro sur — el pasillo se genera con el ancho exacto
//   de esa fila (anchoForzado), así la puerta sur que CADA habitación ya
//   trae de fábrica cae literalmente sobre el muro norte del pasillo: se
//   reutiliza la puerta que colocarSala ya coloca, no se inventa una
//   segunda. El pasillo actúa de columna vertebral de la planta.
// - Si no hay pasillo, las habitaciones se ponen en fila compartiendo un
//   muro vertical (solapando una columna), y se abre una puerta nueva en
//   esa columna compartida — el único caso donde de verdad hace falta una
//   puerta que colocarSala no traía ya.
// - Entre plantas no hay continuidad XY real — mismo modelo que ya declara
//   el GDD ("pila de plantas independientes conectadas por huecos de
//   escalera/trampilla"): cada planta solo guarda en qué sala y tile cae
//   el conector de subida/bajada.

const { colocarSala, crearPRNG } = require("./colocarElementos");
const { crearRejilla, detectarSalas, TIPO_TILE } = require("./salas");

function elegirPonderado(lista, rnd) {
  const total = lista.reduce((s, [, peso]) => s + peso, 0);
  let tirada = rnd() * total;
  for (const [id, peso] of lista) {
    tirada -= peso;
    if (tirada <= 0) return id;
  }
  return lista[lista.length - 1][0];
}

// Cuántas salas le tocan a una planta — variación real (sección 12): la
// misma semilla siempre da el mismo edificio, otra semilla da otra mezcla
// de tamaño/nº de salas, pero acotada a un rango razonable según cuántos
// tipos de sala distintos hay disponibles en esa planta y la riqueza.
function elegirNumeroSalas(disponibles, riqueza, rnd) {
  const base = riqueza === "noble" ? [3, 5] : riqueza === "modesta" ? [2, 4] : [2, 3];
  const tope = Math.min(base[1], disponibles + 2);
  const min = Math.min(base[0], tope);
  return min + Math.floor(rnd() * (tope - min + 1));
}

// Pinta una Sala ya resuelta (ancho/largo/puerta) sobre la rejilla de la
// planta en el offset que le toque. `puertasExtraLocales` son huecos de
// puerta adicionales (sección "sin pasillo" de más arriba) que colocarSala
// no puso por su cuenta. Unión con "la puerta gana": si dos salas pintan
// la misma casilla global (fila/columna compartida a propósito), un hueco
// de puerta nunca se pisa por un muro.
function pintarSalaEnPlanta(rejillaPiso, resultadoSala, offsetX, offsetY, puertasExtraLocales = []) {
  const { ancho, largo, puerta } = resultadoSala;
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) {
      const esBorde = x === 0 || y === 0 || x === ancho - 1 || y === largo - 1;
      const esPuertaPropia = x === puerta.x && y === puerta.y;
      const esPuertaExtra = puertasExtraLocales.some(([ex, ey]) => ex === x && ey === y);
      let tipo;
      if (esPuertaPropia || esPuertaExtra) tipo = TIPO_TILE.PUERTA;
      else if (esBorde) tipo = TIPO_TILE.PARED;
      else tipo = TIPO_TILE.SUELO;

      const gx = offsetX + x, gy = offsetY + y;
      const actual = rejillaPiso.get(gx, gy);
      if (actual === TIPO_TILE.PUERTA) continue; // la puerta ya pintada gana, nunca se tapa con muro
      if (actual === TIPO_TILE.SUELO && tipo === TIPO_TILE.PARED) continue; // no degradar suelo ya pintado
      rejillaPiso.set(gx, gy, tipo);
    }
  }
}

// Habitación NO rectangular (sección 3 del pedido): un "brazo" en L hecho
// de dos salas rectangulares reales (mismo motor, sin tocarlo) unidas por
// una abertura ANCHA — varias celdas de puerta seguidas en vez de una
// sola — en su muro compartido. No es WFC (eso sigue pendiente, GDD
// sección 2) ni pretende serlo: es la misma técnica de fusión de
// `generarPlanta` (pintarSalaEnPlanta + detectarSalas), aplicada para que
// dos rectángulos se lean como un único espacio en forma de L cuando
// tiene sentido (gran salón, sala de comercio grande...), en vez de forzar
// siempre un rectángulo simple.
function generarHabitacionCompuestaL({ tipoSalaId, catalogos, riqueza, amueblado, semilla, tipoSalaIdBrazoB }) {
  const brazoA = colocarSala({ tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:L:A` });
  const brazoB = colocarSala({ tipoSalaId: tipoSalaIdBrazoB || tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:L:B` });

  // brazoB cuelga del muro este de brazoA, desplazado hacia abajo para que
  // el conjunto lea como una L (no como dos salas en fila): su borde
  // superior queda a mitad del brazoA en vez de alineado arriba/abajo.
  const offsetXB = brazoA.ancho - 1; // solapa 1 columna, misma fusión que generarPlanta
  const offsetYB = Math.max(1, Math.floor(brazoA.largo * 0.4));

  const anchoTotal = offsetXB + brazoB.ancho;
  const altoTotal = Math.max(brazoA.largo, offsetYB + brazoB.largo);
  const rejilla = crearRejilla(anchoTotal, altoTotal, TIPO_TILE.VACIO);

  pintarSalaEnPlanta(rejilla, brazoA, 0, 0);

  // Abertura ancha en la columna compartida: todas las filas interiores
  // de brazoB que caen dentro del rango vertical de brazoA, no solo una
  // — así se ve como un hueco real entre las dos alas, no una puerta.
  const puertasAnchas = [];
  for (let y = 1; y < brazoB.largo - 1; y++) {
    const globalY = offsetYB + y;
    if (globalY >= 1 && globalY <= brazoA.largo - 2) puertasAnchas.push([0, y]);
  }
  pintarSalaEnPlanta(rejilla, brazoB, offsetXB, offsetYB, puertasAnchas);

  const salasDetectadas = detectarSalas(rejilla);
  const salaA = salasDetectadas.find((s) => s.tiles.has("1_1"));
  const salaB = salasDetectadas.find((s) => s.tiles.has(`${offsetXB + 1}_${offsetYB + 1}`));

  return {
    tipo: "compuestaL",
    ancho: anchoTotal,
    alto: altoTotal,
    brazos: [
      { resultado: brazoA, offsetX: 0, offsetY: 0, salaPlanta: salaA },
      { resultado: brazoB, offsetX: offsetXB, offsetY: offsetYB, salaPlanta: salaB },
    ],
    origen: "generado",
  };
}

// Genera y coloca todas las salas de UNA planta (rol: "bodega"/"planta_baja"/
// "planta_alta"), devolviendo el plano de esa planta con cada sala ya
// posicionada y las puertas de conexión reales entre salas contiguas.
function generarPlanta({ nivel, rol, salasPonderadas, catalogos, riqueza, amueblado, semilla }) {
  const rnd = crearPRNG(`${semilla}:planta:${nivel}`);
  const n = elegirNumeroSalas(salasPonderadas.length, riqueza, rnd);

  const tipoSalaIds = [];
  for (let i = 0; i < n; i++) tipoSalaIds.push(elegirPonderado(salasPonderadas, rnd));

  // El pasillo (si sale sorteado) siempre actúa de columna vertebral —
  // se genera aparte, con el ancho exacto de la fila que soporta.
  const idxPasillo = tipoSalaIds.findIndex((id) => catalogos.tiposSala[id]?.esPasillo);
  const idsFila = idxPasillo === -1 ? tipoSalaIds : tipoSalaIds.filter((_, i) => i !== idxPasillo);

  const salasFila = idsFila.map((tipoSalaId, i) =>
    colocarSala({ tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:${nivel}:${i}` })
  );

  const anchoTotal = salasFila.reduce((s, r) => s + r.ancho, 0);
  const altoFila = Math.max(...salasFila.map((r) => r.largo), 4);

  let pasillo = null;
  if (idxPasillo !== -1) {
    pasillo = colocarSala({
      tipoSalaId: tipoSalaIds[idxPasillo],
      catalogos,
      riqueza,
      amueblado,
      semilla: `${semilla}:${nivel}:pasillo`,
      anchoForzado: Math.max(4, anchoTotal),
      largoForzado: 4,
    });
  }

  // Con pasillo, su muro norte comparte la MISMA fila global que el muro
  // sur (con puerta) de las salas de encima — por eso resta 1, no suma: es
  // la fila que se fusiona, no una fila nueva aparte.
  const anchoPlanta = pasillo ? Math.max(anchoTotal, pasillo.ancho) : anchoTotal;
  const altoPlanta = pasillo ? altoFila - 1 + pasillo.largo : altoFila;
  const rejillaPiso = crearRejilla(Math.max(anchoPlanta, 4), Math.max(altoPlanta, 4), TIPO_TILE.VACIO);

  const salasColocadas = [];
  let cursorX = 0;

  for (let i = 0; i < salasFila.length; i++) {
    const r = salasFila[i];
    const offsetY = altoFila - r.largo; // alineadas por el muro sur, igual que la fila entera toca el pasillo
    if (!pasillo && i > 0) {
      // Sin pasillo: la sala anterior y esta comparten UNA columna (se
      // solapan 1 tile a propósito) y ahí se abre una puerta nueva — el
      // único caso donde hace falta inventar una puerta que colocarSala
      // no trajera ya.
      cursorX -= 1; // solapa con el muro este de la sala anterior
    }
    const puertasExtra = i > 0 && !pasillo ? [[0, r.largo - 2]] : [];
    pintarSalaEnPlanta(rejillaPiso, r, cursorX, offsetY, puertasExtra);
    salasColocadas.push({ resultado: r, offsetX: cursorX, offsetY, tipoSalaId: r.tipoSalaId, nivel, rol, origen: "generado" });
    cursorX += r.ancho;
  }

  let conectorPasillo = null;
  if (pasillo) {
    const offsetYPasillo = altoFila - 1; // su muro norte se fusiona con el muro sur (con puerta) de la fila de arriba
    pintarSalaEnPlanta(rejillaPiso, pasillo, 0, offsetYPasillo);
    salasColocadas.push({ resultado: pasillo, offsetX: 0, offsetY: offsetYPasillo, tipoSalaId: pasillo.tipoSalaId, nivel, rol, esPasillo: true, origen: "generado" });
    conectorPasillo = salasColocadas[salasColocadas.length - 1];
  }

  // Sala-planta real por flood-fill (reutiliza salas.js sin tocarlo): cada
  // habitación pintada queda como su propia región de suelo conectada;
  // las puertas compartidas aparecen en el conjunto `puertas` de las DOS
  // salas vecinas — eso ya es, por definición, la conexión entre ambas.
  const salasDetectadas = detectarSalas(rejillaPiso);
  for (const s of salasColocadas) {
    const puntoInterior = `${s.offsetX + 1}_${s.offsetY + 1}`;
    s.salaPlanta = salasDetectadas.find((sd) => sd.tiles.has(puntoInterior)) || null;
  }

  // Sala "principal" de la planta para colgar el conector vertical
  // (escalera/trampilla) — preferir el pasillo, si no el vestíbulo/sala
  // común, si no la primera sala generada.
  const salaConector =
    conectorPasillo ||
    salasColocadas.find((s) => ["vestibulo", "sala_comun", "gran_salon"].includes(s.tipoSalaId)) ||
    salasColocadas[0] ||
    null;

  return { nivel, rol, ancho: rejillaPiso.ancho, alto: rejillaPiso.alto, salas: salasColocadas, salaConector };
}

// Punto de entrada: genera un edificio completo (todas sus plantas) a
// partir de un tipoEdificio del catálogo — sección 2 del pedido. Misma
// semilla = mismo edificio siempre (variación real solo al cambiar la
// semilla, sección 12), coherente con el resto del bakeador.
function generarEdificio({ tipoEdificioId, catalogos, semilla = "edificio", riqueza, amueblado = "completo" }) {
  const defEdificio = catalogos.tiposEdificio[tipoEdificioId];
  if (!defEdificio) throw new Error(`tipoEdificio desconocido: ${tipoEdificioId}`);

  const riquezaFinal = riqueza || defEdificio.riqueza || "modesta";
  const rnd = crearPRNG(`${semilla}:plantasAltas`);
  const [minAltas, maxAltas] = defEdificio.rangoPlantasAltas || [0, 0];
  const numPlantasAltas = minAltas + Math.floor(rnd() * (maxAltas - minAltas + 1));

  const plantasAGenerar = [];
  if (defEdificio.tieneBodega && defEdificio.salasPorPlanta.bodega) {
    plantasAGenerar.push({ nivel: -1, rol: "bodega" });
  }
  if (defEdificio.salasPorPlanta.planta_baja) {
    plantasAGenerar.push({ nivel: 0, rol: "planta_baja" });
  }
  for (let i = 1; i <= numPlantasAltas; i++) {
    if (defEdificio.salasPorPlanta.planta_alta) plantasAGenerar.push({ nivel: i, rol: "planta_alta" });
  }

  const plantas = plantasAGenerar.map(({ nivel, rol }) =>
    generarPlanta({
      nivel,
      rol,
      salasPonderadas: defEdificio.salasPorPlanta[rol],
      catalogos,
      riqueza: riquezaFinal,
      amueblado,
      semilla,
    })
  );

  // Conector vertical entre cada par de plantas consecutivas — solo
  // metadato de a qué sala/tile de cada planta se engancha (sección 7 del
  // GDD: plantas independientes, sin continuidad XY real).
  const conectoresVerticales = [];
  const conector = pickConector(catalogos, riquezaFinal);
  for (let i = 0; i < plantas.length - 1; i++) {
    const abajo = plantas[i], arriba = plantas[i + 1];
    if (!abajo.salaConector || !arriba.salaConector) continue;
    conectoresVerticales.push({
      tipoConectorId: conector,
      entreNiveles: [abajo.nivel, arriba.nivel],
      salaAbajo: abajo.salaConector.tipoSalaId,
      salaArriba: arriba.salaConector.tipoSalaId,
    });
  }

  return {
    id: `${tipoEdificioId}_${semilla}`,
    tipoEdificioId,
    semilla,
    riqueza: riquezaFinal,
    amueblado,
    materialesPreferidos: defEdificio.materialesPreferidos || [],
    plantas,
    conectoresVerticales,
    origen: "generado",
  };
}

function pickConector(catalogos, riqueza) {
  const ids = Object.keys(catalogos.conectores || {}).filter((k) => !k.startsWith("_"));
  if (ids.length === 0) return null;
  // preferencia simple: escalera_recta si existe, si no la primera del catálogo
  return ids.includes("escalera_recta") ? "escalera_recta" : ids[0];
}

module.exports = { generarEdificio, generarPlanta, generarHabitacionCompuestaL, elegirPonderado, elegirNumeroSalas };
