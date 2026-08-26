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

// Capas incluidas según el nivel de amueblado (GDD sección 1).
const CAPAS_POR_AMUEBLADO = {
  vacio: [],
  fijo: ["decorFija"],
  completo: ["decorFija", "decorMovible", "iluminacion", "suciedad"],
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

  // Puerta en el punto medio del lado sur.
  const puerta = { lado: "sur", x: Math.floor(ancho / 2), y: largo - 1 };

  // Ocupación de suelo interior: true = libre. El anillo exterior (x=0,
  // x=ancho-1, y=0, y=largo-1) representa la pared, no es "suelo".
  const libreSuelo = [];
  for (let y = 0; y < largo; y++) {
    libreSuelo.push(new Array(ancho).fill(true));
  }

  const esBorde = (x, y) => x === 0 || y === 0 || x === ancho - 1 || y === largo - 1;
  const esPuerta = (x, y) => x === puerta.x && y === puerta.y;
  const tocaPared = (x, y) => x === 1 || y === 1 || x === ancho - 2 || y === largo - 2;

  // Rejilla real de tiles (sección 2 del pedido de integración): borde =
  // pared, un hueco en el borde sur = puerta, interior = suelo.
  // `detectarSalas` la reduce a un objeto Sala (tiles + aberturas) que no
  // sabe ni le importa que este rectángulo viniera de un flood-fill, una
  // selección manual o una herramienta rectangular — es la misma forma
  // para las tres. Esa Sala es también la base del chequeo de circulación
  // de las funciones de colocación de abajo (sección 6).
  const rejilla = crearRejilla(ancho, largo, TIPO_TILE.PARED);
  for (let y = 1; y < largo - 1; y++) {
    for (let x = 1; x < ancho - 1; x++) rejilla.set(x, y, TIPO_TILE.SUELO);
  }
  rejilla.set(puerta.x, puerta.y, TIPO_TILE.PUERTA);
  const [sala] = detectarSalas(rejilla);
  const origenCirculacion = [puerta.x, largo - 2]; // tile de suelo justo dentro de la puerta

  function huecoLibre(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    if (x < 1 || y < 1 || x + hw > ancho - 1 || y + hl > largo - 1) return false;
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

  // Fallback genérico (usado por "libre" y como último recurso si la
  // colocación sistemática de abajo no encuentra sitio en ningún muro/
  // centro): posición al azar entre 25 intentos, orientación al azar.
  function intentarColocarEnSuelo(el) {
    const intentos = 25;
    const preferido = el.colocacion.find((c) => c === "esquina" || c === "pegadaAPared" || c === "centroSala" || c === "libre" || c === "juntoAMesa" || c === "simetrico");
    for (let i = 0; i < intentos; i++) {
      const x = elegirEntero(1, ancho - 2);
      const y = elegirEntero(1, largo - 2);
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
      for (let x = 1; x <= ancho - 1 - hw; x++) candidatos.push([x, 1]);
    } else if (lado === "sur") {
      const y = largo - 1 - hl;
      for (let x = 1; x <= ancho - 1 - hw; x++) candidatos.push([x, y]);
    } else if (lado === "oeste") {
      for (let y = 1; y <= largo - 1 - hl; y++) candidatos.push([1, y]);
    } else {
      const x = ancho - 1 - hw;
      for (let y = 1; y <= largo - 1 - hl; y++) candidatos.push([x, y]);
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
        const maxX = ancho - 1 - huellaRot[0];
        const maxY = largo - 1 - huellaRot[1];
        const distAExtremo = ([x, y]) => (lado === "norte" || lado === "sur" ? Math.min(x - 1, maxX - x) : Math.min(y - 1, maxY - y));
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
    for (let y = 1; y <= largo - 2; y++) {
      for (let x = 1; x <= ancho - 2; x++) candidatos.push([x, y, Math.hypot(x - cx, y - cy) + rnd() * 0.75]);
    }
    candidatos.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of candidatos) {
      if (esPuerta(x, y)) continue;
      for (const grados of orientaciones) {
        const huellaRot = rotarHuella(huellaBase, grados);
        if (!huecoLibre(x, y, huellaRot)) continue;
        if (cubreOrigen(x, y, huellaRot)) continue;
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
    return tiles.filter(({ x, y }) => x >= 1 && y >= 1 && x <= ancho - 2 && y <= largo - 2 && !esPuerta(x, y));
  }

  // "juntoAMesa" de verdad: se sienta junto a un ancla (esSuperficie) ya
  // colocada en esta sala, no en un punto aleatorio de la sala — así una
  // silla siempre aparece pegada a una mesa real, nunca suelta por ahí. Si
  // hay varias mesas, reparte entre las que menos sillas tengan todavía.
  // La orientación no es al azar: según de qué lado del ancla venga el
  // hueco, se fuerza el ángulo que hace que el satélite mire HACIA el
  // ancla (misma convención de "0° mira al sur" que intentarPegadoAPared)
  // — una silla al norte de la mesa mira al sur, una al sur mira al
  // norte, etc., así las sillas quedan mirando a la mesa, no de espaldas.
  function intentarJuntoAMesa(el) {
    if (superficies.length === 0) return intentarColocarEnSuelo(el);
    const anclasOrdenadas = superficies.slice().sort((a, b) => (a._satelites || 0) - (b._satelites || 0));
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
      const x = elegirEntero(1, ancho - 1 - hw);
      const y = elegirEntero(1, largo - 1 - hl);
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
      if (lado === "norte") { x = elegirEntero(1, ancho - 2); y = 0; }
      else if (lado === "sur") { x = elegirEntero(1, ancho - 2); y = largo - 1; }
      else if (lado === "oeste") { x = 0; y = elegirEntero(1, largo - 2); }
      else { x = ancho - 1; y = elegirEntero(1, largo - 2); }
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

  function colocarUno(el) {
    if (el.colocacion.includes("sobreSuperficie")) {
      if (superficies.length === 0) return false;
      const host = superficies[elegirEntero(0, superficies.length - 1)];
      host.sobre = host.sobre || [];
      const item = { id: el.id, colorDebug: el.colorDebug };
      if (el.aportes) item.aportes = el.aportes;
      host.sobre.push(item);
      return true;
    }
    if (el.colocacion.includes("techo")) {
      const item = { id: el.id, colorDebug: el.colorDebug };
      if (el.aportes) item.aportes = el.aportes;
      techo.push(item);
      return true;
    }
    if (el.colocacion.includes("colgadoEnPared")) {
      return intentarColgarEnPared(el);
    }
    if (el.colocacion.includes("juntoAMesa")) {
      return intentarJuntoAMesa(el);
    }
    if (defSala.simetrico && el.colocacion.length === 1 && el.colocacion[0] === "simetrico") {
      return colocarSimetrico(el);
    }
    // pegadaAPared/esquina/centroSala usan ahora la colocación sistemática
    // (muro escaneado entero con orientación forzada / centro real de la
    // sala) en vez del muestreo al azar de intentarColocarEnSuelo — esa
    // función queda como último recurso si no encuentran sitio de verdad
    // (p.ej. las 4 paredes ya llenas), y sigue siendo la vía normal para
    // "libre".
    if (el.colocacion.includes("pegadaAPared")) return intentarPegadoAPared(el, false) || intentarColocarEnSuelo(el);
    if (el.colocacion.includes("esquina")) return intentarPegadoAPared(el, true) || intentarColocarEnSuelo(el);
    if (el.colocacion.includes("centroSala")) return intentarCentroSala(el) || intentarColocarEnSuelo(el);
    return intentarColocarEnSuelo(el);
  }

  const capasIncluidas = CAPAS_POR_AMUEBLADO[amueblado];
  if (!capasIncluidas) throw new Error(`amueblado desconocido: ${amueblado}`);

  const LIMITE_POR_CAPA = { decorFija: 4, decorMovible: 9, iluminacion: 3, suciedad: 3 };

  for (const capa of capasIncluidas) {
    const candidatos = Object.entries(catalogos.elementos)
      .filter(([id]) => !id.startsWith("_"))
      .map(([id, el]) => ({ id, ...el }))
      .filter((el) => el.capa === capa)
      .filter((el) => (el.tiposSalaValidos || []).includes(tipoSalaId))
      .filter((el) => riquezaAlcanza(riqueza, el.riquezaMinima));

    // Anclas (esSuperficie, ej. mesa_comedor) primero, luego sus satélites
    // (juntoAMesa, ej. silla) — si no, una silla puede intentar colocarse
    // antes de que exista ninguna mesa en la sala y perder su hueco del
    // límite de la capa con un mueble suelto sin relación con nada.
    const rango = (el) => (el.esSuperficie ? 0 : el.colocacion.includes("juntoAMesa") ? 1 : 2);
    const barajados = barajar(candidatos, rnd).sort((a, b) => rango(a) - rango(b));
    let colocadosEnCapa = 0;
    const idsYaUsados = new Set();
    const MAX_SATELITES_POR_TIPO = 4; // ej. hasta 4 sillas repartidas entre las mesas de la sala
    for (const el of barajados) {
      if (colocadosEnCapa >= LIMITE_POR_CAPA[capa]) break;
      if (idsYaUsados.has(el.id)) continue; // no repetir la misma pieza dos veces en una sala pequeña...
      if (el.colocacion.includes("juntoAMesa")) {
        // ...salvo los satélites de un ancla (silla/banco/taburete junto a
        // una mesa): esos sí deben repetirse, es justo lo que da la imagen
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
