"use strict";

const fs = require("fs");
const path = require("path");

const { CapaRuido, crearPRNG, semillaDesdeTexto } = require("./ruido");
const { crearGeneradorBiomas, suavizarBiomas } = require("./biomas");
const { generarHidrologia } = require("./hidrologia");
const { decidirTerreno } = require("./terreno");
const { crearColocadorDecoracion } = require("./decoracion");
const { colocarPOIs } = require("./pois");
const { generarInstanciasPOI } = require("./instanciasPOI");
const { crearBuscadorCaminos } = require("./caminos");
const { normalizarBordes } = require("./bordes");
const { crearExportador } = require("./exportar");
const { generarImagenesResumen } = require("./overview");
const { validarMapa } = require("./validar");

function cargarJSON(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function cargarCatalogos() {
  const carpetaCatalogo = path.join(__dirname, "..", "catalogo");
  return {
    terrenos: cargarJSON(path.join(carpetaCatalogo, "terrenos.json")),
    biomas: cargarJSON(path.join(carpetaCatalogo, "biomas.json")),
    vegetacion: cargarJSON(path.join(carpetaCatalogo, "vegetacion.json")),
    animales: cargarJSON(path.join(carpetaCatalogo, "animales.json")),
    rocas: cargarJSON(path.join(carpetaCatalogo, "rocas.json")),
    pois: cargarJSON(path.join(carpetaCatalogo, "pois.json")),
  };
}

// Pipeline completo del bakeador (GDD sección 12.6), extraído a función
// reutilizable — lo usan tanto el CLI (src/index.js) como el servidor de
// la interfaz gráfica (gui/servidor.js), para no duplicar la lógica.
// onProgreso(mensaje) se llama en cada paso, quien lo use decide si lo
// imprime por consola, lo manda por Server-Sent Events, o lo ignora.
function generarMapa(config, { onProgreso = () => {} } = {}) {
  const t0 = Date.now();
  const catalogos = cargarCatalogos();
  const { terrenos: catalogoTerrenos, biomas: catalogoBiomas, vegetacion: catalogoVegetacion, animales: catalogoAnimales, rocas: catalogoRocas, pois: catalogoPOIs } = catalogos;

  const tamanoChunk = config.tamanoChunk || 32;
  const anchoChunks = config.anchoChunks;
  const altoChunks = config.altoChunks;
  const anchoTiles = anchoChunks * tamanoChunk;
  const altoTiles = altoChunks * tamanoChunk;

  const biomasHabilitados = config.biomasHabilitados.filter((id) => {
    if (!catalogoBiomas[id]) {
      onProgreso(`Aviso: bioma "${id}" no existe en el catálogo, se ignora.`);
      return false;
    }
    return true;
  });

  onProgreso(`Horneando "${config.nombre}" — ${anchoChunks}x${altoChunks} chunks (${anchoTiles}x${altoTiles} casillas), semilla "${config.semilla}"`);
  onProgreso(`Biomas habilitados: ${biomasHabilitados.join(", ")}`);

  // --- 0. Bordes (GDD sección 1) — se normalizan ya aquí porque el tipo de
  // cada lado (mar/montaña/tierra) sesga la elevación desde el principio.
  const bordes = normalizarBordes(config.bordes);

  // --- 1-3. Ruido, clasificación de bioma y suavizado (GDD sección 3) ---
  const generadorBiomas = crearGeneradorBiomas(config.semilla, biomasHabilitados, catalogoBiomas, { anchoTiles, altoTiles, bordes });
  // Ruido de alta frecuencia para elegir entre variantes de terreno del
  // mismo bioma (playa arenosa/rocosa, manchas de césped raído) — ver
  // decidirTerreno en terreno.js.
  const nVarianteTerreno = new CapaRuido(config.semilla + ":varianteterreno", 22);
  const varianteTerrenoEn = (x, y) => nVarianteTerreno.fbm(x, y, 2);
  // Ruido INDEPENDIENTE (escala distinta, misma semilla base) para el
  // subbioma puramente cosmético (colorDebug/textura, nunca mecánica) —
  // pedido 2026-08-29, ver decidirTerreno/SUBVARIANTES en terreno.js.
  const nSubvarianteTerreno = new CapaRuido(config.semilla + ":subvarianteterreno", 17);
  const subvarianteTerrenoEn = (x, y) => nSubvarianteTerreno.fbm(x, y, 2);

  onProgreso("Clasificando biomas...");
  const biomaGrid = new Uint8Array(anchoTiles * altoTiles);
  const bandaGrid = new Uint8Array(anchoTiles * altoTiles);
  const elevacionGrid = new Float32Array(anchoTiles * altoTiles);
  const listaIdsBiomas = Object.keys(catalogoBiomas);
  const idxBiomaDe = new Map(listaIdsBiomas.map((id, i) => [id, i]));
  const biomaDeIdx = (i) => listaIdsBiomas[i];

  for (let y = 0; y < altoTiles; y++) {
    for (let x = 0; x < anchoTiles; x++) {
      const r = generadorBiomas.clasificar(x, y);
      const i = y * anchoTiles + x;
      biomaGrid[i] = idxBiomaDe.get(r.bioma) ?? 0;
      bandaGrid[i] = r.banda;
      elevacionGrid[i] = r.elevacionContinua;
    }
    if (y % Math.max(1, Math.floor(altoTiles / 10)) === 0) {
      onProgreso(`  fila ${y}/${altoTiles}`);
    }
  }
  onProgreso("Suavizando fronteras de bioma...");
  const biomaGridSuave = suavizarBiomas(biomaGrid, anchoTiles, altoTiles, 3);

  // --- 4. Hidrología (GDD sección 4) ---
  onProgreso("Generando hidrología...");
  const pasoHidrologia = config.pasoHidrologia || 16;
  const hidro = generarHidrologia({
    anchoTiles,
    altoTiles,
    paso: pasoHidrologia,
    elevacionEn: (x, y) => elevacionGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)],
    umbralRio: config.umbralRio || 6,
    nivelMar: catalogoBiomas.mar_bajo?.elevacionMax ?? 0.22,
    maxRiosPrincipales: config.maxRiosPrincipales,
    maxLagos: config.maxLagos,
    semilla: config.semilla,
  });
  onProgreso(`  ${hidro.numeroRiosPrincipales} río(s) principal(es), ${hidro.numeroLagos} lago(s).`);

  // --- 5. Colocación de POIs (GDD sección 6) ---
  onProgreso("Colocando POIs...");
  const biomaEnTile = (x, y) => biomaDeIdx(biomaGridSuave[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)]);
  const bandaEnTile = (x, y) => bandaGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)];
  const terrenoBaseEnTile = (x, y) => {
    const b = biomaEnTile(x, y);
    const banda = bandaEnTile(x, y);
    const h = hidro.consultar(x, y);
    const id = decidirTerreno({ biomaId: b, catalogoBiomas, banda, hidro: h, esCamino: false, variante: varianteTerrenoEn(x, y), subvariante: subvarianteTerrenoEn(x, y) });
    return catalogoTerrenos[id];
  };

  const pois = colocarPOIs({
    anchoTiles,
    altoTiles,
    separacionMinima: config.separacionMinimaPOI || 200,
    semilla: config.semilla,
    biomaEn: biomaEnTile,
    terrenoEn: terrenoBaseEnTile,
    bandaEn: bandaEnTile,
    catalogoPOIs,
    probabilidadLegendaria: config.probabilidadLegendaria ?? 0.02,
  });
  onProgreso(`  ${pois.length} POIs colocados.`);

  // Vinculación con ciudades/ e interiores/ (GDD_Sistema_Puertas.md): cada
  // POI con categoria "asentamiento"/"edificio" en el catálogo genera AQUÍ
  // su instancia real (región anidada o edificio suelto+interior) — el
  // mapaId es el nombre de la carpeta de salida (misma convención que usa
  // el cliente vía VITE_RUTA_MAPA=/assets/mapas/<mapaId> y el servidor vía
  // resolverMapa.ts), así que solo tiene sentido cuando el bake vive de
  // verdad bajo assets/mapas/ — un mapa de prueba fuera de ahí sigue
  // funcionando (los portales resultantes simplemente no resuelven en el
  // servidor hasta que se copie a su sitio, igual que ya pasaba con
  // ciudad/portales a mano en hub_test).
  const carpetaSalidaResuelta = path.resolve(config.carpetaSalida || "output");
  const mapaIdPropio = path.basename(carpetaSalidaResuelta);
  const { portales: portalesPOI, objetosPorPOI, decoracionPorPOI } = generarInstanciasPOI({
    pois,
    mapaId: mapaIdPropio,
    carpetaSalida: carpetaSalidaResuelta,
    semillaMundo: config.semilla,
    catalogoPOIs,
    catalogoRocas,
    onProgreso,
  });
  if (objetosPorPOI.size) onProgreso(`  ${objetosPorPOI.size} POI(s) de tipo "edificio" con caja 3D+interior generados.`);
  if (decoracionPorPOI.size) onProgreso(`  ${decoracionPorPOI.size} boca(s) de cueva decoradas con rocas del bioma.`);

  // --- 6. Caminos (GDD sección 7) ---
  // La ciudad capital es opcional y configurable por bake: no todos los
  // mapas son "el mapa principal" que maneja el streamer — un mapa sin
  // ciudad capital simplemente no genera red de caminos (la red es
  // intrínsecamente radial desde un centro; sin centro no hay de dónde
  // partir). ciudadCapital por defecto true para no romper bakes previos.
  const ciudadCapital = config.ciudadCapital !== false;
  const ciudad = ciudadCapital ? config.ciudad || { x: Math.floor(anchoTiles / 2), y: Math.floor(altoTiles / 2) } : null;
  const pasoCaminos = config.pasoCaminos || 32;

  // Claves numéricas (y*anchoTiles+x), no strings `${x}_${y}` — este Set se
  // consulta 41M veces (una por casilla) en el bucle principal más abajo, y
  // un string nuevo por consulta es mucha basura innecesaria en el punto
  // más caliente de todo el pipeline (mismo motivo que el fix de hidrología).
  const tilesCaminoRoad = new Set();
  const dentroDelMapa = (x, y) => x >= 0 && y >= 0 && x < anchoTiles && y < altoTiles;
  const claveTile = (x, y) => y * anchoTiles + x;
  const resultadosCaminos = [];

  if (ciudad) {
    onProgreso("Trazando caminos...");
    const elevacionEnTile = (x, y) => elevacionGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)];
    // Coste por ARISTA, no por nodo: además de la rugosidad del terreno de
    // destino (igual que antes — agua y banda de roca impasables, nieve
    // alta más cara), penaliza la pendiente REAL entre los dos nodos del
    // tramo. Así el propio A*/Dijkstra prefiere rodear una subida en vez
    // de trepar en línea recta, y el zigzag de montaña nace de la ruta
    // real en vez de ser solo un adorno pintado encima (ver
    // marcarSegmentoComoCamino, que ahora solo añade un serpenteo sutil).
    const PESO_PENDIENTE = 35;
    const costoArista = (x0, y0, x1, y1) => {
      const banda1 = bandaEnTile(x1, y1);
      const h1 = hidro.consultar(x1, y1);
      if (h1.esLago || (h1.esRio && banda1 >= 2)) return Infinity;
      if (banda1 === 6) return Infinity;
      const rugosidad = banda1 === 5 ? 4 : 1;
      const distancia = Math.hypot(x1 - x0, y1 - y0) / pasoCaminos;
      const pendiente = Math.abs(elevacionEnTile(x1, y1) - elevacionEnTile(x0, y0));
      return distancia * (rugosidad + pendiente * PESO_PENDIENTE);
    };
    const buscador = crearBuscadorCaminos({ anchoTiles, altoTiles, paso: pasoCaminos, costoArista });

    // Sin maxCaminosAPOIs explícito, el límite escala con el área del mapa —
    // el número de POIs crece con el área, así que un tope fijo (el 40 de
    // antes) deja la inmensa mayoría sin camino en mapas grandes.
    const maxCaminosPorDefecto = Math.max(15, Math.round((anchoChunks * altoChunks) / 100));
    // Orden de conexión: del POI más cercano a la ciudad al más lejano. La
    // red se construye como un árbol que crece desde el centro (GDD
    // sección 7) — conectar primero lo cercano hace que los troncos
    // principales se establezcan antes de que lleguen las ramas lejanas,
    // que además así tienen más tramos ya construidos a los que
    // engancharse en vez de tener que llegar todas hasta la ciudad.
    const poisConCamino = pois
      .filter((p) => !p.legendario)
      .map((p) => ({ p, distCiudad: Math.hypot(p.x - ciudad.x, p.y - ciudad.y) }))
      .sort((a, b) => a.distCiudad - b.distCiudad)
      .slice(0, config.maxCaminosAPOIs ?? maxCaminosPorDefecto)
      .map(({ p }) => p);

    // La red arranca conteniendo solo el nodo de la ciudad; cada camino
    // que se traza con éxito añade sus nodos a la red, así el siguiente
    // POI puede enganchar con el tronco más cercano en vez de trazar su
    // propia línea independiente hasta el centro — de ahí sale la
    // ramificación que pidió el usuario.
    const nodosDeRed = new Set([buscador.idxDeTile(ciudad.x, ciudad.y)]);

    for (let iPoi = 0; iPoi < poisConCamino.length; iPoi++) {
      const poi = poisConCamino[iPoi];
      if (iPoi % 5 === 0) onProgreso(`  camino ${iPoi}/${poisConCamino.length}...`);
      const camino = iPoi === 0 ? buscador.buscar(ciudad, { x: poi.x, y: poi.y }) : buscador.buscarHastaRed({ x: poi.x, y: poi.y }, nodosDeRed);
      resultadosCaminos.push({ poiId: poi.id, x: poi.x, y: poi.y, encontrada: !!camino });
      if (camino) {
        for (const nodo of camino) nodosDeRed.add(buscador.idxDeTile(nodo.x, nodo.y));
        for (let i = 0; i < camino.length - 1; i++) {
          marcarSegmentoComoCamino(camino[i], camino[i + 1], tilesCaminoRoad, 1);
        }
      }
    }
    onProgreso(`  ${resultadosCaminos.filter((r) => r.encontrada).length}/${resultadosCaminos.length} caminos trazados con éxito.`);
  } else {
    onProgreso("Sin ciudad capital configurada (ciudadCapital: false): se omite la red de caminos.");
  }

  function marcarSegmentoComoCamino(a, b, set, radio) {
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    const pasos = Math.max(1, Math.ceil(largo));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const perpX = largo > 0 ? -dy / largo : 0;
    const perpY = largo > 0 ? dx / largo : 0;

    // Tres carácteres de camino según el desnivel REAL del tramo (GDD
    // sección 7), comprobado antes que la banda absoluta: el zigzag existe
    // para salvar una cuesta, no porque el tramo "esté en zona de
    // montaña" — un tramo llano en lo alto de una meseta (bandaMax alta
    // pero sin subir ni bajar en ESTE tramo) va tan recto como uno en la
    // pradera, no zigzaguea sin motivo.
    const bandaA = bandaEnTile(Math.round(a.x), Math.round(a.y));
    const bandaB = bandaEnTile(Math.round(b.x), Math.round(b.y));
    const bandaMax = Math.max(bandaA, bandaB);
    const desnivel = Math.abs(bandaA - bandaB);
    let amplitud;
    let ciclos;
    if (desnivel === 0) {
      // Sin cuesta que salvar en este tramo: lo más recto posible, pero
      // con un serpenteo muy sutil — ninguna carretera real es una regla
      // perfecta, aunque aquí no haga falta zigzaguear de verdad.
      amplitud = Math.min(1.2, largo / 30);
      ciclos = 1;
    } else if (bandaMax >= 4) {
      // Sube/baja de banda de verdad en zona de montaña. La ruta en sí ya
      // serpentea de verdad aquí (costoArista penaliza la pendiente real,
      // ver sección 6 más abajo), así que este zigzag es solo un adorno
      // adicional sutil encima de un trazado que ya rodea la subida — no
      // hace falta tanta amplitud como cuando el zigzag era el único
      // recurso para sugerir la cuesta.
      const amplitudBase = Math.min(3, largo / 8);
      amplitud = Math.min(6, amplitudBase * (1.4 + desnivel * 0.25));
      ciclos = Math.max(1, Math.round(largo / 28));
    } else {
      // Colina suave (bandaMax baja pero con algo de desnivel): la
      // ondulación orgánica de siempre, sin llegar a zigzag de montaña.
      amplitud = Math.min(4, largo / 6);
      ciclos = 1;
    }

    for (let s = 0; s <= pasos; s++) {
      const t = s / pasos;
      const ondulacion = Math.sin(t * Math.PI * 2 * ciclos + a.x * 0.13 + a.y * 0.07) * amplitud;
      const px = Math.round(a.x + dx * t + perpX * ondulacion);
      const py = Math.round(a.y + dy * t + perpY * ondulacion);
      for (let ddy = -radio; ddy <= radio; ddy++) {
        for (let ddx = -radio; ddx <= radio; ddx++) {
          const x = px + ddx;
          const y = py + ddy;
          if (dentroDelMapa(x, y)) set.add(claveTile(x, y));
        }
      }
    }
  }

  // --- 8-9. Terreno final + decoración + exportado por sectores ---
  onProgreso("Generando terreno, decoración y exportando por sectores...");
  // Filtra claves "_nota*" (documentación embebida en el JSON, GDD sección
  // 2 / _nota_limite_36 en terrenos.json): no son tipos de terreno de
  // verdad y no deben gastar un índice de la leyenda base-36 (36 símbolos
  // como mucho — cada slot cuenta).
  const listaIdsTerreno = Object.keys(catalogoTerrenos).filter((id) => !id.startsWith("_"));
  const exportador = crearExportador(carpetaSalidaResuelta, listaIdsTerreno, anchoChunks, altoChunks);
  const decorador = crearColocadorDecoracion(config.semilla, catalogoVegetacion, catalogoAnimales, catalogoRocas, {
    multiplicadorPool: config.multiplicadorPool,
  });

  const poisPorChunk = new Map();
  for (const poi of pois) {
    const cx = Math.floor(poi.x / tamanoChunk);
    const cy = Math.floor(poi.y / tamanoChunk);
    const clave = `${cx}_${cy}`;
    if (!poisPorChunk.has(clave)) poisPorChunk.set(clave, []);
    poisPorChunk.get(clave).push({
      id: poi.id,
      tipo: poi.tipo,
      bioma: poi.bioma,
      legendario: poi.legendario,
      faccion: poi.faccion || null,
      radio: poi.radio,
      x: poi.x % tamanoChunk,
      y: poi.y % tamanoChunk,
    });
  }

  // Cajas 3D de los POI "edificio" (generarInstanciasPOI, arriba) — mismo
  // objeto `t:"e"` que ya pinta sectorVisual.ts para los edificios de
  // ciudades/, así que el cliente no necesita ningún caso nuevo. También se
  // reserva su huella entera como terreno "solar_edificio" (bloquea el
  // paso, misma convención que ciudades/) para que nadie atraviese la caja.
  const edificiosPOIPorChunk = new Map();
  const footprintEdificiosPOI = new Set();
  for (const info of objetosPorPOI.values()) {
    const cx = Math.floor(info.x / tamanoChunk);
    const cy = Math.floor(info.y / tamanoChunk);
    const clave = `${cx}_${cy}`;
    if (!edificiosPOIPorChunk.has(clave)) edificiosPOIPorChunk.set(clave, []);
    edificiosPOIPorChunk.get(clave).push({
      ...info.objeto,
      x: Math.floor(info.x) - cx * tamanoChunk,
      y: Math.floor(info.y) - cy * tamanoChunk,
      dx: info.x - Math.floor(info.x),
      dy: info.y - Math.floor(info.y),
    });

    const [hw, hl] = info.huella;
    const x0 = Math.round(info.x - hw / 2), y0 = Math.round(info.y - hl / 2);
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) footprintEdificiosPOI.add(`${x0 + dx}_${y0 + dy}`);
    }
  }

  // Rocas de "boca de cueva" (generarBocaCueva, instanciasPOI.js) — mismo
  // reparto por chunk que las cajas de arriba, pero son piezas sueltas de
  // rocas.json (ya en `solidosCatalogo` del servidor si llevan `colision`),
  // no un footprint reservado: la propia densidad del arco ya deja pasar
  // por la puerta sin necesitar terreno especial.
  for (const rocas of decoracionPorPOI.values()) {
    for (const roca of rocas) {
      const cx = Math.floor(roca.x / tamanoChunk);
      const cy = Math.floor(roca.y / tamanoChunk);
      const clave = `${cx}_${cy}`;
      if (!edificiosPOIPorChunk.has(clave)) edificiosPOIPorChunk.set(clave, []);
      edificiosPOIPorChunk.get(clave).push({
        ...roca.objeto,
        x: Math.floor(roca.x) - cx * tamanoChunk,
        y: Math.floor(roca.y) - cy * tamanoChunk,
      });
    }
  }

  if (ciudad) {
    const cxCiudad = Math.floor(ciudad.x / tamanoChunk);
    const cyCiudad = Math.floor(ciudad.y / tamanoChunk);
    const claveCiudad = `${cxCiudad}_${cyCiudad}`;
    if (!poisPorChunk.has(claveCiudad)) poisPorChunk.set(claveCiudad, []);
    poisPorChunk.get(claveCiudad).push({
      id: "entrada_ciudad",
      tipo: "portal",
      bioma: null,
      legendario: false,
      x: ciudad.x % tamanoChunk,
      y: ciudad.y % tamanoChunk,
    });
  }
  const RADIO_EXPLANADA_CIUDAD = 8;

  // Decisión de terreno final para una casilla — compartida entre el bucle
  // principal y el muestreo de la imagen de resumen (sección 10), así
  // ambos ven exactamente el mismo mapa, sin duplicar la lógica.
  function calcularTerrenoTile(x, y) {
    const i = y * anchoTiles + x;
    const biomaId = biomaDeIdx(biomaGridSuave[i]);
    const banda = bandaGrid[i];
    const h = hidro.consultar(x, y);
    const esCamino = tilesCaminoRoad.has(claveTile(x, y));
    let idTerreno = decidirTerreno({ biomaId, catalogoBiomas, banda, hidro: h, esCamino, variante: varianteTerrenoEn(x, y), subvariante: subvarianteTerrenoEn(x, y) });

    // Acantilado INFRANQUEABLE: salto de ≥2 bandas con el vecino INMEDIATO
    // (GDD sección 2, comportamiento de siempre, sin tocar) — no es la
    // cumbre en sí (banda 6, ya roca_inaccesible por su cuenta), es el
    // corte entre dos zonas de altura muy distinta.
    if (!esCamino && idTerreno !== "agua" && idTerreno !== "agua_profunda") {
      const bandaDer = x + 1 < anchoTiles ? bandaGrid[i + 1] : banda;
      const bandaAbajo = y + 1 < altoTiles ? bandaGrid[i + anchoTiles] : banda;
      if (Math.abs(banda - bandaDer) >= 2 || Math.abs(banda - bandaAbajo) >= 2) {
        idTerreno = "roca_inaccesible";
      }
    }

    // Pendiente DECORATIVA (pedido 2026-08-29, "que se vea el desnivel"):
    // el ruido de elevación es deliberadamente suave a 1 casilla de
    // distancia (medido: el salto máximo entre vecinos INMEDIATOS en un
    // mapa real nunca pasa de 1 banda, así que el chequeo de arriba casi
    // nunca dispara — coherente con un mundo caminable, no un laberinto de
    // muros). Para plantar rocas de acantilado en cuestas donde SÍ hay
    // subida real, se mira la banda a 5 casillas en cada dirección (cruz),
    // no solo el vecino pegado — así se detectan laderas de verdad (varias
    // casillas subiendo banda a banda) sin tocar el ruido de elevación
    // compartido con ríos/biomas. Roca decorativa, NO redefine idTerreno:
    // el terreno de suelo sigue siendo el que tocaba por bioma/banda.
    const RADIO_PENDIENTE = 5;
    let saltoPendiente = 0;
    if (!esCamino && idTerreno !== "agua" && idTerreno !== "agua_profunda" && idTerreno !== "roca_inaccesible") {
      for (const [dx, dy] of [[RADIO_PENDIENTE, 0], [-RADIO_PENDIENTE, 0], [0, RADIO_PENDIENTE], [0, -RADIO_PENDIENTE]]) {
        const vx = x + dx, vy = y + dy;
        if (vx < 0 || vy < 0 || vx >= anchoTiles || vy >= altoTiles) continue;
        const d = Math.abs(banda - bandaGrid[vy * anchoTiles + vx]);
        if (d > saltoPendiente) saltoPendiente = d;
      }
    }
    const esAcantilado = saltoPendiente >= 2;
    return { idTerreno, biomaId, banda, esCamino, esAcantilado };
  }

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      const terrenoPorCasilla = new Array(tamanoChunk * tamanoChunk);
      const bandaLocalPorCasilla = new Array(tamanoChunk * tamanoChunk);
      const tilesAcantilado = [];

      for (let ly = 0; ly < tamanoChunk; ly++) {
        for (let lx = 0; lx < tamanoChunk; lx++) {
          const x = cx * tamanoChunk + lx;
          const y = cy * tamanoChunk + ly;
          const { idTerreno, banda, esAcantilado } = calcularTerrenoTile(x, y);

          const idxLocal = ly * tamanoChunk + lx;
          // Huella de un edificio POI: bloquea el paso entero, igual que
          // "solar_edificio" en ciudades/ — su puerta (portal "interior")
          // es la única entrada real, no la casilla en sí.
          terrenoPorCasilla[idxLocal] = footprintEdificiosPOI.has(`${x}_${y}`) ? "solar_edificio" : idTerreno;
          bandaLocalPorCasilla[idxLocal] = banda;
          if (esAcantilado) tilesAcantilado.push([lx, ly]);
        }
      }

      // Rocas de acantilado (pedido 2026-08-29, "que se vea el desnivel"):
      // colocación DETERMINISTA en el borde donde el terreno salta ≥2
      // bandas, no por el decorador de densidad normal — mismo espíritu que
      // generarBocaCueva (instanciasPOI.js), un PRNG propio por chunk en vez
      // de uno nuevo por tile (coste). No todo tile de borde recibe roca
      // (ROCA_ACANTILADO_PROB) para no amontonar miles de piezas en un
      // acantilado largo — sigue leyéndose como muro porque los huecos ya
      // quedan tapados por roca_inaccesible plana debajo. Subido de 0.45 a
      // 0.65 (2026-08-29, pedido del streamer: "que se vean más a menudo al
      // pasear") — solo sube la densidad de la roca DECORATIVA, no toca
      // `idTerreno`/transitabilidad ni el ruido de elevación compartido.
      const ROCA_ACANTILADO_PROB = 0.65;
      const objetosAcantilado = [];
      if (tilesAcantilado.length) {
        const prngAcantilado = crearPRNG(semillaDesdeTexto(`${config.semilla}:acantilado:${cx}:${cy}`));
        for (const [lx, ly] of tilesAcantilado) {
          if (prngAcantilado() >= ROCA_ACANTILADO_PROB) continue;
          const esGrande = prngAcantilado() < 0.7;
          const id = esGrande ? "roca_acantilado_grande" : "roca_acantilado_pequena";
          const datosRoca = catalogoRocas[id] || {};
          objetosAcantilado.push({
            i: id,
            t: "r",
            va: Math.floor(prngAcantilado() * (datosRoca.variantes || 1)),
            ro: Math.floor(prngAcantilado() * 360),
            es: Math.round((datosRoca.escalaBase || 1) * (0.85 + prngAcantilado() * 0.3) * 100) / 100,
            x: lx,
            y: ly,
          });
        }
      }

      let objetos = decorador.generarParaChunk(cx, cy, tamanoChunk, (lx, ly) => {
        const idxLocal = ly * tamanoChunk + lx;
        const idT = terrenoPorCasilla[idxLocal];
        return {
          transitable: catalogoTerrenos[idT]?.transitable ?? false,
          bioma: biomaDeIdx(biomaGridSuave[(cy * tamanoChunk + ly) * anchoTiles + (cx * tamanoChunk + lx)]),
          banda: bandaLocalPorCasilla[idxLocal],
          esAgua: idT === "agua" || idT === "agua_profunda",
          // Agua dulce (río/lago) vs. mar: la fauna acuática de agua dulce
          // (biomas["pradera"/"bosque"/...], nunca mar_bajo/mar_profundo)
          // solo debe salir donde la hidrología dice río/lago de verdad —
          // sin esto, "es agua" a secas no distinguía un lago de un mar.
          aguaDulce: (idT === "agua" || idT === "agua_profunda") && (() => {
            const h = hidro.consultar(cx * tamanoChunk + lx, cy * tamanoChunk + ly);
            return h.esRio || h.esLago;
          })(),
          cercaAgua: idT === "agua" || catalogoTerrenos[idT]?.esPlaya === true,
          // camino/puente son transitables, pero nada debe brotar/aparecer
          // ENCIMA de la calzada — sin este flag el decorador no tenía
          // forma de saberlo y salían árboles en mitad de la carretera.
          esCamino: idT === "camino" || idT === "puente",
        };
      });

      const poisCercanos = [];
      for (let dcy = -1; dcy <= 1; dcy++) {
        for (let dcx = -1; dcx <= 1; dcx++) {
          const lista = poisPorChunk.get(`${cx + dcx}_${cy + dcy}`);
          if (!lista) continue;
          for (const p of lista) {
            poisCercanos.push({ x: (cx + dcx) * tamanoChunk + p.x, y: (cy + dcy) * tamanoChunk + p.y, radio: p.radio || 3 });
          }
        }
      }
      objetos = objetos.filter((obj) => {
        const tileX = cx * tamanoChunk + obj.x;
        const tileY = cy * tamanoChunk + obj.y;
        if (ciudad && Math.hypot(tileX - ciudad.x, tileY - ciudad.y) <= RADIO_EXPLANADA_CIUDAD) return false;
        for (const p of poisCercanos) {
          if (Math.hypot(tileX - p.x, tileY - p.y) <= p.radio) return false;
        }
        return true;
      });

      const edificiosPOI = edificiosPOIPorChunk.get(`${cx}_${cy}`);
      if (edificiosPOI) objetos = objetos.concat(edificiosPOI);
      if (objetosAcantilado.length) objetos = objetos.concat(objetosAcantilado);

      let cadenaElevacion = "";
      for (let k = 0; k < bandaLocalPorCasilla.length; k++) {
        cadenaElevacion += bandaLocalPorCasilla[k].toString(36);
      }

      exportador.agregarChunk(cx, cy, tamanoChunk, terrenoPorCasilla, objetos, poisPorChunk.get(`${cx}_${cy}`) || [], cadenaElevacion);
    }
    if (cy % Math.max(1, Math.floor(altoChunks / 10)) === 0) {
      onProgreso(`  fila de chunks ${cy}/${altoChunks}`);
    }
  }

  const { numeroSectores } = exportador.finalizar({
    nombre: config.nombre,
    semilla: config.semilla,
    anchoChunks,
    altoChunks,
    tamanoChunk,
    biomasHabilitados,
    bordes,
    ciudad,
    portales: portalesPOI,
  });

  // --- 10. Imagen de resumen ---
  onProgreso("Generando imagen de resumen...");
  const carpetaSalida = path.resolve(config.carpetaSalida || "output");
  const poisParaImagen = pois.map((p) => ({
    chunkX: Math.floor(p.x / tamanoChunk),
    chunkY: Math.floor(p.y / tamanoChunk),
    legendario: p.legendario,
  }));
  const { mapaGeneral, mapaElevacion } = generarImagenesResumen({
    anchoChunks,
    altoChunks,
    tamanoChunk,
    muestrearTile: calcularTerrenoTile,
    catalogoTerrenos,
    catalogoBiomas,
    pois: poisParaImagen,
  });
  fs.writeFileSync(path.join(carpetaSalida, "mapa_general.png"), mapaGeneral);
  fs.writeFileSync(path.join(carpetaSalida, "mapa_elevacion.png"), mapaElevacion);

  // --- 11. Validación ---
  const resultadoValidacion = validarMapa({
    resultadosCaminos,
    totalPOIs: pois.length,
    totalChunks: anchoChunks * altoChunks,
  });
  fs.writeFileSync(
    path.join(carpetaSalida, "informe_validacion.txt"),
    [resultadoValidacion.ok ? "OK — sin problemas detectados." : "ATENCIÓN — se detectaron problemas:", resultadoValidacion.resumen, ...resultadoValidacion.problemas].join("\n")
  );

  const segundos = ((Date.now() - t0) / 1000).toFixed(1);
  onProgreso(`Hecho en ${segundos}s. ${numeroSectores} sectores exportados en ${carpetaSalida}`);
  onProgreso(resultadoValidacion.ok ? "Validación: OK." : `Validación: ${resultadoValidacion.problemas.length} aviso(s), ver informe_validacion.txt`);

  return { numeroSectores, validacion: resultadoValidacion, carpetaSalida, segundos: Number(segundos) };
}

module.exports = { generarMapa, cargarCatalogos, cargarJSON };
