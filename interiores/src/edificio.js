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
// - Si no hay pasillo, las habitaciones se empaquetan en 2D tipo BSP
//   (interiores/src/bsp.js) en vez de una fila 1D — con 3-5 salas y sin
//   columna vertebral, una fila sola dejaba a cada sala como mucho 2
//   vecinas reales y siempre la misma silueta alargada. Cada par que queda
//   realmente pegado (hueco de 1 casilla + solape real) recibe una puerta
//   real de verdad — puertas múltiples por sala, no solo la que colocarSala
//   ya trae de fábrica.
// - Entre plantas no hay continuidad XY real — mismo modelo que ya declara
//   el GDD ("pila de plantas independientes conectadas por huecos de
//   escalera/trampilla"): cada planta solo guarda en qué sala y tile cae
//   el conector de subida/bajada.

const { colocarSala } = require("./colocarElementos");
const { crearRejilla, detectarSalas, TIPO_TILE } = require("./salas");
const { crearPRNG, elegirPonderado, barajar } = require("./azar");
const { empaquetarBSP, paresAdyacentes } = require("./bsp");

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
  const { ancho, largo, puerta, mascara } = resultadoSala;
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) {
      // mascara (catalogo/formasSala.json, string 'ancho*largo' de '1'/'0'):
      // sala de plantilla no rectangular — solo su suelo real se pinta en
      // la planta, el resto de la caja delimitadora se queda VACIO (muro
      // implícito, igual que el margen de separación entre dos salas
      // vecinas) en vez de rellenarse a rectángulo completo.
      if (mascara && mascara[y * ancho + x] !== "1") continue;
      const gx = offsetX + x, gy = offsetY + y;
      if (rejillaPiso.get(gx, gy) === TIPO_TILE.PUERTA) continue;
      rejillaPiso.set(gx, gy, TIPO_TILE.SUELO);
    }
  }
  rejillaPiso.set(offsetX + puerta.x, offsetY + puerta.y, TIPO_TILE.PUERTA);
}

// Casillas de PUERTA reales para un par ya adyacente de `bsp.js`
// (paresAdyacentes) — misma técnica de "abertura ancha" que ya usa
// generarHabitacionCompuestaL: recorta 1 casilla de margen en cada extremo
// del solape si da para ello (>= 3 casillas), para que no sea una abertura
// muro a muro.
function tilesDePuerta({ eje, limite, inicio, fin }) {
  const finInclusive = fin - 1;
  const margen = fin - inicio >= 3 ? 1 : 0;
  const tiles = [];
  for (let coord = inicio + margen; coord <= finInclusive - margen; coord++) {
    tiles.push(eje === "h" ? { x: limite, y: coord } : { x: coord, y: limite });
  }
  return tiles;
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
  // formaSalaForzada:"rectangulo" en los DOS brazos: esta función ya
  // construye su propia L fusionando dos rectángulos por una abertura
  // ancha (algoritmo previo al catálogo de plantillas de forma,
  // catalogo/formasSala.json) — si un brazo saliera ADEMÁS con su propia
  // plantilla no rectangular (p.ej. gran_salon es categoría "civico",
  // elegible), la columna de separación entre los dos brazos podría dejar
  // de tener suelo real a un lado, encogiendo o rompiendo la abertura que
  // este algoritmo calcula asumiendo un rectángulo completo en el borde
  // compartido.
  const brazoA = colocarSala({ tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:L:A`, formaSalaForzada: "rectangulo" });
  const brazoB = colocarSala({ tipoSalaId: tipoSalaIdBrazoB || tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:L:B`, formaSalaForzada: "rectangulo" });

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

  // Punto de anclaje para encontrar cada brazo en la lista de salas
  // detectadas: la celda de suelo pegada a su propia puerta (offsetX+puerta.x,
  // offsetY+brazo.largo-1) — SIEMPRE suelo real por construcción
  // (mascaraValida en formasSala.js exige suelo en la fila de la puerta),
  // a diferencia de la esquina superior-izquierda del rectángulo (0,0), que
  // con una plantilla no rectangular puede caer fuera de la máscara.
  const salasDetectadas = detectarSalas(rejilla);
  const salaA = salasDetectadas.find((s) => s.tiles.has(`${brazoA.puerta.x}_${brazoA.largo - 1}`));
  const salaB = salasDetectadas.find((s) => s.tiles.has(`${offsetXB + brazoB.puerta.x}_${offsetYB + brazoB.largo - 1}`));

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

// Nunca llevan ventana (tipos_sala.json ya lo documenta): bodega/cripta
// cuentan como bajo tierra aunque la cripta no sea el sótano principal del
// edificio.
const SALAS_SIN_VENTANA = new Set(["bodega", "cripta"]);

// Ventanas (GDD_Bakeador_Interiores sección 7): post-pasada sobre la
// rejilla YA compuesta de la planta — colocarSala, por diseño, no sabe qué
// pared de SU sala da al exterior del edificio y cuál a otra sala/pasillo;
// esa información solo existe una vez compuesta la planta entera, así que
// esto tiene que ir aquí y no dentro de colocarSala. Densidad moderada
// (aprox 1 de cada 3 casillas elegibles por muro), no una pared entera de
// cristal — determinista por semilla, PRNG propio (no perturba el `rnd` de
// ninguna sala). Estructural únicamente (marca TIPO_TILE.VENTANA en la
// rejilla, así sala.ventanas deja de estar siempre vacío) — la ventana
// combinatoria completa (forma×tamaño×marco×cristal con aporteLuz, sección
// 7bis) sigue siendo trabajo futuro del bakeador de estructura, sin
// consumidor todavía en cliente/servidor.
function anadirVentanas(rejillaPiso, salasColocadas, nivel, semilla) {
  if (nivel < 0) return; // sótano/bodega: nunca ventana
  const rndVentanas = crearPRNG(`${semilla}:${nivel}:ventanas`);
  for (const s of salasColocadas) {
    if (SALAS_SIN_VENTANA.has(s.tipoSalaId) || s.esPasillo) continue;
    const { offsetX, offsetY, resultado } = s;
    const { ancho, largo, puerta, bordesOcupados: bo } = resultado;
    const bordesOcupados = new Set(bo || []);
    const esPuertaPropia = (x, y) => x === puerta.x && y === puerta.y;
    const lados = {
      norte: Array.from({ length: ancho }, (_, x) => ({ x, y: 0, gx: offsetX + x, gy: offsetY - 1 })),
      sur: Array.from({ length: ancho }, (_, x) => ({ x, y: largo - 1, gx: offsetX + x, gy: offsetY + largo })),
      oeste: Array.from({ length: largo }, (_, y) => ({ x: 0, y, gx: offsetX - 1, gy: offsetY + y })),
      este: Array.from({ length: largo }, (_, y) => ({ x: ancho - 1, y, gx: offsetX + ancho, gy: offsetY + y })),
    };
    for (const tiles of Object.values(lados)) {
      const elegibles = tiles.filter(
        (c) =>
          !esPuertaPropia(c.x, c.y) &&
          !bordesOcupados.has(`${c.x}_${c.y}`) &&
          rejillaPiso.get(c.gx, c.gy) === TIPO_TILE.VACIO && // el otro lado tiene que ser exterior de verdad, nunca otra sala
          rejillaPiso.get(offsetX + c.x, offsetY + c.y) === TIPO_TILE.SUELO, // no pisar una puerta de conexión ya punzada ahí
      );
      if (elegibles.length === 0) continue;
      const objetivo = Math.min(elegibles.length, Math.max(1, Math.floor(elegibles.length / 3)));
      const elegidos = barajar(elegibles, rndVentanas).slice(0, objetivo);
      for (const c of elegidos) rejillaPiso.set(offsetX + c.x, offsetY + c.y, TIPO_TILE.VENTANA);
    }
  }
}

// Genera y coloca todas las salas de UNA planta (rol: "bodega"/"planta_baja"/
// "planta_alta"), devolviendo el plano de esa planta con cada sala ya
// posicionada y las puertas de conexión reales entre salas contiguas.
function generarPlanta({ nivel, rol, salasPonderadas, catalogos, riqueza, amueblado, semilla, temaProfesion, materialesPreferidos }) {
  const rnd = crearPRNG(`${semilla}:planta:${nivel}`);
  const n = elegirNumeroSalas(salasPonderadas.length, riqueza, rnd);

  const tipoSalaIds = [];
  for (let i = 0; i < n; i++) tipoSalaIds.push(elegirPonderado(salasPonderadas, rnd));

  // El pasillo (si sale sorteado) siempre actúa de columna vertebral —
  // se genera aparte, con el ancho exacto de la fila que soporta.
  const idxPasillo = tipoSalaIds.findIndex((id) => catalogos.tiposSala[id]?.esPasillo);
  const idsFila = idxPasillo === -1 ? tipoSalaIds : tipoSalaIds.filter((_, i) => i !== idxPasillo);

  // Ventanas reales por catálogo (GDD_Bakeador_Interiores §7bis, dentro de
  // colocarSala — forma/tamaño/marco/cristal con aporteLuz, consumido por
  // interiorVisual.ts para la luz ambiente): nunca en bodega (sin fachada
  // real, bajo tierra) — el resto de la fila sí. Distinto de anadirVentanas
  // más abajo, que es la post-pasada ESTRUCTURAL sobre la planta ya
  // compuesta (sin catálogo todavía, sección 7) — ambas conviven: esta
  // reserva sus segmentos de pared en bordesOcupados, la post-pasada los
  // respeta y no vuelve a marcarlos.
  const permiteVentanas = rol !== "bodega";
  const salasFila = idsFila.map((tipoSalaId, i) =>
    colocarSala({ tipoSalaId, catalogos, riqueza, amueblado, semilla: `${semilla}:${nivel}:${i}`, temaProfesion, permiteVentanas, materialesPreferidos, nivel })
  );

  const salasColocadas = [];
  // Casillas de puerta REALES de esta planta, en coordenadas de planta —
  // sección añadida porque ni el hueco entre dos salas en fila (sin
  // pasillo) ni la puerta propia de cada sala hacia el pasillo quedaban
  // guardados en ningún sitio: colocarSala.puerta cae SIEMPRE una fila
  // más allá del rectángulo de la sala (server/mundo/interiorColision.js
  // y el render del cliente necesitan esto para que las salas queden
  // conectadas de verdad, no solo dibujadas una junto a otra).
  const puertasConexion = [];
  let rejillaPiso;
  let pasillo = null;

  if (idxPasillo !== -1) {
    // Con pasillo: columna vertebral de siempre, sin tocar — fila 1D
    // alineada por el muro sur, cada sala conecta con el pasillo de debajo
    // por su propia puerta (ya la trae de fábrica), nunca directamente con
    // la de al lado.
    const numHuecosFila = Math.max(0, salasFila.length - 1);
    const anchoTotal = salasFila.reduce((s, r) => s + r.ancho, 0) + numHuecosFila;
    const altoFila = Math.max(...salasFila.map((r) => r.largo), 4);
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
      materialesPreferidos,
      nivel,
    });

    const anchoPlanta = Math.max(anchoTotal, pasillo.ancho);
    const altoPlanta = altoFila + 1 + pasillo.largo;
    // +1 de margen: la puerta de la última sala/el pasillo cae una fila más
    // allá de su propio rectángulo, hace falta sitio en la rejilla para eso.
    rejillaPiso = crearRejilla(Math.max(anchoPlanta, 4), Math.max(altoPlanta, 4) + 1, TIPO_TILE.VACIO);

    let cursorX = 0;
    for (let i = 0; i < salasFila.length; i++) {
      const r = salasFila[i];
      const offsetY = altoFila - r.largo; // alineadas por el muro sur, igual que la fila entera toca el pasillo
      if (i > 0) cursorX += 1; // columna de separación con la sala anterior, siempre
      pintarSalaEnPlanta(rejillaPiso, r, cursorX, offsetY);
      // la puerta propia de la sala (colocarSala.js) cae siempre en
      // offsetY+largo, una fila más allá de su rectángulo — hacia el
      // pasillo justo debajo.
      puertasConexion.push({ x: cursorX + r.puerta.x, y: offsetY + r.puerta.y });
      salasColocadas.push({ resultado: r, offsetX: cursorX, offsetY, tipoSalaId: r.tipoSalaId, nivel, rol, origen: "generado" });
      cursorX += r.ancho;
    }

    const offsetYPasillo = altoFila + 1;
    pintarSalaEnPlanta(rejillaPiso, pasillo, 0, offsetYPasillo);
    salasColocadas.push({ resultado: pasillo, offsetX: 0, offsetY: offsetYPasillo, tipoSalaId: pasillo.tipoSalaId, nivel, rol, esPasillo: true, origen: "generado" });
  } else {
    // Sin pasillo: empaquetado 2D tipo BSP (interiores/src/bsp.js) en vez
    // de una fila 1D — con 3-5 salas y sin columna vertebral, una fila sola
    // dejaba a cada sala como mucho 2 vecinas reales y SIEMPRE la misma
    // silueta alargada. Cada sala ya trae su ancho/largo fijado por
    // colocarSala; el empaquetado solo decide dónde cae cada una.
    const items = salasFila.map((r) => ({ ancho: r.ancho, largo: r.largo, r }));
    const tam = empaquetarBSP(items);
    rejillaPiso = crearRejilla(Math.max(tam.ancho, 4), Math.max(tam.largo, 4) + 1, TIPO_TILE.VACIO);

    for (const it of items) {
      pintarSalaEnPlanta(rejillaPiso, it.r, it.offsetX, it.offsetY);
      salasColocadas.push({ resultado: it.r, offsetX: it.offsetX, offsetY: it.offsetY, tipoSalaId: it.r.tipoSalaId, nivel, rol, origen: "generado" });
    }

    // Puertas múltiples reales entre cada par de salas que quedaron
    // realmente pegadas (abertura ancha, misma técnica que
    // generarHabitacionCompuestaL) — antes, con solo 1 puerta por sala y
    // fila 1D, una sala intermedia sin pasillo llegaba a tener DOS
    // aberturas en su rejilla (su propia puerta sur, apuntando al margen
    // vacío sin uso real, más la punzada a mano con la vecina) sin que la
    // fase de amueblado supiera nunca de la segunda — bug latente real,
    // ya cerrado: cada conexión de aquí es la única fuente de verdad.
    const items2 = items;
    const pares = paresAdyacentes(items2);
    const padre = items2.map((_, i) => i);
    const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    const unir = (i, j) => { padre[raiz(i)] = raiz(j); };
    for (const par of pares) {
      unir(items2.indexOf(par.a), items2.indexOf(par.b));
      for (const { x, y } of tilesDePuerta(par)) {
        rejillaPiso.set(x, y, TIPO_TILE.PUERTA);
        puertasConexion.push({ x, y });
      }
    }
    // Salvaguarda (rara, pero posible con tamaños de sala muy dispares):
    // alguna sala quedó sin ningún par realmente pegado tras el
    // empaquetado — cada sala mide como mínimo 4x4 (colocarSala,
    // Math.max(4,...)), así que tallar un pasillo recto de 1 casilla entre
    // centros nunca puede partir en dos ninguna de las dos habitaciones
    // (mismo recurso de última instancia que ya usa en vivo
    // server/src/mundo/interiorColision.ts:garantizarConectividad para la
    // colisión — aquí es al nivel del propio bake, no un parche runtime).
    for (let i = 1; i < items2.length; i++) {
      if (raiz(i) === raiz(0)) continue;
      let mejor = -1, mejorDist = Infinity;
      for (let j = 0; j < items2.length; j++) {
        if (raiz(j) !== raiz(0)) continue;
        const A = items2[i], B = items2[j];
        const d = Math.hypot((A.offsetX + A.ancho / 2) - (B.offsetX + B.ancho / 2), (A.offsetY + A.largo / 2) - (B.offsetY + B.largo / 2));
        if (d < mejorDist) { mejorDist = d; mejor = j; }
      }
      if (mejor === -1) continue;
      const A = items2[i], B = items2[mejor];
      const px = Math.round(A.offsetX + A.ancho / 2), py = Math.round(A.offsetY + A.largo / 2);
      const qx = Math.round(B.offsetX + B.ancho / 2), qy = Math.round(B.offsetY + B.largo / 2);
      let x = px, y = py;
      rejillaPiso.set(x, y, TIPO_TILE.PUERTA);
      puertasConexion.push({ x, y });
      while (x !== qx) { x += x < qx ? 1 : -1; if (rejillaPiso.get(x, y) === TIPO_TILE.VACIO) rejillaPiso.set(x, y, TIPO_TILE.SUELO); }
      while (y !== qy) { y += y < qy ? 1 : -1; if (rejillaPiso.get(x, y) === TIPO_TILE.VACIO) rejillaPiso.set(x, y, TIPO_TILE.SUELO); }
      rejillaPiso.set(x, y, TIPO_TILE.PUERTA);
      puertasConexion.push({ x, y });
      unir(i, mejor);
    }
  }

  // Ventanas (GDD_Bakeador_Interiores sección 7): post-pasada, no dentro de
  // colocarSala — cada sala individual no sabe qué pared da al exterior
  // del edificio hasta que la planta entera está compuesta. Nunca en
  // sótano/bodega ni en cripta (tipos_sala.json ya lo documenta como
  // "bajo tierra"), nunca sobre la puerta propia ni sobre un
  // colgadoEnPared ya puesto (bordesOcupados, expuesto por colocarSala).
  anadirVentanas(rejillaPiso, salasColocadas, nivel, semilla);

  // Sala-planta real por flood-fill (reutiliza salas.js sin tocarlo): cada
  // habitación pintada queda como su propia región de suelo conectada;
  // las puertas compartidas aparecen en el conjunto `puertas` de las DOS
  // salas vecinas — eso ya es, por definición, la conexión entre ambas.
  const salasDetectadas = detectarSalas(rejillaPiso);
  for (const s of salasColocadas) {
    // La celda de suelo pegada a la puerta propia de esta sala
    // (offsetX+puerta.x, offsetY+largo-1) — SIEMPRE suelo real por
    // construcción (formasSala.js:mascaraValida exige suelo en la fila de
    // la puerta), a diferencia de "un paso hacia dentro de la esquina
    // superior-izquierda" (offsetX+1, offsetY+1): con una plantilla no
    // rectangular (catalogo/formasSala.json) esa esquina puede caer fuera
    // de la máscara (una L, una U...), dejando `salaPlanta` en null.
    const puntoInterior = `${s.offsetX + s.resultado.puerta.x}_${s.offsetY + s.resultado.largo - 1}`;
    s.salaPlanta = salasDetectadas.find((sd) => sd.tiles.has(puntoInterior)) || null;
  }

  // Sala "principal" de la planta para colgar el conector vertical
  // (escalera/trampilla) — preferir el pasillo, si no el vestíbulo/sala
  // común, si no la primera sala generada.
  const salaConector =
    salasColocadas.find((s) => s.esPasillo) ||
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
  const materialesPreferidos = defEdificio.materialesPreferidos || [];
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
      materialesPreferidos,
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
    materialesPreferidos,
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
  const { ancho, largo, puerta, colocados, mascara } = sala.resultado;
  const [hw, hl] = huella;
  if (hw > ancho || hl > largo) return null;
  const reservas = reservasPorSala.get(sala) || [];

  const libre = (x0, y0) => {
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        const cx = x0 + dx, cy = y0 + dy;
        if (cx === puerta.x && cy === puerta.y) return false;
        // Sala de plantilla no rectangular (formasSala.json): la escalera/
        // trampilla no puede caer fuera del suelo real de la máscara —
        // sin esto podía "imprimir" suelo pisable dentro de lo que
        // debería leerse como muro/hueco de la forma.
        if (mascara && mascara[cy * ancho + cx] !== "1") return false;
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
