"use strict";

// Prototipo de colocación de elementos dentro de UNA sala ya con forma
// rectangular fija — NO es el motor final. El motor real resolverá la
// forma con Wave Function Collapse (GDD_Bakeador_Interiores sección 2);
// esto solo implementa la parte de "dada una sala con forma y tamaño,
// coloca estructura + elementos respetando riqueza/colocacion/huella"
// para poder probar de verdad que el catálogo funciona (GDD sección 7ter
// para el significado exacto de cada valor de colocacion).

const { riquezaAlcanza } = require("./catalogo");
const { crearRejilla, detectarSalas, circulacionIntacta, TIPO_TILE } = require("./salas");
const { ORIENTACIONES, rotarHuella, rotarOffset } = require("./rotacion");
const { calcularEstadisticas } = require("./estadisticas");
const { crearPRNG, barajar } = require("./azar");
const { construirCatalogoContenido } = require("./catalogoContenido");
const { AnchorType, Priority } = require("./roomTags");

// Capas incluidas según el nivel de amueblado (GDD sección 1).
const CAPAS_POR_AMUEBLADO = {
  vacio: [],
  fijo: ["decorFija"],
  completo: ["decorFija", "decorMovible", "iluminacion", "suciedad"],
};

// Pipeline de colocación por FASES (arquitectura FurnitureConfig — src/
// roomTags.js): Priority.DOMINANTE(1) -> SECUNDARIO(2) -> DECORACION(3), en
// ese orden. `priority` en elementos.json ya está derivado 1:1 de `capa`
// (decorFija=1, decorMovible=2, iluminacion/suciedad=3) — agrupar por fase
// en vez de por capa suelta es solo una forma más explícita de expresar el
// mismo orden que ya existía, cada capa conserva su propio límite
// (LIMITE_POR_CAPA) para no cambiar cuánto sale de cada una.
const CAPAS_POR_FASE = {
  [Priority.DOMINANTE]: ["decorFija"],
  [Priority.SECUNDARIO]: ["decorMovible"],
  [Priority.DECORACION]: ["iluminacion", "suciedad"],
};

function colocarSala({ tipoSalaId, catalogos, riqueza = "modesta", amueblado = "completo", semilla = "prueba", anchoForzado, largoForzado }) {
  const defSala = catalogos.tiposSala[tipoSalaId];
  if (!defSala) throw new Error(`tipoSala desconocido: ${tipoSalaId}`);

  const rnd = crearPRNG(`${semilla}:${tipoSalaId}`);
  const elegirEntero = (min, max) => min + Math.floor(rnd() * (max - min + 1));

  // anchoForzado/largoForzado (opcionales): para cuando quien pide la sala
  // necesita un tamaño exacto en vez del rango típico del tipo de sala —
  // ej. edificio.js generando un pasillo tan ancho como la fila de
  // habitaciones que tiene que soportar (GDD sección 1bis).
  const ancho = Math.max(4, anchoForzado ?? elegirEntero(defSala.anchoTiles[0], defSala.anchoTiles[1]));
  const largo = Math.max(4, largoForzado ?? elegirEntero(defSala.largoTiles[0], defSala.largoTiles[1]));
  const materialSuelo = defSala.materialSuelo;
  const materialPared = defSala.materialPared;

  // El muro NO ocupa ninguna casilla propia — es un límite sin grosor en
  // el borde de la sala, no una fila/columna de suelo reservada. ancho x
  // largo es exactamente el suelo caminable de verdad (x∈[0,ancho-1],
  // y∈[0,largo-1]), sin margen perdido en ningún lado. La puerta, al ser
  // el hueco EN ese límite, cae en y=largo — una fila más allá de la
  // última fila de suelo, no sobre una casilla de suelo.
  const puerta = { lado: "sur", x: Math.floor(ancho / 2), y: largo };

  // Ocupación de suelo: true = libre. Todo el rectángulo ancho x largo es
  // suelo real, no hay anillo exterior reservado para muro.
  const libreSuelo = [];
  for (let y = 0; y < largo; y++) {
    libreSuelo.push(new Array(ancho).fill(true));
  }

  const esPuerta = (x, y) => x === puerta.x && y === puerta.y;
  const tocaPared = (x, y) => x === 0 || y === 0 || x === ancho - 1 || y === largo - 1;

  // Rejilla real de tiles (sección 2 del pedido de integración): todo el
  // rectángulo es suelo, con una fila extra de colchón (largo+1) solo
  // para poder marcar el hueco de la puerta como PUERTA de verdad — esa
  // fila colchón no es suelo de la sala, es lo que hay justo al otro lado
  // del límite. `detectarSalas` la reduce a un objeto Sala (tiles +
  // aberturas) que no sabe ni le importa que este rectángulo viniera de
  // un flood-fill, una selección manual o una herramienta rectangular —
  // es la misma forma para las tres. Esa Sala es también la base del
  // chequeo de circulación de las funciones de colocación de abajo
  // (sección 6).
  const rejilla = crearRejilla(ancho, largo + 1, TIPO_TILE.PARED);
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) rejilla.set(x, y, TIPO_TILE.SUELO);
  }
  rejilla.set(puerta.x, puerta.y, TIPO_TILE.PUERTA);
  const [sala] = detectarSalas(rejilla);
  const origenCirculacion = [puerta.x, largo - 1]; // última fila de suelo, pegada a la puerta

  function huecoLibre(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    if (x < 0 || y < 0 || x + hw > ancho || y + hl > largo) return false;
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        if (!libreSuelo[y + dy][x + dx]) return false;
      }
    }
    return true;
  }
  const ocupadasSet = new Set(); // "x_y" de toda casilla de suelo ocupada por una huella — mismo formato que sala.tiles, se pasa tal cual a circulacionIntacta
  function ocupar(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        libreSuelo[y + dy][x + dx] = false;
        ocupadasSet.add(`${x + dx}_${y + dy}`);
      }
    }
  }
  function liberar(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        libreSuelo[y + dy][x + dx] = true;
        ocupadasSet.delete(`${x + dx}_${y + dy}`);
      }
    }
  }
  // Ocupa de forma tentativa y comprueba que la sala sigue teniendo
  // circulación desde la puerta con ese mueble puesto (sección 6: "no
  // puede bloquear la circulación principal"); si la bloquea, deshace la
  // ocupación — el sitio se descarta exactamente igual que si no hubiera
  // cabido.
  function ocuparSiCirculacionIntacta(x, y, huella) {
    ocupar(x, y, huella);
    if (circulacionIntacta(sala, ocupadasSet, origenCirculacion)) return true;
    liberar(x, y, huella);
    return false;
  }

  const colocados = []; // mobiliario/decoración en el plano suelo, con footprint real
  const colgados = []; // elementos en el plano pared (colgadoEnPared)
  const techo = []; // elementos en el plano techo
  const superficies = []; // hosts con esSuperficie:true ya colocados, para apilar sobreSuperficie encima
  const bordesOcupados = new Set(); // "x_y" de segmentos de pared ya usados por colgadoEnPared

  // Ninguna pieza puede tapar la casilla de entrada justo delante de la
  // puerta (origenCirculacion): circulacionIntacta no lo detecta por sí
  // sola si esa casilla concreta queda ocupada (ver comentario en
  // salas.js — "no es este chequeo el que debe rechazarlo"), así que hace
  // falta este guardia aparte para que nunca se bloquee la entrada.
  function cubreOrigen(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    const [ox, oy] = origenCirculacion;
    return ox >= x && ox < x + hw && oy >= y && oy < y + hl;
  }

  // clearanceFrontal (FurnitureConfig): casillas vacías obligatorias justo
  // delante de la pieza — el "frente" es el mismo borde que ya usa
  // tileInteraccion/la convención de mirar-hacia-la-sala (a 0° el frente
  // cae en el borde sur de la huella, 90°→oeste, 180°→norte, 270°→este).
  // Solo exige que estén libres EN ESE MOMENTO (no las reserva contra
  // colocaciones futuras) — coherente con el resto del motor, que también
  // resuelve todo por orden de llegada sin reservar de antemano.
  function frenteLibre(x, y, huella, grados, distancia) {
    if (!distancia) return true;
    const [hw, hl] = huella;
    for (let paso = 1; paso <= distancia; paso++) {
      let fx, fy, ancho2, dxEje, dyEje;
      if (grados === 0) { fx = x; fy = y + hl - 1 + paso; ancho2 = hw; dxEje = 1; dyEje = 0; }
      else if (grados === 180) { fx = x; fy = y - paso; ancho2 = hw; dxEje = 1; dyEje = 0; }
      else if (grados === 90) { fx = x - paso; fy = y; ancho2 = hl; dxEje = 0; dyEje = 1; }
      else { fx = x + hw - 1 + paso; fy = y; ancho2 = hl; dxEje = 0; dyEje = 1; }
      for (let i = 0; i < ancho2; i++) {
        const cx = fx + dxEje * i;
        const cy = fy + dyEje * i;
        if (cx < 0 || cy < 0 || cx >= ancho || cy >= largo) return false;
        if (!libreSuelo[cy][cx]) return false;
      }
    }
    return true;
  }

  // Fallback genérico (usado por "libre" y como último recurso si la
  // colocación sistemática de abajo no encuentra sitio en ningún muro/
  // centro): posición al azar entre 25 intentos, orientación al azar.
  function intentarColocarEnSuelo(el) {
    const intentos = 25;
    const preferido = el.colocacion.find((c) => c === "esquina" || c === "pegadaAPared" || c === "centroSala" || c === "libre" || c === "juntoAMesa" || c === "simetrico");
    for (let i = 0; i < intentos; i++) {
      const x = elegirEntero(0, ancho - 1);
      const y = elegirEntero(0, largo - 1);
      if (esPuerta(x, y)) continue;
      // Orientación 0/90/180/270 (sección 7): rota la huella entera junto
      // con el tile de interacción, no solo el dibujo. `rotacionesPermitidas`
      // (catálogo de contenido, opcional) reduce el abanico para piezas que
      // no tienen sentido en cualquier ángulo — por defecto (ausente) son
      // las 4 de siempre, así que ningún elemento existente cambia.
      const orientacionesDisponibles = el.rotacionesPermitidas || ORIENTACIONES;
      const grados = orientacionesDisponibles[elegirEntero(0, orientacionesDisponibles.length - 1)];
      const huellaRot = rotarHuella(el.huella || [1, 1], grados);
      if (!huecoLibre(x, y, huellaRot)) continue;
      if (cubreOrigen(x, y, huellaRot)) continue;
      if ((preferido === "pegadaAPared" || preferido === "esquina") && !tocaPared(x, y)) continue;
      if (!frenteLibre(x, y, huellaRot, grados, el.clearanceFrontal)) continue;
      if (!ocuparSiCirculacionIntacta(x, y, huellaRot)) continue;
      const item = { id: el.id, x, y, ancho: huellaRot[0], largo: huellaRot[1], rotacion: grados, colorDebug: el.colorDebug, capa: el.capa };
      if (el.aportes) item.aportes = el.aportes;
      if (el.tileInteraccion) {
        const [ix, iy] = rotarOffset(el.tileInteraccion, el.huella || [1, 1], grados);
        item.tileInteraccion = [x + ix, y + iy];
      }
      colocados.push(item);
      if (el.esSuperficie) superficies.push(item);
      return true;
    }
    return false;
  }

  // Huecos válidos a lo largo de UN muro para una huella ya rotada: la
  // coordenada perpendicular al muro queda fija (pegada a él), la otra
  // recorre todo el largo del muro — así se puede escanear el muro entero
  // en vez de tirar posiciones al azar.
  function candidatosPegadoAPared(lado, huellaRot) {
    const [hw, hl] = huellaRot;
    const candidatos = [];
    if (lado === "norte") {
      for (let x = 0; x <= ancho - hw; x++) candidatos.push([x, 0]);
    } else if (lado === "sur") {
      const y = largo - hl;
      for (let x = 0; x <= ancho - hw; x++) candidatos.push([x, y]);
    } else if (lado === "oeste") {
      for (let y = 0; y <= largo - hl; y++) candidatos.push([0, y]);
    } else {
      const x = ancho - hw;
      for (let y = 0; y <= largo - hl; y++) candidatos.push([x, y]);
    }
    return candidatos;
  }

  // Colocación sistemática pegada a un muro (GDD sección 7ter,
  // "pegadaAPared"/"esquina"): recorre las 4 paredes en orden aleatorio y
  // DENTRO de cada una prueba cada hueco válido a lo largo del muro entero
  // — no 25 tiros al azar y a rendirse — así encuentra cualquier sitio que
  // exista de verdad. La rotación no es al azar: cada lado fuerza el
  // ángulo que hace que el mueble le dé la espalda a ESE muro y el frente
  // mire hacia dentro de la sala (convención del catálogo: a 0° un mueble
  // "abre"/mira hacia el sur — su tileInteraccion, cuando lo tiene, cae
  // siempre en el borde sur de la huella sin rotar — así que pegado al
  // muro norte va a 0°, pegado al sur necesita 180° para que el frente
  // mire hacia dentro y no hacia el muro, este/oeste 90°/270°). Con
  // `priorizarEsquina` se prueban primero los huecos más cercanos a un
  // extremo del muro (una esquina de la sala), sin dejar de recorrer el
  // resto si están ocupados.
  function intentarPegadoAPared(el, priorizarEsquina) {
    const huellaBase = el.huella || [1, 1];
    const lados = barajar(["norte", "sur", "este", "oeste"], rnd);
    const gradosPorLado = { norte: 0, sur: 180, oeste: 270, este: 90 };
    for (const lado of lados) {
      const grados = gradosPorLado[lado];
      const huellaRot = rotarHuella(huellaBase, grados);
      let candidatos = candidatosPegadoAPared(lado, huellaRot);
      if (candidatos.length === 0) continue;
      if (priorizarEsquina) {
        const maxX = ancho - huellaRot[0];
        const maxY = largo - huellaRot[1];
        const distAExtremo = ([x, y]) => (lado === "norte" || lado === "sur" ? Math.min(x, maxX - x) : Math.min(y, maxY - y));
        candidatos = candidatos
          .map((c) => [c, distAExtremo(c) + rnd() * 0.5])
          .sort((a, b) => a[1] - b[1])
          .map(([c]) => c);
      } else {
        candidatos = barajar(candidatos, rnd);
      }
      for (const [x, y] of candidatos) {
        if (esPuerta(x, y)) continue;
        if (!huecoLibre(x, y, huellaRot)) continue;
        if (cubreOrigen(x, y, huellaRot)) continue;
        if (!frenteLibre(x, y, huellaRot, grados, el.clearanceFrontal)) continue;
        if (!ocuparSiCirculacionIntacta(x, y, huellaRot)) continue;
        const item = { id: el.id, x, y, ancho: huellaRot[0], largo: huellaRot[1], rotacion: grados, colorDebug: el.colorDebug, capa: el.capa };
        if (el.aportes) item.aportes = el.aportes;
        if (el.tileInteraccion) {
          const [ix, iy] = rotarOffset(el.tileInteraccion, huellaBase, grados);
          item.tileInteraccion = [x + ix, y + iy];
        }
        colocados.push(item);
        if (el.esSuperficie) superficies.push(item);
        return true;
      }
    }
    return false;
  }

  // Colocación centrada (mesas/anclas grandes de "centroSala"): recorre
  // TODO el interior ordenado por cercanía al centro geométrico real de
  // la sala (con un poco de jitter determinista para variar entre
  // semillas), en vez de 25 posiciones sueltas al azar — así una mesa
  // grande cae cerca del centro de verdad en vez de en cualquier hueco
  // libre que le toque.
  function intentarCentroSala(el) {
    const huellaBase = el.huella || [1, 1];
    const orientaciones = barajar(el.rotacionesPermitidas || ORIENTACIONES, rnd);
    const cx = (ancho - 1) / 2;
    const cy = (largo - 1) / 2;
    const candidatos = [];
    for (let y = 0; y <= largo - 1; y++) {
      for (let x = 0; x <= ancho - 1; x++) candidatos.push([x, y, Math.hypot(x - cx, y - cy) + rnd() * 0.75]);
    }
    candidatos.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of candidatos) {
      if (esPuerta(x, y)) continue;
      for (const grados of orientaciones) {
        const huellaRot = rotarHuella(huellaBase, grados);
        if (!huecoLibre(x, y, huellaRot)) continue;
        if (cubreOrigen(x, y, huellaRot)) continue;
        if (!frenteLibre(x, y, huellaRot, grados, el.clearanceFrontal)) continue;
        if (!ocuparSiCirculacionIntacta(x, y, huellaRot)) continue;
        const item = { id: el.id, x, y, ancho: huellaRot[0], largo: huellaRot[1], rotacion: grados, colorDebug: el.colorDebug, capa: el.capa };
        if (el.aportes) item.aportes = el.aportes;
        if (el.tileInteraccion) {
          const [ix, iy] = rotarOffset(el.tileInteraccion, huellaBase, grados);
          item.tileInteraccion = [x + ix, y + iy];
        }
        colocados.push(item);
        if (el.esSuperficie) superficies.push(item);
        return true;
      }
    }
    return false;
  }

  // Anillo de casillas justo alrededor de la huella de un ancla (mesa,
  // mostrador, altar...) — donde se sientan sus sillas/bancos, no en
  // cualquier sitio libre de la sala.
  function tilesAlrededorDe(ancla) {
    const tiles = [];
    for (let dx = -1; dx <= ancla.ancho; dx++) {
      tiles.push({ x: ancla.x + dx, y: ancla.y - 1, lado: "norte" });
      tiles.push({ x: ancla.x + dx, y: ancla.y + ancla.largo, lado: "sur" });
    }
    for (let dy = 0; dy < ancla.largo; dy++) {
      tiles.push({ x: ancla.x - 1, y: ancla.y + dy, lado: "oeste" });
      tiles.push({ x: ancla.x + ancla.ancho, y: ancla.y + dy, lado: "este" });
    }
    return tiles.filter(({ x, y }) => x >= 0 && y >= 0 && x <= ancho - 1 && y <= largo - 1 && !esPuerta(x, y));
  }

  // Un ancla admite este hijo si alguno de sus childSlots (FurnitureConfig
  // — declarados en el catálogo, no en la instancia ya colocada) tiene a
  // `elId` entre sus allowedItemTypes. Sin childSlots declarados en el
  // catálogo para esa ancla, no admite satélites por esta vía — childSlots
  // es la fuente de verdad de qué puede engancharse a qué, ya no "cualquier
  // esSuperficie vale para cualquier juntoAMesa". `maxSatelites` (opcional,
  // por defecto sin tope) es el límite del propio ANCLA, no del tipo de
  // hijo: un escritorio de 1 sola plaza declara maxSatelites:1 y deja de
  // admitir sillas en cuanto ya tiene la suya, aunque una mesa de comedor
  // en la misma sala siga aceptando hasta 4 sin límite propio.
  function anclaAdmite(anclaEl, elId) {
    const def = catalogos.elementos[anclaEl.id];
    if (!def) return false;
    if ((anclaEl._satelites || 0) >= (def.maxSatelites ?? Infinity)) return false;
    return (def.childSlots || []).some((slot) => (slot.allowedItemTypes || []).includes(elId));
  }

  // "juntoAMesa" de verdad: se sienta junto a un ancla ya colocada cuyo
  // childSlot admite este tipo de pieza, no en un punto aleatorio de la
  // sala ni junto a cualquier esSuperficie — así una silla siempre aparece
  // pegada a una mesa real que de verdad la admite (childSlots), nunca
  // suelta ni sentada en un mostrador. Si hay varias anclas válidas,
  // reparte entre las que menos satélites tengan todavía. La orientación
  // no es al azar cuando el slot pide autoRotateToParentCenter: según de
  // qué lado del ancla venga el hueco, se fuerza el ángulo que hace que el
  // satélite mire HACIA el ancla (misma convención de "0° mira al sur" que
  // intentarPegadoAPared) — una silla al norte de la mesa mira al sur, una
  // al sur mira al norte, etc., así las sillas quedan mirando a la mesa.
  function intentarJuntoAMesa(el) {
    const anclasValidas = superficies.filter((a) => anclaAdmite(a, el.id));
    // Sin ningún ancla con hueco libre (ninguna en la sala, o todas ya en
    // su `maxSatelites`) NO cae a suelo libre: un satélite "juntoAMesa" que
    // no tiene mesa a la que sentarse no debe aparecer suelto en mitad de
    // la sala — así un escritorio con maxSatelites:1 se queda con su única
    // silla en vez de seguir intentando colocar las siguientes como bultos
    // sueltos por el suelo (bug real: antes de este cambio, cada intento
    // que no encontraba ancla libre degradaba a "silla flotante" en vez de
    // simplemente parar).
    if (anclasValidas.length === 0) return false;
    const anclasOrdenadas = anclasValidas.sort((a, b) => (a._satelites || 0) - (b._satelites || 0));
    const gradosParaMirarAncla = { norte: 0, sur: 180, oeste: 270, este: 90 };
    for (const anclaEl of anclasOrdenadas) {
      const anillo = barajar(tilesAlrededorDe(anclaEl), rnd);
      for (const { x, y, lado } of anillo) {
        const huellaBase = el.huella || [1, 1];
        const grados = gradosParaMirarAncla[lado];
        const huella = rotarHuella(huellaBase, grados);
        if (!huecoLibre(x, y, huella)) continue;
        if (cubreOrigen(x, y, huella)) continue;
        if (!ocuparSiCirculacionIntacta(x, y, huella)) continue;
        const item = { id: el.id, x, y, ancho: huella[0], largo: huella[1], rotacion: grados, colorDebug: el.colorDebug, capa: el.capa };
        if (el.aportes) item.aportes = el.aportes;
        colocados.push(item);
        anclaEl._satelites = (anclaEl._satelites || 0) + 1;
        return true;
      }
    }
    return false;
  }

  // Pares en espejo para decoración simétrica de sala noble (columnas a
  // ambos lados, etc.) — solo para elementos cuya única colocación es
  // "simetrico" (una pieza como el trono, que combina centroSala+simetrico,
  // sigue yendo por intentarColocarEnSuelo: ahí simetrico significa
  // "respeta el eje", no "duplícate").
  function colocarSimetrico(el) {
    const [hw, hl] = el.huella || [1, 1];
    const intentos = 20;
    for (let i = 0; i < intentos; i++) {
      const x = elegirEntero(0, ancho - hw);
      const y = elegirEntero(0, largo - hl);
      const xEspejo = ancho - hw - x;
      if (esPuerta(x, y) || esPuerta(xEspejo, y)) continue;
      if (cubreOrigen(x, y, el.huella) || cubreOrigen(xEspejo, y, el.huella)) continue;
      if (!huecoLibre(x, y, el.huella)) continue;
      if (xEspejo !== x && !huecoLibre(xEspejo, y, el.huella)) continue;
      if (!ocuparSiCirculacionIntacta(x, y, el.huella)) continue;
      if (xEspejo !== x && !ocuparSiCirculacionIntacta(xEspejo, y, el.huella)) {
        liberar(x, y, el.huella); // el segundo del par rompe la circulación: deshacer también el primero
        continue;
      }
      const item1 = { id: el.id, x, y, ancho: hw, largo: hl, colorDebug: el.colorDebug, capa: el.capa };
      if (el.aportes) item1.aportes = el.aportes;
      colocados.push(item1);
      if (xEspejo !== x) {
        const item2 = { id: el.id, x: xEspejo, y, ancho: hw, largo: hl, colorDebug: el.colorDebug, capa: el.capa };
        if (el.aportes) item2.aportes = el.aportes;
        colocados.push(item2);
      }
      return true;
    }
    return false;
  }

  function intentarColgarEnPared(el) {
    const intentos = 25;
    for (let i = 0; i < intentos; i++) {
      const lado = ["norte", "sur", "este", "oeste"][elegirEntero(0, 3)];
      let x, y;
      if (lado === "norte") { x = elegirEntero(0, ancho - 1); y = 0; }
      else if (lado === "sur") { x = elegirEntero(0, ancho - 1); y = largo - 1; }
      else if (lado === "oeste") { x = 0; y = elegirEntero(0, largo - 1); }
      else { x = ancho - 1; y = elegirEntero(0, largo - 1); }
      if (esPuerta(x, y)) continue;
      const clave = `${x}_${y}`;
      if (bordesOcupados.has(clave)) continue;
      bordesOcupados.add(clave);
      const item = { id: el.id, x, y, lado, colorDebug: el.colorDebug };
      if (el.aportes) item.aportes = el.aportes;
      colgados.push(item);
      return true;
    }
    return false;
  }

  // Dispatch por anchorType (FurnitureConfig) — CADA valor puede cubrir más
  // de un `colocacion` de siempre (ej. CHILD_SLOT cubre tanto
  // sobreSuperficie como juntoAMesa), así que dentro de cada caso se
  // desambigua por colocacion exactamente con el mismo criterio que ya
  // tenía este archivo — el reordenamiento no cambia qué función termina
  // llamándose para ningún elemento existente, ver ORDEN_ANCHOR en el
  // script de migración del catálogo para la prueba de que reproduce el
  // orden de comprobación anterior tile a tile.
  function colocarUno(el) {
    switch (el.anchorType) {
      case AnchorType.CHILD_SLOT:
        if (el.colocacion.includes("sobreSuperficie")) {
          if (superficies.length === 0) return false;
          const host = superficies[elegirEntero(0, superficies.length - 1)];
          host.sobre = host.sobre || [];
          const item = { id: el.id, colorDebug: el.colorDebug };
          if (el.aportes) item.aportes = el.aportes;
          host.sobre.push(item);
          return true;
        }
        return intentarJuntoAMesa(el);

      case AnchorType.WALL_HIGH_FLOATING:
        if (el.colocacion.includes("techo")) {
          const item = { id: el.id, colorDebug: el.colorDebug };
          if (el.aportes) item.aportes = el.aportes;
          techo.push(item);
          return true;
        }
        return intentarColgarEnPared(el);

      case AnchorType.WALL_BACK:
        // colocación sistemática (muro escaneado entero, orientación
        // forzada) en vez del muestreo al azar de intentarColocarEnSuelo —
        // esa función queda como último recurso si no encuentra sitio de
        // verdad (p.ej. las 4 paredes ya llenas).
        return intentarPegadoAPared(el, false) || intentarColocarEnSuelo(el);

      case AnchorType.CORNER:
        return intentarPegadoAPared(el, true) || intentarColocarEnSuelo(el);

      case AnchorType.FREE_CENTER:
      default:
        if (defSala.simetrico && el.colocacion.length === 1 && el.colocacion[0] === "simetrico") {
          return colocarSimetrico(el);
        }
        if (el.colocacion.includes("centroSala")) return intentarCentroSala(el) || intentarColocarEnSuelo(el);
        return intentarColocarEnSuelo(el);
    }
  }

  const capasIncluidas = CAPAS_POR_AMUEBLADO[amueblado];
  if (!capasIncluidas) throw new Error(`amueblado desconocido: ${amueblado}`);

  const LIMITE_POR_CAPA = { decorFija: 4, decorMovible: 9, iluminacion: 3, suciedad: 3 };

  // Pipeline por FASES (1=Dominante, 2=Secundario, 3=Decoración — ver
  // CAPAS_POR_FASE): cada fase agrupa una o más capas de siempre, cada
  // capa conserva su propio límite. Dentro de cada capa, isMandatory
  // primero — "la habitación intentará spawnearlo primero" — luego anclas
  // (esSuperficie) antes que sus satélites, igual que antes.
  for (const fase of [Priority.DOMINANTE, Priority.SECUNDARIO, Priority.DECORACION]) {
    for (const capa of CAPAS_POR_FASE[fase]) {
      if (!capasIncluidas.includes(capa)) continue;
      const candidatos = Object.entries(catalogos.elementos)
        .filter(([id]) => !id.startsWith("_"))
        .map(([id, el]) => ({ id, ...el }))
        .filter((el) => el.capa === capa)
        .filter((el) => (el.tiposSalaValidos || []).includes(tipoSalaId))
        .filter((el) => riquezaAlcanza(riqueza, el.riquezaMinima));

      // Las piezas que van pegadas a un muro (WALL_BACK/CORNER) se colocan
      // justo después de las obligatorias y ANTES que cualquier decoración
      // suelta de centro — así el mobiliario se pega a los bordes primero
      // y deja el centro de la sala libre para circular, en vez de que un
      // elemento "libre" no obligatorio ocupe por casualidad una casilla
      // pegada a un muro que un mueble de verdad habría aprovechado mejor.
      const esPegadoAPared = (el) => el.anchorType === AnchorType.WALL_BACK || el.anchorType === AnchorType.CORNER;
      const rango = (el) => (el.isMandatory ? -2 : esPegadoAPared(el) ? -1 : el.esSuperficie ? 0 : el.colocacion.includes("juntoAMesa") ? 1 : 2);
      const barajados = barajar(candidatos, rnd).sort((a, b) => rango(a) - rango(b));
      let colocadosEnCapa = 0;
      const idsYaUsados = new Set();
      const MAX_SATELITES_POR_TIPO = 6; // tope global por sala para un mismo tipo de satélite (ej. "silla"), repartido entre todas las anclas válidas — el tope real de una mesa concreta lo pone su propio `maxSatelites` (ej. mesa_comedor_larga:6, escritorio:1)
      for (const el of barajados) {
        if (colocadosEnCapa >= LIMITE_POR_CAPA[capa]) break;
        if (idsYaUsados.has(el.id)) continue; // no repetir la misma pieza dos veces en una sala pequeña...
        if (el.colocacion.includes("juntoAMesa")) {
          // ...salvo los satélites de un ancla (silla/banco junto a una
          // mesa): esos sí deben repetirse, es justo lo que da la imagen
          // de "mesa con varias sillas alrededor" en vez de una silla suelta.
          let colocadasDeEste = 0;
          while (colocadasDeEste < MAX_SATELITES_POR_TIPO && colocadosEnCapa < LIMITE_POR_CAPA[capa] && colocarUno(el)) {
            colocadasDeEste++;
            colocadosEnCapa++;
          }
          if (colocadasDeEste > 0) idsYaUsados.add(el.id);
          continue;
        }
        if (colocarUno(el)) {
          colocadosEnCapa++;
          idsYaUsados.add(el.id);
        }
      }
    }
  }

  // Marca de origen (edicion.js sección 5 del pedido de edificios/editor):
  // todo lo que sale del generador nace "generado" — instanceId único por
  // pieza (no por tipo: puede haber 4 sillas del mismo `id` de catálogo en
  // una sala) para que el editor pueda seleccionar/mover/eliminar una
  // instancia concreta sin ambigüedad. edicion.js es quien cambia origen a
  // "modificado" cuando el usuario toca algo. `estado` (desgastado/roto/
  // sucio) viaja vacío desde ya para que una instancia pueda conservarlo
  // sin romper compatibilidad cuando exista la mecánica que lo rellene
  // (catálogo de contenido sección 5). `variante` se resuelve aquí mismo,
  // con la MISMA semilla de la sala — catálogo → selección → instancia
  // determinista de punta a punta: dos bakeados con la misma semilla dan
  // siempre la misma variante, sin aleatoriedad no determinista.
  const catalogoContenido = construirCatalogoContenido(catalogos);
  let contadorInstancia = 0;
  const marcarGenerado = (item) => {
    item.instanceId = `${tipoSalaId}_${semilla}_${contadorInstancia++}`;
    item.origen = "generado";
    item.estado = { desgastado: false, roto: false, sucio: false };
    const variante = catalogoContenido.elegirVariante(item.id, item.instanceId);
    if (variante !== item.id) item.variante = variante;
    return item;
  };
  for (const item of colocados) {
    marcarGenerado(item);
    for (const s of item.sobre || []) marcarGenerado(s);
  }
  for (const item of colgados) marcarGenerado(item);
  for (const item of techo) marcarGenerado(item);

  // Estadísticas/funcionalidad de sala (sección 9): suma aditiva de los
  // `aportes` de cada pieza realmente colocada, en cualquier plano (suelo,
  // pared, techo o encima de una superficie). Una sala vacía o sin ninguna
  // pieza con aportes da `{}` — el tipo de sala nunca depende de esto para
  // seguir siendo válido (sección 8).
  const sobreTodos = colocados.flatMap((c) => c.sobre || []);
  const estadisticas = calcularEstadisticas([...colocados, ...colgados, ...techo, ...sobreTodos]);

  return { tipoSalaId, ancho, largo, materialSuelo, materialPared, riqueza, amueblado, semilla, puerta, sala, colocados, colgados, techo, estadisticas, origen: "generado" };
}

module.exports = { colocarSala, crearPRNG };
