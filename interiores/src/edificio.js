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

const { colocarSala } = require("./colocarElementos");
const { crearRejilla, detectarSalas, TIPO_TILE } = require("./salas");
const { crearPRNG, elegirPonderado } = require("./azar");

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
// planta en el offset que le toque. El muro ya no es una casilla propia
// de la sala (colocarElementos.js: ancho x largo es suelo real de borde a
// borde) — aquí solo se pinta ESE suelo más la puerta propia de la sala
// (que colocarSala ya coloca un poco más allá de su propio rectángulo,
// en la fila/columna colchón). Dos salas nunca deberían pisarse: quien
// llama a esto es responsable de dejar hueco de separación entre salas
// contiguas (columna/fila sin pintar, que queda VACIO = muro implícito) y
// de punzar ahí una puerta nueva si hace falta conectar dos salas
// directamente. "La puerta gana" si por lo que sea coincide con algo ya
// pintado, para no tapar nunca un hueco ya abierto.
function pintarSalaEnPlanta(rejillaPiso, resultadoSala, offsetX, offsetY) {
  const { ancho, largo, puerta } = resultadoSala;
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) {
      const gx = offsetX + x, gy = offsetY + y;
      if (rejillaPiso.get(gx, gy) === TIPO_TILE.PUERTA) continue;
      rejillaPiso.set(gx, gy, TIPO_TILE.SUELO);
    }
  }
  rejillaPiso.set(offsetX + puerta.x, offsetY + puerta.y, TIPO_TILE.PUERTA);
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
  // superior queda a mitad del brazoA en vez de alineado arriba/abajo. El
  // muro ya no es una casilla propia de ninguno de los dos brazos (ver
  // pintarSalaEnPlanta), así que hace falta una columna de separación de
  // verdad entre ambos — la abertura ancha se punza ahí mismo, no en una
  // columna que ninguno de los dos brazos ya "traía puesta".
  const offsetXB = brazoA.ancho + 1;
  const offsetYB = Math.max(1, Math.floor(brazoA.largo * 0.4));

  // +1 de margen vertical: la puerta propia de cada brazo cae una fila
  // por debajo de su propio rectángulo (colocarElementos.js), hace falta
  // sitio en la rejilla para esa fila aunque sea la sala más alta de las
  // dos.
  const anchoTotal = offsetXB + brazoB.ancho;
  const altoTotal = Math.max(brazoA.largo, offsetYB + brazoB.largo) + 1;
  const rejilla = crearRejilla(anchoTotal, altoTotal, TIPO_TILE.VACIO);

  pintarSalaEnPlanta(rejilla, brazoA, 0, 0);
  pintarSalaEnPlanta(rejilla, brazoB, offsetXB, offsetYB);

  // Abertura ancha en la columna de separación: todas las filas donde se
  // solapan verticalmente los dos brazos, con un margen de 1 casilla en
  // cada extremo (si el solape da para ello) para que no sea una abertura
  // muro a muro — así se lee como un hueco real entre las dos alas, no
  // una puerta de una sola casilla.
  const colX = offsetXB - 1;
  const inicioSolape = Math.max(0, offsetYB);
  const finSolape = Math.min(brazoA.largo - 1, offsetYB + brazoB.largo - 1);
  const margen = finSolape - inicioSolape + 1 >= 3 ? 1 : 0;
  for (let gy = inicioSolape + margen; gy <= finSolape - margen; gy++) {
    rejilla.set(colX, gy, TIPO_TILE.PUERTA);
  }

  const salasDetectadas = detectarSalas(rejilla);
  const salaA = salasDetectadas.find((s) => s.tiles.has("0_0"));
  const salaB = salasDetectadas.find((s) => s.tiles.has(`${offsetXB}_${offsetYB}`));

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
function generarPlanta({ nivel, rol, salasPonderadas, catalogos, riqueza, amueblado, semilla, temaProfesion }) {
  const rnd = crearPRNG(`${semilla}:planta:${nivel}`);
  const n = elegirNumeroSalas(salasPonderadas.length, riqueza, rnd);

  const tipoSalaIds = [];
  for (let i = 0; i < n; i++) tipoSalaIds.push(elegirPonderado(salasPonderadas, rnd));

  // El pasillo (si sale sorteado) siempre actúa de columna vertebral —
  // se genera aparte, con el ancho exacto de la fila que soporta.
  const idxPasillo = tipoSalaIds.findIndex((id) => catalogos.tiposSala[id]?.esPasillo);
  const idsFila = idxPasillo === -1 ? tipoSalaIds : tipoSalaIds.filter((_, i) => i !== idxPasillo);

  // Ventanas (GDD_Bakeador_Interiores §7bis): nunca en bodega (sin fachada
  // real, bajo tierra) — el resto de la fila sí, es el layout normal.
  const permiteVentanas = rol !== "bodega";
  const salasFila = idsFila.map((tipoSalaId, i) =>
    colocarSala({ tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:${nivel}:${i}`, temaProfesion, permiteVentanas })
  );

  // El muro ya no es una casilla propia de cada sala (colocarElementos.js:
  // ancho x largo es suelo real de borde a borde), así que dos salas
  // contiguas en la fila necesitan una columna de separación de verdad
  // entre ellas — de ahí el "+1" por cada hueco entre salas, tanto si hay
  // pasillo (esa columna se queda como muro, cada sala se conecta al
  // pasillo por su cuenta) como si no (ahí se punza la puerta que las une
  // directamente).
  const numHuecosFila = Math.max(0, salasFila.length - 1);
  const anchoTotal = salasFila.reduce((s, r) => s + r.ancho, 0) + numHuecosFila;
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
      // su muro norte da a la fila de salas de encima (por donde entra cada
      // puerta), no a fuera — sin ventana aquí, a diferencia de una sala normal.
      permiteVentanas: false,
    });
  }

  // Con pasillo, se deja una fila de separación de verdad entre la fila de
  // salas y el pasillo (ya no hay muro compartido que fusionar): la puerta
  // propia de cada sala (que cae justo en esa fila, un paso más allá de su
  // propio rectángulo) es la que conecta con el suelo del pasillo justo
  // debajo — no hace falta punzar ninguna puerta nueva ahí.
  const anchoPlanta = pasillo ? Math.max(anchoTotal, pasillo.ancho) : anchoTotal;
  const altoPlanta = pasillo ? altoFila + 1 + pasillo.largo : altoFila;
  // +1 de margen: la puerta de la última sala/el pasillo cae una fila más
  // allá de su propio rectángulo, hace falta sitio en la rejilla para eso.
  const rejillaPiso = crearRejilla(Math.max(anchoPlanta, 4), Math.max(altoPlanta, 4) + 1, TIPO_TILE.VACIO);

  const salasColocadas = [];
  // Casillas de puerta REALES de esta planta, en coordenadas de planta —
  // sección añadida porque ni el hueco entre dos salas en fila (sin
  // pasillo) ni la puerta propia de cada sala hacia el pasillo quedaban
  // guardados en ningún sitio: colocarSala.puerta cae SIEMPRE una fila
  // más allá del rectángulo de la sala (server/mundo/interiorColision.js
  // y el render del cliente necesitan esto para que las salas queden
  // conectadas de verdad, no solo dibujadas una junto a otra).
  const puertasConexion = [];
  let cursorX = 0;

  for (let i = 0; i < salasFila.length; i++) {
    const r = salasFila[i];
    const offsetY = altoFila - r.largo; // alineadas por el muro sur, igual que la fila entera toca el pasillo
    if (i > 0) cursorX += 1; // columna de separación con la sala anterior, siempre
    pintarSalaEnPlanta(rejillaPiso, r, cursorX, offsetY);
    // la puerta propia de la sala (colocarSala.js) cae siempre en
    // offsetY+largo, una fila más allá de su rectángulo — hacia el
    // pasillo si lo hay, o hacia la fila de margen si no
    puertasConexion.push({ x: cursorX + r.puerta.x, y: offsetY + r.puerta.y });
    if (i > 0 && !pasillo) {
      // Sin pasillo: la única conexión entre esta sala y la anterior es
      // esta puerta punzada a mano en la columna de separación — el único
      // caso donde de verdad hace falta inventar una puerta que
      // colocarSala no trajera ya (con pasillo, cada sala se conecta a
      // ÉL por su cuenta, no directamente con la de al lado).
      rejillaPiso.set(cursorX - 1, altoFila - 1, TIPO_TILE.PUERTA);
      puertasConexion.push({ x: cursorX - 1, y: altoFila - 1 });
    }
    salasColocadas.push({ resultado: r, offsetX: cursorX, offsetY, tipoSalaId: r.tipoSalaId, nivel, rol, origen: "generado" });
    cursorX += r.ancho;
  }

  let conectorPasillo = null;
  if (pasillo) {
    const offsetYPasillo = altoFila + 1;
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
    const puntoInterior = `${s.offsetX}_${s.offsetY}`;
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

  return { nivel, rol, ancho: rejillaPiso.ancho, alto: rejillaPiso.alto, salas: salasColocadas, salaConector, puertasConexion };
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

  // `temaTaller` (opcional, tipos_edificio.json): qué oficio es este
  // edificio de verdad (herrería, curtiduría, botica...) — todos comparten
  // el mismo tipo de sala genérico "taller"/"lonja", así que sin esto el
  // motor no tenía forma de saber que una curtiduría no debería llenarse
  // con la fragua de un herrero. Se reparte a TODAS las plantas del
  // edificio; colocarSala lo ignora sin problema en cualquier sala que no
  // tenga mobiliario etiquetado por oficio (dormitorios, almacenes...).
  const plantas = plantasAGenerar.map(({ nivel, rol }) =>
    generarPlanta({
      nivel,
      rol,
      salasPonderadas: defEdificio.salasPorPlanta[rol],
      catalogos,
      riqueza: riquezaFinal,
      amueblado,
      semilla,
      temaProfesion: defEdificio.temaTaller,
    })
  );

  // Conector vertical entre cada par de plantas consecutivas — además del
  // metadato de qué sala de cada planta lo aloja (sección 7 del GDD:
  // plantas independientes, sin continuidad XY real), aquí se le busca una
  // CASILLA REAL dentro de esa sala (posicionAbajo/posicionArriba, en
  // coordenadas de la rejilla de esa planta) para que el servidor pueda
  // tratarlo como un portal más (pisar/interactuar cambia de planta) y el
  // cliente pinte un marcador en el sitio correcto — antes solo se sabía
  // "en qué sala", no "en qué tile", así que no había dónde enganchar ni
  // la colisión ni el render.
  const conectoresVerticales = [];
  const conectorPreferido = pickConector(catalogos, riquezaFinal);
  // Candidatos por orden de preferencia: el conector "de catálogo" primero
  // (más vistoso, según riqueza) y, si su huella no cabe en la sala que le
  // toca (habitación pequeña, ya llena de muebles), caer a huellas cada vez
  // más pequeñas — SIN esto, una planta sin hueco para la escalera se
  // quedaba sin conector y por tanto sin forma de subir/bajar a ella (bug
  // real: un castillo de 4 plantas sacó solo 2 de los 3 conectores que
  // necesitaba). trampilla/escalera_vertical (huella 1x1) son el último
  // recurso: casi cualquier sala tiene una casilla suelta.
  const candidatosConector = [...new Set([conectorPreferido, "escalera_vertical", "trampilla"])].filter(
    (id) => catalogos.conectores?.[id],
  );
  const rndConector = crearPRNG(`${semilla}:conectorPos`);
  // Una sala "pasillo"/vestíbulo compartida entre dos tramos consecutivos
  // (p.ej. planta baja→alta y alta→más alta) puede necesitar alojar DOS
  // conectores distintos — sin llevar la cuenta de lo ya ocupado, el
  // segundo podía caer encima del primero o de un mueble ya reservado.
  const reservasPorSala = new Map();
  for (let i = 0; i < plantas.length - 1; i++) {
    const abajo = plantas[i], arriba = plantas[i + 1];
    if (!abajo.salaConector || !arriba.salaConector) continue;

    let elegido = null;
    for (const tipoConectorId of candidatosConector) {
      const huella = catalogos.conectores[tipoConectorId].huella;
      const localAbajo = buscarHuecoConector(abajo.salaConector, huella, rndConector, reservasPorSala);
      const localArriba = buscarHuecoConector(arriba.salaConector, huella, rndConector, reservasPorSala);
      if (!localAbajo || !localArriba) continue; // no hay hueco en alguna de las dos salas con esta huella: probar una más pequeña
      elegido = {
        tipoConectorId,
        huella,
        posicionAbajo: reservarConector(abajo.salaConector, localAbajo, huella, reservasPorSala),
        posicionArriba: reservarConector(arriba.salaConector, localArriba, huella, reservasPorSala),
      };
      break;
    }
    if (!elegido) continue; // ni con la huella mínima hay sitio: sin TP entre estas dos plantas (caso extremo, no debería pasar)

    conectoresVerticales.push({
      tipoConectorId: elegido.tipoConectorId,
      entreNiveles: [abajo.nivel, arriba.nivel],
      salaAbajo: abajo.salaConector.tipoSalaId,
      salaArriba: arriba.salaConector.tipoSalaId,
      posicionAbajo: elegido.posicionAbajo,
      posicionArriba: elegido.posicionArriba,
      huella: elegido.huella,
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

// Busca una casilla libre (sin muebles, sin la puerta propia de la sala,
// sin otro conector ya reservado en esta misma sala) del tamaño de la
// huella dada, dentro del rectángulo de `sala`. Devuelve coordenadas
// LOCALES (relativas a la sala) o null si no cabe — de solo lectura, no
// reserva nada: el llamador puede probar varias huellas candidatas antes
// de comprometerse con una (reservarConector). Determinista por `rnd`
// (mismo PRNG del edificio) para no romper "misma semilla = mismo resultado".
function buscarHuecoConector(sala, huella, rnd, reservasPorSala) {
  const { ancho, largo, puerta, colocados } = sala.resultado;
  const [hw, hl] = huella;
  if (hw > ancho || hl > largo) return null;
  const reservas = reservasPorSala.get(sala) || [];

  const libre = (x0, y0) => {
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        const cx = x0 + dx, cy = y0 + dy;
        if (cx === puerta.x && cy === puerta.y) return false;
        for (const item of colocados) {
          if (cx >= item.x && cx < item.x + item.ancho && cy >= item.y && cy < item.y + item.largo) return false;
        }
        for (const r of reservas) {
          if (cx >= r.x && cx < r.x + r.ancho && cy >= r.y && cy < r.y + r.largo) return false;
        }
      }
    }
    return true;
  };

  const candidatos = [];
  for (let y = 0; y <= largo - hl; y++) {
    for (let x = 0; x <= ancho - hw; x++) {
      if (libre(x, y)) candidatos.push({ x, y });
    }
  }
  if (candidatos.length === 0) return null;
  return candidatos[Math.floor(rnd() * candidatos.length)];
}

// Compromete un hueco ya encontrado por buscarHuecoConector: lo marca
// reservado (para que otro conector en la misma sala no lo pise) y
// devuelve su posición GLOBAL en la rejilla de la planta (offsetX/offsetY
// + local).
function reservarConector(sala, local, huella, reservasPorSala) {
  const [hw, hl] = huella;
  const reservas = reservasPorSala.get(sala) || [];
  reservas.push({ x: local.x, y: local.y, ancho: hw, largo: hl });
  reservasPorSala.set(sala, reservas);
  return { x: sala.offsetX + local.x, y: sala.offsetY + local.y };
}

function pickConector(catalogos, riqueza) {
  const ids = Object.keys(catalogos.conectores || {}).filter((k) => !k.startsWith("_"));
  if (ids.length === 0) return null;
  // preferencia simple: escalera_recta si existe, si no la primera del catálogo
  return ids.includes("escalera_recta") ? "escalera_recta" : ids[0];
}

module.exports = { generarEdificio, generarPlanta, generarHabitacionCompuestaL, elegirNumeroSalas };
