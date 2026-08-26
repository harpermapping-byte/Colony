#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { crearGeneradorBiomas, suavizarBiomas } = require("./biomas");
const { generarHidrologia } = require("./hidrologia");
const { decidirTerreno } = require("./terreno");
const { crearColocadorDecoracion } = require("./decoracion");
const { colocarPOIs } = require("./pois");
const { crearBuscadorCaminos } = require("./caminos");
const { normalizarBordes } = require("./bordes");
const { crearExportador } = require("./exportar");
const { generarImagenResumen } = require("./overview");
const { validarMapa } = require("./validar");

function cargarJSON(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function main() {
  const rutaConfig = process.argv[2];
  if (!rutaConfig) {
    console.error("Uso: node src/index.js <config.json>");
    process.exit(1);
  }

  const t0 = Date.now();
  const config = cargarJSON(path.resolve(rutaConfig));
  const carpetaCatalogo = path.join(__dirname, "..", "catalogo");
  const catalogoTerrenos = cargarJSON(path.join(carpetaCatalogo, "terrenos.json"));
  const catalogoBiomas = cargarJSON(path.join(carpetaCatalogo, "biomas.json"));
  const catalogoVegetacion = cargarJSON(path.join(carpetaCatalogo, "vegetacion.json"));
  const catalogoAnimales = cargarJSON(path.join(carpetaCatalogo, "animales.json"));
  const catalogoRocas = cargarJSON(path.join(carpetaCatalogo, "rocas.json"));
  const catalogoPOIs = cargarJSON(path.join(carpetaCatalogo, "pois.json"));

  const tamanoChunk = config.tamanoChunk || 32;
  const anchoChunks = config.anchoChunks;
  const altoChunks = config.altoChunks;
  const anchoTiles = anchoChunks * tamanoChunk;
  const altoTiles = altoChunks * tamanoChunk;

  const biomasHabilitados = config.biomasHabilitados.filter((id) => {
    if (!catalogoBiomas[id]) {
      console.warn(`Aviso: bioma "${id}" no existe en el catálogo, se ignora.`);
      return false;
    }
    return true;
  });

  console.log(`Horneando "${config.nombre}" — ${anchoChunks}x${altoChunks} chunks (${anchoTiles}x${altoTiles} casillas), semilla "${config.semilla}"`);
  console.log(`Biomas habilitados: ${biomasHabilitados.join(", ")}`);

  // --- 1-3. Ruido, clasificación de bioma y suavizado (GDD sección 3) ---
  const generadorBiomas = crearGeneradorBiomas(config.semilla, biomasHabilitados, catalogoBiomas);

  console.log("Clasificando biomas...");
  const biomaGrid = new Uint8Array(anchoTiles * altoTiles);
  const bandaGrid = new Uint8Array(anchoTiles * altoTiles);
  const listaIdsBiomas = Object.keys(catalogoBiomas);
  const idxBiomaDe = new Map(listaIdsBiomas.map((id, i) => [id, i]));
  const biomaDeIdx = (i) => listaIdsBiomas[i];

  for (let y = 0; y < altoTiles; y++) {
    for (let x = 0; x < anchoTiles; x++) {
      const r = generadorBiomas.clasificar(x, y);
      const i = y * anchoTiles + x;
      biomaGrid[i] = idxBiomaDe.get(r.bioma) ?? 0;
      bandaGrid[i] = r.banda;
    }
    if (y % Math.max(1, Math.floor(altoTiles / 10)) === 0) {
      process.stdout.write(`  fila ${y}/${altoTiles}\r`);
    }
  }
  console.log("\nSuavizando fronteras de bioma...");
  const biomaGridSuave = suavizarBiomas(Array.from(biomaGrid), anchoTiles, altoTiles, 2);

  // --- 4. Hidrología (GDD sección 4) ---
  console.log("Generando hidrología...");
  const pasoHidrologia = config.pasoHidrologia || 16;
  const hidro = generarHidrologia({
    anchoTiles,
    altoTiles,
    paso: pasoHidrologia,
    elevacionEn: (x, y) => 1 - bandaGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)] / 6,
    umbralRio: config.umbralRio || 6,
  });

  // --- 5. Colocación de POIs (GDD sección 6) ---
  console.log("Colocando POIs...");
  const biomaEnTile = (x, y) => biomaDeIdx(biomaGridSuave[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)]);
  const bandaEnTile = (x, y) => bandaGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)];
  const terrenoBaseEnTile = (x, y) => {
    const b = biomaEnTile(x, y);
    const banda = bandaEnTile(x, y);
    const h = hidro.consultar(x, y);
    const id = decidirTerreno({ biomaId: b, catalogoBiomas, banda, hidro: h, esCamino: false });
    return catalogoTerrenos[id];
  };

  const pois = colocarPOIs({
    anchoTiles,
    altoTiles,
    separacionMinima: config.separacionMinimaPOI || 200,
    semilla: config.semilla,
    biomaEn: biomaEnTile,
    terrenoEn: terrenoBaseEnTile,
    catalogoPOIs,
    probabilidadLegendaria: config.probabilidadLegendaria ?? 0.02,
  });
  console.log(`  ${pois.length} POIs colocados.`);

  // --- 6. Caminos (GDD sección 7) ---
  console.log("Trazando caminos...");
  const ciudad = config.ciudad || { x: Math.floor(anchoTiles / 2), y: Math.floor(altoTiles / 2) };
  const pasoCaminos = config.pasoCaminos || 32;
  const buscador = crearBuscadorCaminos({
    anchoTiles,
    altoTiles,
    paso: pasoCaminos,
    costoEn: (x, y) => {
      const banda = bandaEnTile(x, y);
      const h = hidro.consultar(x, y);
      if (h.esLago || (h.esRio && banda >= 2)) return Infinity; // sin puentes en v1: evita agua salvo vadeable
      if (banda === 6) return Infinity; // cumbre inaccesible
      if (banda === 5) return 4; // penaliza montaña, no la prohíbe
      return 1;
    },
  });

  const tilesCaminoRoad = new Set();
  const resultadosCaminos = [];
  // Solo se traza camino hacia una muestra de POIs (los más importantes/no
  // demasiados) para que el A* no tenga que correr cientos de veces en un
  // mapa grande — el resto de POIs se descubren caminando, no todos
  // necesitan camino directo.
  const poisConCamino = pois.filter((p) => !p.legendario).slice(0, config.maxCaminosAPOIs ?? 40);
  for (const poi of poisConCamino) {
    const camino = buscador.buscar(ciudad, { x: poi.x, y: poi.y });
    resultadosCaminos.push({ poiId: poi.id, x: poi.x, y: poi.y, encontrada: !!camino });
    if (camino) {
      for (let i = 0; i < camino.length - 1; i++) {
        marcarSegmentoComoCamino(camino[i], camino[i + 1], tilesCaminoRoad, 2);
      }
    }
  }
  console.log(`  ${resultadosCaminos.filter((r) => r.encontrada).length}/${resultadosCaminos.length} caminos trazados con éxito.`);

  function marcarSegmentoComoCamino(a, b, set, radio) {
    const pasos = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= pasos; s++) {
      const px = Math.round(a.x + ((b.x - a.x) * s) / pasos);
      const py = Math.round(a.y + ((b.y - a.y) * s) / pasos);
      for (let dy = -radio; dy <= radio; dy++) {
        for (let dx = -radio; dx <= radio; dx++) {
          set.add(`${px + dx}_${py + dy}`);
        }
      }
    }
  }

  // --- 7. Bordes (GDD sección 1) ---
  const bordes = normalizarBordes(config.bordes);

  // --- 8-9. Terreno final + decoración + exportado por sectores ---
  console.log("Generando terreno, decoración y exportando por sectores...");
  const listaIdsTerreno = Object.keys(catalogoTerrenos);
  const exportador = crearExportador(path.resolve(config.carpetaSalida || "output"), listaIdsTerreno);
  const decorador = crearColocadorDecoracion(config.semilla, catalogoVegetacion, catalogoAnimales, catalogoRocas);

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
      x: poi.x % tamanoChunk,
      y: poi.y % tamanoChunk,
    });
  }

  const biomaChunkCache = new Map(); // para la imagen de resumen
  const aguaChunkCache = new Set();
  const caminoChunkCache = new Set();

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      const terrenoPorCasilla = new Array(tamanoChunk * tamanoChunk);
      const bandaLocalPorCasilla = new Array(tamanoChunk * tamanoChunk);
      let hayAgua = false;
      let hayCamino = false;
      const conteoBioma = new Map();

      for (let ly = 0; ly < tamanoChunk; ly++) {
        for (let lx = 0; lx < tamanoChunk; lx++) {
          const x = cx * tamanoChunk + lx;
          const y = cy * tamanoChunk + ly;
          const i = y * anchoTiles + x;
          const biomaId = biomaDeIdx(biomaGridSuave[i]);
          const banda = bandaGrid[i];
          const h = hidro.consultar(x, y);
          const esCamino = tilesCaminoRoad.has(`${x}_${y}`);
          const idTerreno = decidirTerreno({ biomaId, catalogoBiomas, banda, hidro: h, esCamino });

          const idxLocal = ly * tamanoChunk + lx;
          terrenoPorCasilla[idxLocal] = idTerreno;
          bandaLocalPorCasilla[idxLocal] = banda;
          if (idTerreno === "agua" || idTerreno === "agua_profunda") hayAgua = true;
          if (esCamino) hayCamino = true;
          conteoBioma.set(biomaId, (conteoBioma.get(biomaId) || 0) + 1);
        }
      }

      let biomaDominante = null;
      let maxConteo = -1;
      for (const [b, n] of conteoBioma) {
        if (n > maxConteo) {
          maxConteo = n;
          biomaDominante = b;
        }
      }
      biomaChunkCache.set(`${cx}_${cy}`, biomaDominante);
      if (hayAgua) aguaChunkCache.add(`${cx}_${cy}`);
      if (hayCamino) caminoChunkCache.add(`${cx}_${cy}`);

      const objetos = decorador.generarParaChunk(cx, cy, tamanoChunk, (lx, ly) => {
        const idxLocal = ly * tamanoChunk + lx;
        const idT = terrenoPorCasilla[idxLocal];
        return {
          transitable: catalogoTerrenos[idT]?.transitable ?? false,
          bioma: biomaDeIdx(biomaGridSuave[(cy * tamanoChunk + ly) * anchoTiles + (cx * tamanoChunk + lx)]),
          banda: bandaLocalPorCasilla[idxLocal],
          cercaAgua: idT === "agua" || idT === "playa",
        };
      });

      exportador.agregarChunk(cx, cy, tamanoChunk, terrenoPorCasilla, objetos, poisPorChunk.get(`${cx}_${cy}`) || []);
    }
    if (cy % Math.max(1, Math.floor(altoChunks / 10)) === 0) {
      process.stdout.write(`  fila de chunks ${cy}/${altoChunks}\r`);
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
  });

  // --- 10. Imagen de resumen ---
  console.log("\nGenerando imagen de resumen...");
  const carpetaSalida = path.resolve(config.carpetaSalida || "output");
  const poisParaImagen = pois.map((p) => ({
    chunkX: Math.floor(p.x / tamanoChunk),
    chunkY: Math.floor(p.y / tamanoChunk),
    legendario: p.legendario,
  }));
  const png = generarImagenResumen({
    anchoChunks,
    altoChunks,
    biomaDelChunk: (cx, cy) => biomaChunkCache.get(`${cx}_${cy}`),
    catalogoBiomas,
    esAguaChunk: (cx, cy) => aguaChunkCache.has(`${cx}_${cy}`),
    esCaminoChunk: (cx, cy) => caminoChunkCache.has(`${cx}_${cy}`),
    pois: poisParaImagen,
  });
  fs.writeFileSync(path.join(carpetaSalida, "mapa_general.png"), png);

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
  console.log(`\nHecho en ${segundos}s. ${numeroSectores} sectores exportados en ${carpetaSalida}`);
  console.log(resultadoValidacion.ok ? "Validación: OK." : `Validación: ${resultadoValidacion.problemas.length} aviso(s), ver informe_validacion.txt`);
}

main();
