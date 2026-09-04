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
const { AnchorType, Priority, RoomTags } = require("./roomTags");
const { resolverFormaSala, elegirFormaSala } = require("./formasSala");

// RoomTags cuya sala fuerza a las piezas repetidas a formar una FILA a lo
// largo de un mismo muro (mismo mecanismo, aplicable a cualquier tag que
// tenga sentido como "escaparate/estantería alineada"): tienda de verdad
// con estanterías en fila, biblioteca con pared de libros, armería con
// expositores de armas en hilera — en vez de una pieza en cada muro.
const TAGS_FILA_PARED = [RoomTags.COMUN_TIENDA, RoomTags.NOCOMUN_BIBLIOTECA, RoomTags.COMUN_MILITAR];
// RoomTags cuya sala amontona las piezas de almacenaje repetidas en el
// mismo rincón/zona en vez de repartirlas por sitios sueltos de la sala.
const TAGS_RINCON_ALMACEN = [RoomTags.COMUN_ALMACEN];

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

// Coherencia de paleta (GDD sección 8: "material por nivel de planta" +
// materialesPreferidos de tipos_edificio.json, hasta ahora dato muerto para
// interiores — edificio.js solo lo copiaba al resultado sin filtrar nada).
// NUNCA es un filtro duro: es un SESGO de probabilidad sobre el material de
// siempre (defSala.materialSuelo/materialPared) — un material solo entra
// como candidato si YA se usa para ese plano en alguna sala de la MISMA
// categoria (tipos_sala.json) y si su riquezaTipica (materiales.json)
// admite la riqueza de esta sala; así nunca aparece un papel_pintado en una
// choza humilde solo porque el edificio "prefiera" ese material en teoría.
// Mismo criterio que cacheAlternativasMaterial de abajo: construirCatalogoContenido re-deriva
// categoría/subcategoría/tags de las 716 entradas de elementos.json (regex incluidas) — sin
// cachear, colocarSala() lo repetía DESDE CERO por cada sala de cada edificio del bake (varias
// plantas × varias salas × decenas de edificios), aunque `catalogos` sea siempre el mismo objeto
// cargado una vez al arrancar el bake (perfilado en la auditoría de rendimiento de 2026-09-02:
// ~5.4% de los ticks de un bake de capital_jarl).
const cacheCatalogoContenido = new WeakMap();
function catalogoContenidoCacheado(catalogos) {
  let cache = cacheCatalogoContenido.get(catalogos);
  if (!cache) {
    cache = construirCatalogoContenido(catalogos);
    cacheCatalogoContenido.set(catalogos, cache);
  }
  return cache;
}

const cacheAlternativasMaterial = new WeakMap();
function alternativasMaterialPorCategoria(catalogos) {
  let cache = cacheAlternativasMaterial.get(catalogos);
  if (cache) return cache;
  const porCategoriaSuelo = {};
  const porCategoriaPared = {};
  for (const def of Object.values(catalogos.tiposSala)) {
    if (!def || !def.categoria) continue;
    (porCategoriaSuelo[def.categoria] ??= new Set()).add(def.materialSuelo);
    (porCategoriaPared[def.categoria] ??= new Set()).add(def.materialPared);
  }
  cache = { suelo: porCategoriaSuelo, pared: porCategoriaPared };
  cacheAlternativasMaterial.set(catalogos, cache);
  return cache;
}

// Tendencia por nivel de planta (GDD sección 8, pendiente hasta ahora):
// piedra en sótano/planta baja, madera en plantas altas — tabla simple,
// se combina (no sustituye) con materialesPreferidos del edificio.
function materialesPreferidosPorNivel(nivel) {
  if (nivel === undefined || nivel === null) return [];
  if (nivel < 0) return ["piedra"];
  if (nivel === 0) return ["piedra", "madera"];
  return ["madera"];
}

const PROBABILIDAD_SESGO_MATERIAL = 0.6;
function elegirMaterialConSesgo({ plano, materialBase, categoriaSala, riqueza, preferencias, catalogos, rnd }) {
  if (!preferencias || preferencias.length === 0) return materialBase;
  const validosPorCategoria = alternativasMaterialPorCategoria(catalogos)[plano];
  const validos = validosPorCategoria[categoriaSala];
  if (!validos) return materialBase;
  const candidatos = preferencias.filter((m) => {
    if (m === materialBase || !validos.has(m)) return false;
    const def = catalogos.materiales[m];
    return !!def && (def.riquezaTipica || []).includes(riqueza);
  });
  if (candidatos.length === 0) return materialBase;
  if (rnd() >= PROBABILIDAD_SESGO_MATERIAL) return materialBase;
  return candidatos[Math.floor(rnd() * candidatos.length)];
}

// Cierra el ciclo de `estado` (GDD sección 9bis/9quater): hasta ahora
// siempre {desgastado:false, roto:false, sucio:false} — "preparado desde ya
// sin mecánica que lo altere". PRNG PROPIO por instancia (no el `rnd`
// compartido de la sala): así no perturba el orden de colocación de nada,
// exactamente igual que `elegirVariante` ya deriva su propio PRNG de
// `instanceId`. Una pieza rota siempre está también desgastada (roto
// implica desgastado, nunca al revés) — una sala noble prácticamente nunca
// tiene nada roto/sucio, una humilde bastante más.
const PROB_DESGASTADO_POR_RIQUEZA = { humilde: 0.35, modesta: 0.15, noble: 0.03 };
const PROB_SUCIO_POR_RIQUEZA = { humilde: 0.25, modesta: 0.08, noble: 0.0 };
const PROB_ROTO_SI_DESGASTADO = 0.15;
function calcularEstadoDesgaste(instanceId, riqueza) {
  const rndEstado = crearPRNG(`${instanceId}:estado`);
  const probDesgastado = PROB_DESGASTADO_POR_RIQUEZA[riqueza] ?? PROB_DESGASTADO_POR_RIQUEZA.modesta;
  const probSucio = PROB_SUCIO_POR_RIQUEZA[riqueza] ?? PROB_SUCIO_POR_RIQUEZA.modesta;
  const desgastado = rndEstado() < probDesgastado;
  const roto = desgastado && rndEstado() < PROB_ROTO_SI_DESGASTADO;
  const sucio = rndEstado() < probSucio;
  return { desgastado, roto, sucio };
}

function colocarSala({ tipoSalaId, catalogos, riqueza = "modesta", amueblado = "completo", semilla = "prueba", anchoForzado, largoForzado, temaProfesion, permiteVentanas = true, materialesPreferidos, nivel, formaSalaForzada }) {
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
  const preferenciasMateriales = [...(materialesPreferidos || []), ...materialesPreferidosPorNivel(nivel)];
  const materialSuelo = elegirMaterialConSesgo({ plano: "suelo", materialBase: defSala.materialSuelo, categoriaSala: defSala.categoria, riqueza, preferencias: preferenciasMateriales, catalogos, rnd });
  const materialPared = elegirMaterialConSesgo({ plano: "pared", materialBase: defSala.materialPared, categoriaSala: defSala.categoria, riqueza, preferencias: preferenciasMateriales, catalogos, rnd });

  // Forma de la sala (docs/GDD_Bakeador_Interiores.md sección 2, catálogo
  // interiores/catalogo/formasSala.json — NO es WFC, es un catálogo de ~15
  // plantillas con variación de tamaño, pedido explícito del streamer):
  // `mascaraGrid` es boolean[largo][ancho] o null si esta sala se queda con
  // el rectángulo de siempre (la inmensa mayoría — categoría no elegible,
  // sala pequeña, o simplemente no tocó por probabilidad/validación). Con
  // null, `esSuelo` degrada a exactamente "dentro de la caja" — cero
  // diferencia de comportamiento con el motor anterior a este catálogo.
  // `formaSalaForzada` (opcional): usado por edicion.js:regenerarMobiliario
  // para forzar la MISMA plantilla que ya tenía la sala (junto con
  // anchoForzado/largoForzado) — sin esto, "regenerar solo el mobiliario"
  // podía devolver una sala de forma distinta a la que el jugador ya veía,
  // rompiendo la promesa de edición no destructiva a nivel de forma.
  const formaSalaId = formaSalaForzada ?? elegirFormaSala({ tipoSalaId, defSala, catalogoFormas: catalogos.formasSala, semilla, ancho, largo });
  const formaResuelta = formaSalaId === "rectangulo" ? null : resolverFormaSala({ catalogoFormas: catalogos.formasSala, formaId: formaSalaId, ancho, largo, semilla });
  const mascaraGrid = formaResuelta ? formaResuelta.grid : null;
  const esSuelo = (x, y) => x >= 0 && y >= 0 && x < ancho && y < largo && (!mascaraGrid || mascaraGrid[y][x]);

  // El muro NO ocupa ninguna casilla propia — es un límite sin grosor en
  // el borde de la sala (o del perímetro real de la máscara, si esta sala
  // salió con una plantilla no rectangular), no una fila/columna de suelo
  // reservada. La puerta, al ser el hueco EN ese límite, cae en y=largo —
  // una fila más allá de la última fila de suelo, en la columna de suelo
  // real más cercana al centro geométrico (con el rectángulo de siempre,
  // eso es simplemente el centro exacto — mascaraValida ya garantiza que
  // la fila sur tiene al menos una celda de suelo real donde caer).
  let xPuertaObjetivo = Math.floor(ancho / 2);
  if (mascaraGrid) {
    let mejorDist = Infinity;
    for (let x = 0; x < ancho; x++) {
      if (!mascaraGrid[largo - 1][x]) continue;
      const d = Math.abs(x - xPuertaObjetivo);
      if (d < mejorDist) { mejorDist = d; xPuertaObjetivo = x; }
    }
  }
  // origen:"generado" (edicion.js sección "puertas y ventanas como
  // instancia editable", 2026-09-04): mismo campo que ya lleva cada mueble
  // — moverPuerta() lo pone a "modificado" al reubicarla a mano, y
  // regenerarMobiliario respeta una puerta modificada exactamente igual
  // que ya respeta un mueble modificado (no la pisa salvo forzar:true).
  const puerta = { lado: "sur", x: xPuertaObjetivo, y: largo, origen: "generado" };

  // Ocupación de suelo: true = libre. Con rectángulo (mascaraGrid null),
  // todo el rectángulo ancho x largo es suelo real, no hay anillo exterior
  // reservado para muro — con una plantilla no rectangular, las celdas
  // fuera de la máscara nacen ya ocupadas (nunca libres), así ninguna
  // función de colocación de más abajo necesita saber que existe una
  // máscara: simplemente nunca encuentran hueco ahí.
  const libreSuelo = [];
  for (let y = 0; y < largo; y++) {
    const fila = new Array(ancho).fill(true);
    if (mascaraGrid) for (let x = 0; x < ancho; x++) if (!mascaraGrid[y][x]) fila[x] = false;
    libreSuelo.push(fila);
  }

  const esPuerta = (x, y) => x === puerta.x && y === puerta.y;
  // Toca pared: cualquier celda de suelo real con al menos un vecino que NO
  // es suelo real — con rectángulo eso es solo el borde de la caja (mismo
  // resultado exacto que antes); con una plantilla no rectangular incluye
  // también los muros internos que crea un mordisco/concavidad (una L
  // "toca pared" en su rincón interior tanto como en el borde exterior).
  const tocaPared = (x, y) => esSuelo(x, y) && (!esSuelo(x - 1, y) || !esSuelo(x + 1, y) || !esSuelo(x, y - 1) || !esSuelo(x, y + 1));
  // Una huella entera cae en suelo real (no solo su esquina) — usado donde
  // hace falta validar contra la máscara SIN pasar por libreSuelo (decals de
  // suelo, que nunca llaman a `ocupar`).
  const huellaEnSuelo = (x, y, hw, hl) => {
    for (let dy = 0; dy < hl; dy++) for (let dx = 0; dx < hw; dx++) if (!esSuelo(x + dx, y + dy)) return false;
    return true;
  };

  // Rejilla real de tiles (sección 2 del pedido de integración): solo las
  // celdas de suelo real (toda la caja con rectángulo, la máscara si esta
  // sala salió con plantilla) se marcan SUELO — el resto de la caja
  // delimitadora se queda TIPO_TILE.PARED (relleno inicial de crearRejilla),
  // exactamente como cualquier otra celda fuera de la sala: es EXACTO lo
  // que hace que `detectarSalas` (flood-fill) dibuje el perímetro real de
  // la forma, mordiscos/concavidades incluidos, sin ningún caso especial.
  // Una fila extra de colchón (largo+1) solo para poder marcar el hueco de
  // la puerta como PUERTA de verdad — esa fila colchón no es suelo de la
  // sala, es lo que hay justo al otro lado del límite. `detectarSalas` la
  // reduce a un objeto Sala (tiles + aberturas) que no sabe ni le importa
  // que esta forma viniera de un rectángulo, una plantilla de catálogo o
  // una selección manual — es la misma estructura para las tres. Esa Sala
  // es también la base del chequeo de circulación de las funciones de
  // colocación de abajo (sección 6).
  const rejilla = crearRejilla(ancho, largo + 1, TIPO_TILE.PARED);
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) if (esSuelo(x, y)) rejilla.set(x, y, TIPO_TILE.SUELO);
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
  const bordesOcupados = new Set(); // "x_y" de segmentos de pared ya usados por colgadoEnPared o por una ventana

  // Ventanas reales (GDD_Bakeador_Interiores sección 7bis, implementado
  // 2026-08-30 — antes solo existían como combinatoria de catálogo, nunca
  // se instanciaban): estructura, igual que la puerta — se generan SIEMPRE
  // (ni `amueblado:"vacio"` las omite), nunca si `permiteVentanas` es false
  // (edificio.js lo pone a false en bodega y en el pasillo: la bodega no
  // tiene fachada de verdad y el norte del pasillo da a la fila de salas de
  // encima, no a fuera). Solo en el muro NORTE: en el layout de fila de
  // `generarPlanta` (edificio.js) es el ÚNICO lado que nunca tiene puerta
  // ni sala vecina (las filas crecen en X, alineadas por el muro SUR) — sin
  // un footprint real de edificio que decir qué da "a la calle", es el
  // único lado del que se puede afirmar con certeza que da a fuera.
  const ventanas = [];
  if (permiteVentanas) {
    // PRNG PROPIO (no el `rnd` de la sala): las ventanas son estructura,
    // independiente de qué mobiliario le toque a esta sala — si compartieran
    // el `rnd` de siempre, generar ventanas ANTES del resto de la función
    // desplazaría la secuencia aleatoria de todo lo que viene después
    // (mobiliario, y por tanto qué casillas quedan libres para el conector
    // vertical que busca `edificio.js`), cambiando el resultado de semillas
    // YA EXISTENTES para piezas que no tienen nada que ver con ventanas
    // (encontrado bakeando de verdad: torre_mago/semilla-a se quedaba sin
    // hueco para su escalera). Con PRNG propio, añadir ventanas no mueve ni
    // una sola tirada de las demás piezas de la sala.
    const rndVentanas = crearPRNG(`${semilla}:${tipoSalaId}:ventanas`);
    const elegirEnteroVentanas = (min, max) => min + Math.floor(rndVentanas() * (max - min + 1));
    const ejeValido = (eje) =>
      Object.entries(catalogos.ventanas?.[eje] || {})
        .filter(([id]) => !id.startsWith("_"))
        .filter(([, def]) => riquezaAlcanza(riqueza, def.riquezaMinima));
    const formasValidas = ejeValido("forma");
    const tamanosValidos = ejeValido("tamano");
    const marcosValidos = ejeValido("marco");
    const cristalesValidos = ejeValido("cristal");

    if (formasValidas.length && tamanosValidos.length && marcosValidos.length && cristalesValidos.length) {
      // Más riqueza, más ventanas — mismo criterio que LIMITE_POR_CAPA_POR_RIQUEZA
      // de mobiliario más abajo, acotado además por lo que quepa en `ancho`.
      const LIMITE_VENTANAS_POR_RIQUEZA = { humilde: 1, modesta: 2, noble: 3 };
      const maxVentanas = LIMITE_VENTANAS_POR_RIQUEZA[riqueza] ?? 2;
      let intentos = 0;
      while (ventanas.length < maxVentanas && intentos < maxVentanas * 8) {
        intentos++;
        const [formaId, formaDef] = formasValidas[elegirEnteroVentanas(0, formasValidas.length - 1)];
        const [tamanoId, tamanoDef] = tamanosValidos[elegirEnteroVentanas(0, tamanosValidos.length - 1)];
        const [marcoId] = marcosValidos[elegirEnteroVentanas(0, marcosValidos.length - 1)];
        const [cristalId, cristalDef] = cristalesValidos[elegirEnteroVentanas(0, cristalesValidos.length - 1)];
        const anchoVentana = tamanoDef.anchoTiles;
        if (anchoVentana > ancho) continue;
        const x = elegirEnteroVentanas(0, ancho - anchoVentana);
        let libre = true;
        for (let dx = 0; dx < anchoVentana; dx++) {
          // esSuelo(x+dx,0): con una plantilla no rectangular, la fila norte
          // puede tener tramos sin suelo real detrás (una U abierta al
          // norte, un nicho central...) — ahí no hay pared de verdad que
          // agujerear, así que ninguna ventana puede caer encima.
          if (bordesOcupados.has(`${x + dx}_0`) || !esSuelo(x + dx, 0)) { libre = false; break; }
        }
        if (!libre) continue;
        for (let dx = 0; dx < anchoVentana; dx++) bordesOcupados.add(`${x + dx}_0`);

        // aporteLuz (GDD_Bakeador_Interiores §7bis): tamano.aporteLuz (solo
        // tronera) sustituye por completo el factor de tamaño normal — su
        // geometría de aspillera no escala como ancho×altura; el resto usa
        // anchoTiles × 0.6 si es alta-y-estrecha (altaEnPared) o × 1 si no.
        // cristal.aporteLuz (solo esmerilado) es un MULTIPLICADOR aparte —
        // "deja pasar luz pero no forma", combina con cualquier tamaño (una
        // tronera esmerilada, rara pero posible, da 0.2×0.5=0.1: casi opaca).
        const factorTamano = tamanoDef.aporteLuz ?? tamanoDef.anchoTiles * (tamanoDef.altaEnPared ? 0.6 : 1);
        const factorCristal = cristalDef.aporteLuz ?? 1;
        const aporteLuz = Math.round(factorTamano * factorCristal * 100) / 100;

        // instanceId+origen (edicion.js sección "puertas y ventanas como
        // instancia editable", 2026-09-04): mismo contrato que ya usa
        // marcarGenerado() para el mobiliario — un id estable por
        // INSTANCIA (no por tipo) para que el editor pueda seleccionar/
        // mover/eliminar una ventana concreta sin ambigüedad, y origen
        // "generado" para que regenerarMobiliario sepa que esta es
        // descartable en la próxima regeneración (a diferencia de una
        // añadida/movida a mano, que edicion.js marca "modificado"). `y`
        // (siempre 0 aquí: única generación automática, muro norte) viaja
        // igual que `x` para que edicion.js pueda tratar los 4 lados con
        // la misma fórmula sin caso especial para lo que generó el bake.
        ventanas.push({
          instanceId: `${tipoSalaId}_${semilla}_ventana_${ventanas.length}`,
          x, y: 0, lado: "norte", ancho: anchoVentana,
          forma: formaId, tamano: tamanoId, marco: marcoId, cristal: cristalId,
          aporteLuz,
          colorDebug: formaDef.colorDebug || "#a9c9d6",
          origen: "generado",
        });
      }
    }
  }

  // Reglas por RoomTag (tipos_sala.json campo `tags`, ver roomTags.js):
  // que una sala etiquetada COMUN_TIENDA/COMUN_ALMACEN se NOTE en el
  // plano, no solo en qué piezas admite — mismas estanterías/vitrinas en
  // fila a lo largo de un muro (tienda) o mismas cajas/cestos/barriles
  // amontonados en un rincón (almacén), en vez de repartidos al azar por
  // toda la sala. `ultimaPosicionPorId` es la memoria que usan
  // `intentarPegadoAPared`/`intentarColocarEnSuelo` para saber dónde cayó
  // la última instancia de cada `id` y intentar la siguiente pegada a esa.
  const tagsSala = defSala.tags || [];
  const ultimaPosicionPorId = new Map();

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

  // Sesgo de orden (nunca bloqueo duro) contra el estrechamiento de la
  // circulación: distancia mínima de una huella a la línea recta entre el
  // origen de circulación (la puerta) y el centro geométrico de la sala —
  // no es un grafo de visibilidad real (sería sobre-ingeniería para salas
  // de 10-20 piezas), solo una aproximación barata para que el mobiliario
  // "de relleno" (armarios, estanterías...) prefiera los huecos que NO
  // estrechan pieza a pieza el paso natural puerta→centro, dejando ese
  // pasillo más despejado sin reservar nada por adelantado (circulacionIntacta
  // ya sigue siendo la única autoridad real sobre bloqueo duro).
  function distanciaALineaCirculacion(x, y, hw, hl) {
    const [ox, oy] = origenCirculacion;
    const cx = (ancho - 1) / 2;
    const cy = (largo - 1) / 2;
    const pasos = Math.max(Math.round(Math.max(Math.abs(cx - ox), Math.abs(cy - oy))), 1);
    let mejor = Infinity;
    for (let p = 0; p <= pasos; p++) {
      const lx = ox + ((cx - ox) * p) / pasos;
      const ly = oy + ((cy - oy) * p) / pasos;
      for (let dy = 0; dy < hl; dy++) {
        for (let dx = 0; dx < hw; dx++) {
          mejor = Math.min(mejor, Math.hypot(x + dx - lx, y + dy - ly));
        }
      }
    }
    return mejor;
  }

  // Fallback genérico (usado por "libre" y como último recurso si la
  // colocación sistemática de abajo no encuentra sitio en ningún muro/
  // centro): posición al azar entre 25 intentos, orientación al azar.
  function intentarColocarEnSuelo(el) {
    const intentos = 25;
    const preferido = el.colocacion.find((c) => c === "esquina" || c === "pegadaAPared" || c === "centroSala" || c === "libre" || c === "juntoAMesa" || c === "simetrico");
    // Mismo agrupamiento de COMUN_ALMACEN que intentarPegadoAPared, para
    // contenedores "libre" (cajas, sacos...) que no van a esquina: la
    // mayoría de intentos caen cerca de la última instancia de ESTA misma
    // pieza (radio creciente si no encuentra hueco), no en cualquier punto
    // suelto de la sala — así salen amontonados, no esparcidos.
    const agruparAlmacen = tagsSala.some((t) => TAGS_RINCON_ALMACEN.includes(t)) && el.esContenedor && preferido === "libre";
    const previa = agruparAlmacen ? ultimaPosicionPorId.get(el.id) : undefined;
    for (let i = 0; i < intentos; i++) {
      let x, y;
      if (previa && i < intentos * 0.7) {
        const radio = 1 + Math.floor(i / 5);
        x = Math.max(0, Math.min(ancho - 1, previa.x + elegirEntero(-radio, radio)));
        y = Math.max(0, Math.min(largo - 1, previa.y + elegirEntero(-radio, radio)));
      } else {
        x = elegirEntero(0, ancho - 1);
        y = elegirEntero(0, largo - 1);
      }
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
      if (agruparAlmacen) ultimaPosicionPorId.set(el.id, { x, y });
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
    const gradosPorLado = { norte: 0, sur: 180, oeste: 270, este: 90 };

    // Agrupamiento por RoomTag (sección nueva: "que se note que es una
    // tienda/almacén, no piezas sueltas repartidas al azar"). Dos casos:
    // - COMUN_TIENDA + mueble de pared que NO es el ancla de la sala
    //   (mostrador ya es esSuperficie:true y se queda único): estanterías,
    //   vitrinas... repiten SIEMPRE en el mismo muro que la vez anterior,
    //   pegadas a la anterior — así salen en fila, como una tienda de
    //   verdad, en vez de una en cada pared.
    // - COMUN_ALMACEN + colocación de esquina (cajas, cestos, barriles,
    //   sacos son CORNER): repiten cerca del último sitio en vez de cada
    //   una en una esquina distinta de la sala — un rincón de trastos
    //   amontonados, no cuatro esquinas con una caja suelta cada una.
    const agruparEnFila = tagsSala.some((t) => TAGS_FILA_PARED.includes(t)) && !priorizarEsquina && !el.esSuperficie;
    const agruparEnRincon = tagsSala.some((t) => TAGS_RINCON_ALMACEN.includes(t)) && priorizarEsquina;
    const previa = (agruparEnFila || agruparEnRincon) ? ultimaPosicionPorId.get(el.id) : undefined;

    let lados = barajar(["norte", "sur", "este", "oeste"], rnd);
    if (previa) lados = [previa.lado, ...lados.filter((l) => l !== previa.lado)];

    for (const lado of lados) {
      const grados = gradosPorLado[lado];
      const huellaRot = rotarHuella(huellaBase, grados);
      let candidatos = candidatosPegadoAPared(lado, huellaRot);
      if (candidatos.length === 0) continue;
      if (previa && lado === previa.lado) {
        // Más cerca del último sitio de ESTA misma pieza primero (jitter
        // pequeño para no ser 100% determinista entre semillas iguales).
        const distAPrevia = ([x, y]) => Math.abs(x - previa.x) + Math.abs(y - previa.y);
        candidatos = candidatos.map((c) => [c, distAPrevia(c) + rnd() * 0.5]).sort((a, b) => a[1] - b[1]).map(([c]) => c);
      } else if (priorizarEsquina) {
        const maxX = ancho - huellaRot[0];
        const maxY = largo - huellaRot[1];
        const distAExtremo = ([x, y]) => (lado === "norte" || lado === "sur" ? Math.min(x, maxX - x) : Math.min(y, maxY - y));
        candidatos = candidatos
          .map((c) => [c, distAExtremo(c) + rnd() * 0.5])
          .sort((a, b) => a[1] - b[1])
          .map(([c]) => c);
      } else {
        // Sin prioridad de esquina ni repetición pegada a la anterior (el
        // caso normal de un armario/estantería de relleno): preferir huecos
        // lejos de la línea puerta→centro, con jitter para no ser rígido.
        candidatos = candidatos
          .map((c) => [c, -distanciaALineaCirculacion(c[0], c[1], huellaRot[0], huellaRot[1]) + rnd() * 1.5])
          .sort((a, b) => a[1] - b[1])
          .map(([c]) => c);
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
        if (agruparEnFila || agruparEnRincon) ultimaPosicionPorId.set(el.id, { x, y, lado });
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

  // Decoración de suelo sin volumen (alfombras): NUNCA llama a `ocupar`/
  // `ocuparSiCirculacionIntacta` — el mobiliario real que se coloque
  // después puede caer encima sin problema, y una alfombra grande jamás
  // "bloquea el paso" aunque cubra media sala. Solo se evita que dos
  // alfombras queden exactamente superpuestas entre sí (registro propio
  // `decalsSuelo`, independiente de `libreSuelo`).
  const decalsSuelo = [];
  function solapaOtroDecal(x, y, hw, hl) {
    return decalsSuelo.some((d) => x < d.x + d.ancho && x + hw > d.x && y < d.y + d.largo && y + hl > d.y);
  }
  function intentarDecalSuelo(el) {
    const huellaBase = el.huella || [1, 1];
    const orientacionesDisponibles = el.rotacionesPermitidas || ORIENTACIONES;
    const intentos = 20;
    for (let i = 0; i < intentos; i++) {
      const grados = orientacionesDisponibles[elegirEntero(0, orientacionesDisponibles.length - 1)];
      const [hw, hl] = rotarHuella(huellaBase, grados);
      if (hw > ancho || hl > largo) continue;
      const x = elegirEntero(0, ancho - hw);
      const y = elegirEntero(0, largo - hl);
      if (solapaOtroDecal(x, y, hw, hl)) continue;
      // Los decals nunca llaman a ocupar()/huecoLibre (pueden convivir con
      // mobiliario encima, ver comentario de la función) — así que aquí SÍ
      // hace falta comprobar la máscara a mano: una alfombra no puede caer
      // parcialmente fuera del suelo real de una sala no rectangular.
      if (!huellaEnSuelo(x, y, hw, hl)) continue;
      const item = { id: el.id, x, y, ancho: hw, largo: hl, rotacion: grados, colorDebug: el.colorDebug, capa: el.capa };
      if (el.aportes) item.aportes = el.aportes;
      decalsSuelo.push({ x, y, ancho: hw, largo: hl });
      colocados.push(item);
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
      // Con una plantilla no rectangular, un borde de la caja delimitadora
      // puede no tener suelo real detrás (p.ej. las esquinas de una L) — no
      // hay pared de verdad ahí, nada que colgar.
      if (!esSuelo(x, y)) continue;
      const clave = `${x}_${y}`;
      if (bordesOcupados.has(clave)) continue;
      bordesOcupados.add(clave);
      const item = { id: el.id, x, y, lado, colorDebug: el.colorDebug, capa: el.capa };
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
          const item = { id: el.id, colorDebug: el.colorDebug, capa: el.capa };
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

      case AnchorType.FLOOR_DECAL:
        return intentarDecalSuelo(el);

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

  // Los topes escalan con la riqueza — antes eran un número fijo
  // (4/9/3/3) para cualquier sala, así que una casa humilde y una noble
  // salían igual de llenas, con solo la calidad de la variante cambiando.
  // Ahora una sala humilde sale claramente más vacía Y más sucia (menos
  // decorMovible/iluminacion, más suciedad), y una noble sale mucho más
  // cargada de mobiliario y decoración (más del doble que antes) y sin
  // suciedad — "una casa con 4 muebles" vs. "una sala noble a rebosar",
  // en vez de la misma cantidad con distinto material.
  const LIMITE_POR_CAPA_POR_RIQUEZA = {
    humilde: { decorFija: 2, decorMovible: 5, iluminacion: 1, suciedad: 5 },
    modesta: { decorFija: 4, decorMovible: 10, iluminacion: 3, suciedad: 2 },
    noble: { decorFija: 9, decorMovible: 20, iluminacion: 6, suciedad: 0 },
  };
  // Además de la riqueza, el tamaño REAL de esta instancia de sala frente
  // al tamaño típico de su tipo (defSala.anchoTiles/largoTiles) escala los
  // topes otra vez — así un gran_salon que salió especialmente grande
  // saca más partido a ese espacio de más (más piezas, o más repeticiones
  // coherentes de las mismas, ver más abajo) en vez de quedarse con el
  // mismo tope que una instancia típica del mismo tipo. Acotado a
  // [0.6x, 2.5x] para no vaciar de golpe una sala pequeña ni disparar el
  // conteo en una gigante.
  const areaTipica = ((defSala.anchoTiles[0] + defSala.anchoTiles[1]) / 2) * ((defSala.largoTiles[0] + defSala.largoTiles[1]) / 2);
  const factorTamano = areaTipica > 0 ? Math.min(1.8, Math.max(0.6, (ancho * largo) / areaTipica)) : 1;
  const baseRiqueza = LIMITE_POR_CAPA_POR_RIQUEZA[riqueza] || LIMITE_POR_CAPA_POR_RIQUEZA.modesta;
  const LIMITE_POR_CAPA = Object.fromEntries(
    Object.entries(baseRiqueza).map(([capa, tope]) => [capa, tope > 0 ? Math.max(1, Math.round(tope * factorTamano)) : 0]),
  );

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
        .filter((el) => riquezaAlcanza(riqueza, el.riquezaMinima))
        // `temasProfesion` (opcional): si la pieza lo declara, solo sale
        // cuando la sala pertenece a ESE oficio (ej. fragua/yunque solo en
        // temaProfesion:"herreria", no en cualquier "taller" genérico). Sin
        // el campo, la pieza sigue siendo universal — cero cambio para el
        // resto del catálogo. Si la sala no tiene tema asignado, las
        // piezas con `temasProfesion` simplemente no salen (evita mezclar
        // fragua+telar+alambique en un taller sin oficio identificado).
        .filter((el) => !el.temasProfesion || (temaProfesion && el.temasProfesion.includes(temaProfesion)))
        // `requiereItemColocar`: la pieza solo debe existir si un jugador la
        // crafteó y la plantó a mano (docs/GDD_Profesiones.md "Objetos
        // Decorativos Exclusivos", docs/GDD_Instrumentos.md) — nunca puesta
        // por el bake. Bug real descubierto al añadir los instrumentos
        // musicales (docs/GDD_Instrumentos.md, "no saldrá en spawns"): este
        // filtro no existía, así que las ~60 piezas con requiereItemColocar
        // ya en el catálogo (perchas, trofeos, mesa_comedor_roble...)
        // llevaban tiempo pudiendo salir gratis del bake sin haberse
        // crafteado nunca.
        .filter((el) => !el.requiereItemColocar);

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

      // Camas/literas de dormitorio comunal ("varias literas" en el propio
      // catálogo, GDD_Poblacion_NPCs.md): la pasada normal de arriba coloca
      // isMandatory UNA vez y ya lo marca en idsYaUsados, así que sin esto
      // un dormitorio_comunal grande salía con 1 litera igual que uno
      // pequeño. `repetirPorArea` (opcional, en elementos.json) manda a
      // colocar varias más según el área de ESTA sala, acotado a su tope —
      // fuera del presupuesto LIMITE_POR_CAPA (una cama no es decoración
      // negociable, es la capacidad real de la sala).
      for (const el of candidatos) {
        if (!el.isMandatory || !el.repetirPorArea || !idsYaUsados.has(el.id)) continue;
        if (!(el.repetirPorArea.salas || []).includes(tipoSalaId)) continue;
        const objetivo = Math.max(
          1,
          Math.min(el.repetirPorArea.maximo ?? 99, Math.floor((ancho * largo) / el.repetirPorArea.tilesPorInstancia)),
        );
        let colocadas = 1; // la que ya puso la pasada normal de arriba
        while (colocadas < objetivo && colocarUno(el)) colocadas++;
      }

      // Segunda pasada: repetición coherente. Si tras colocar una vez cada
      // pieza distinta todavía sobra presupuesto de la capa (sala grande
      // y/o noble, ver LIMITE_POR_CAPA de arriba), se repiten piezas ya
      // vistas en vez de dejar la sala con hueco vacío — nunca anclas
      // obligatorias (`isMandatory`) ni superficies (`esSuperficie`, cada
      // mesa/mostrador sigue siendo única) ni satélites "juntoAMesa" (esos
      // ya tienen su propio mecanismo de repetición arriba). Encaja con lo
      // que ya pasa de forma natural con `variantesNombradas`: un segundo
      // armario en la misma sala casi nunca sale idéntico al primero.
      // Tope de 1 repetición POR PIEZA (además de la vez normal ya
      // colocada arriba, así que 2 apariciones como máximo) — sin esto, en
      // una sala grande/noble con pocos candidatos válidos (ej. un taller
      // pequeño con un único mueble de decoración posible, o una letrina
      // con solo 3-4 objetos distintos) el presupuesto sobrante se lo
      // llevaba entero un solo tipo de pieza (8 vitrinas idénticas en una
      // joyería, o 3 cubos de basura en una letrina de 4x4, medido con
      // casos reales), en vez de repartirse entre varias piezas distintas
      // como cabría esperar — la variedad viene de tener MÁS piezas
      // distintas en el catálogo, no de repetir la misma muchas veces.
      const MAX_REPETICIONES_POR_ID = 1;
      if (colocadosEnCapa < LIMITE_POR_CAPA[capa]) {
        const repetibles = candidatos.filter((el) => !el.isMandatory && !el.esSuperficie && !el.colocacion.includes("juntoAMesa"));
        const repeticionesPorId = new Map();
        let intentosSinProgreso = 0;
        while (colocadosEnCapa < LIMITE_POR_CAPA[capa] && repetibles.length > 0 && intentosSinProgreso < repetibles.length * 2) {
          const el = repetibles[elegirEntero(0, repetibles.length - 1)];
          const usadas = repeticionesPorId.get(el.id) || 0;
          if (usadas >= MAX_REPETICIONES_POR_ID) {
            intentosSinProgreso++;
            continue;
          }
          if (colocarUno(el)) {
            colocadosEnCapa++;
            repeticionesPorId.set(el.id, usadas + 1);
            intentosSinProgreso = 0;
          } else {
            intentosSinProgreso++;
          }
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
  const catalogoContenido = catalogoContenidoCacheado(catalogos);
  let contadorInstancia = 0;
  const marcarGenerado = (item) => {
    item.instanceId = `${tipoSalaId}_${semilla}_${contadorInstancia++}`;
    item.origen = "generado";
    item.estado = calcularEstadoDesgaste(item.instanceId, riqueza);
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

  // bordesOcupados expuesto (antes solo local, se descartaba al salir):
  // edificio.js lo necesita para su propia post-pasada de ventanas exteriores
  // (sección 7 del GDD) — saber qué segmentos de pared ya usó un
  // colgadoEnPared o una ventana de esta sala para no clavar otra encima.
  // `mascara` (solo si esta sala salió con plantilla no rectangular): MISMO
  // formato string 'ancho*largo' de '1'/'0' (fila a fila) que ya usan las
  // salas orgánicas de mazmorras/src/celular.js — server/src/mundo/
  // interiorColision.ts ya sabe leer ese campo tal cual, cero cambio ahí.
  // `formaSalaId` viaja aparte solo para depuración/editor (qué plantilla
  // de catalogo/formasSala.json produjo esta sala) — nada del motor lo
  // consume para decidir nada, la máscara ya es la fuente de verdad.
  return { tipoSalaId, ancho, largo, materialSuelo, materialPared, riqueza, amueblado, semilla, puerta, sala, colocados, colgados, techo, ventanas, estadisticas, bordesOcupados: [...bordesOcupados], mascara: formaResuelta ? formaResuelta.mascaraStr : undefined, formaSalaId: formaResuelta ? formaSalaId : "rectangulo", origen: "generado" };
}

module.exports = { colocarSala, crearPRNG };
