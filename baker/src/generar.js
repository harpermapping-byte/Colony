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

  // --- 1-3. Ruido, clasificación de bioma y suavizado (GDD sección 3) ---
  const generadorBiomas = crearGeneradorBiomas(config.semilla, biomasHabilitados, catalogoBiomas);

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
  const biomaGridSuave = suavizarBiomas(Array.from(biomaGrid), anchoTiles, altoTiles, 2);

  // --- 4. Hidrología (GDD sección 4) ---
  onProgreso("Generando hidrología...");
  const pasoHidrologia = config.pasoHidrologia || 16;
  const hidro = generarHidrologia({
    anchoTiles,
    altoTiles,
    paso: pasoHidrologia,
    elevacionEn: (x, y) => elevacionGrid[Math.min(altoTiles - 1, y) * anchoTiles + Math.min(anchoTiles - 1, x)],
    umbralRio: config.umbralRio || 6,
  });

  // --- 5. Colocación de POIs (GDD sección 6) ---
  onProgreso("Colocando POIs...");
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
  onProgreso(`  ${pois.length} POIs colocados.`);

  // --- 6. Caminos (GDD sección 7) ---
  onProgreso("Trazando caminos...");
  const ciudad = config.ciudad || { x: Math.floor(anchoTiles / 2), y: Math.floor(altoTiles / 2) };
  const pasoCaminos = config.pasoCaminos || 32;
  const buscador = crearBuscadorCaminos({
    anchoTiles,
    altoTiles,
    paso: pasoCaminos,
    costoEn: (x, y) => {
      const banda = bandaEnTile(x, y);
      const h = hidro.consultar(x, y);
      if (h.esLago || (h.esRio && banda >= 2)) return Infinity;
      if (banda === 6) return Infinity;
      if (banda === 5) return 4;
      return 1;
    },
  });

  const tilesCaminoRoad = new Set();
  const resultadosCaminos = [];
  const poisConCamino = pois.filter((p) => !p.legendario).slice(0, config.maxCaminosAPOIs ?? 40);
  for (const poi of poisConCamino) {
    const camino = buscador.buscar(ciudad, { x: poi.x, y: poi.y });
    resultadosCaminos.push({ poiId: poi.id, x: poi.x, y: poi.y, encontrada: !!camino });
    if (camino) {
      for (let i = 0; i < camino.length - 1; i++) {
        marcarSegmentoComoCamino(camino[i], camino[i + 1], tilesCaminoRoad, 1);
      }
    }
  }
  onProgreso(`  ${resultadosCaminos.filter((r) => r.encontrada).length}/${resultadosCaminos.length} caminos trazados con éxito.`);

  function marcarSegmentoComoCamino(a, b, set, radio) {
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    const pasos = Math.max(1, Math.ceil(largo));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const perpX = largo > 0 ? -dy / largo : 0;
    const perpY = largo > 0 ? dx / largo : 0;
    const amplitud = Math.min(4, largo / 6);

    for (let s = 0; s <= pasos; s++) {
      const t = s / pasos;
      const ondulacion = Math.sin(t * Math.PI * 2 + a.x * 0.13 + a.y * 0.07) * amplitud;
      const px = Math.round(a.x + dx * t + perpX * ondulacion);
      const py = Math.round(a.y + dy * t + perpY * ondulacion);
      for (let ddy = -radio; ddy <= radio; ddy++) {
        for (let ddx = -radio; ddx <= radio; ddx++) {
          set.add(`${px + ddx}_${py + ddy}`);
        }
      }
    }
  }

  // --- 7. Bordes (GDD sección 1) ---
  const bordes = normalizarBordes(config.bordes);

  // --- 8-9. Terreno final + decoración + exportado por sectores ---
  onProgreso("Generando terreno, decoración y exportando por sectores...");
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
      radio: poi.radio,
      x: poi.x % tamanoChunk,
      y: poi.y % tamanoChunk,
    });
  }

  {
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

  const biomaChunkCache = new Map();
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
          let idTerreno = decidirTerreno({ biomaId, catalogoBiomas, banda, hidro: h, esCamino });

          if (!esCamino && idTerreno !== "agua" && idTerreno !== "agua_profunda") {
            const bandaDer = x + 1 < anchoTiles ? bandaGrid[i + 1] : banda;
            const bandaAbajo = y + 1 < altoTiles ? bandaGrid[i + anchoTiles] : banda;
            if (Math.abs(banda - bandaDer) >= 2 || Math.abs(banda - bandaAbajo) >= 2) {
              idTerreno = "roca_inaccesible";
            }
          }

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

      let objetos = decorador.generarParaChunk(cx, cy, tamanoChunk, (lx, ly) => {
        const idxLocal = ly * tamanoChunk + lx;
        const idT = terrenoPorCasilla[idxLocal];
        return {
          transitable: catalogoTerrenos[idT]?.transitable ?? false,
          bioma: biomaDeIdx(biomaGridSuave[(cy * tamanoChunk + ly) * anchoTiles + (cx * tamanoChunk + lx)]),
          banda: bandaLocalPorCasilla[idxLocal],
          cercaAgua: idT === "agua" || idT === "playa",
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
        if (Math.hypot(tileX - ciudad.x, tileY - ciudad.y) <= RADIO_EXPLANADA_CIUDAD) return false;
        for (const p of poisCercanos) {
          if (Math.hypot(tileX - p.x, tileY - p.y) <= p.radio) return false;
        }
        return true;
      });

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
  });

  // --- 10. Imagen de resumen ---
  onProgreso("Generando imagen de resumen...");
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
  onProgreso(`Hecho en ${segundos}s. ${numeroSectores} sectores exportados en ${carpetaSalida}`);
  onProgreso(resultadoValidacion.ok ? "Validación: OK." : `Validación: ${resultadoValidacion.problemas.length} aviso(s), ver informe_validacion.txt`);

  return { numeroSectores, validacion: resultadoValidacion, carpetaSalida, segundos: Number(segundos) };
}

module.exports = { generarMapa, cargarCatalogos, cargarJSON };
