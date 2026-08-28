"use strict";

// Vincula el bakeador de mapa exterior con ciudades/ e interiores/: al
// hornear un mapa, cada POI colocado por pois.js (baker/catalogo/pois.json,
// campo `categoria`) genera AHORA su instancia real —
//   - "asentamiento" -> una región ciudades/ completa, anidada en
//     `<carpetaSalida>/pois/<slug>/`, enlazada por un portal "exterior" con
//     `destino` (mismo formato que ya consume RegionRoom/HubRoom).
//   - "edificio" -> UN edificio suelto (interiores/generarEdificio) directo
//     sobre el mapa padre: su interior va a `<carpetaSalida>/interiores/`
//     (misma carpeta/convención que usa ciudades/), su caja 3D es un objeto
//     más del sector (mismo `t:"e"` que ya pinta sectorVisual.ts, cero
//     cambios de cliente) y su puerta es un portal "interior" normal.
//   - "mazmorra" -> docs/GDD_Bakeador_Dungeons.md. `dungeonTipoId` (en
//     mazmorras/catalogo/tipos_dungeon.json) decide el `estiloExterior`:
//     "asentamiento" reusa el camino de arriba (ciudades/, con el tier
//     hostil del tipo — sin enemigos dentro de las casas todavía, pendiente
//     real); "edificio"/"cueva" generan el interior con
//     mazmorras/src/generarMazmorra.js (salas grandes, spawns de enemigos)
//     en vez de interiores/generarEdificio, con portal `esMazmorra:true`
//     para que el cliente/servidor lo abran como DungeonRoom, no InteriorRoom.
//   - "decorativo" (o sin categoria) -> sin cambios: el marcador de
//     siempre, sin instancia.
// "Generar una vez, nunca en directo" (CLAUDE.md): esto corre en el mismo
// proceso de horneado offline que el resto del pipeline, nunca en el
// servidor en vivo.

const fs = require("fs");
const path = require("path");

function slugPOI(poi) {
  return `${poi.id}_${poi.x}_${poi.y}`;
}

// Busca la plantilla de catálogo (con categoria/tier/tipoEdificioId) que le
// tocó a un POI ya colocado — colocarPOIs() solo devuelve id/tipo/bioma/x/y
// (ver pois.js), así que hay que volver a mirar el catálogo por bioma +
// "_cualquiera", igual que hizo la colocación original.
function buscarDefinicion(poi, catalogoPOIs) {
  const pools = [catalogoPOIs[poi.bioma] || [], catalogoPOIs._cualquiera || []];
  for (const pool of pools) {
    const def = pool.find((p) => p.id === poi.id);
    if (def) return def;
  }
  return null;
}

/**
 * @param {object} opciones
 * @param {Array} opciones.pois - salida de colocarPOIs() (pois.js)
 * @param {string} opciones.mapaId - id del mapa PADRE (carpeta bajo assets/mapas/)
 * @param {string} opciones.carpetaSalida - carpeta de salida del mapa padre (misma que crearExportador)
 * @param {string} opciones.semillaMundo - semilla del mapa padre, para derivar sub-semillas deterministas
 * @param {object} opciones.catalogoPOIs - catálogo pois.json ya cargado
 * @param {(msg:string)=>void} [opciones.onProgreso]
 * @returns {{ portales: Array, objetosPorPOI: Map<string,{x:number,y:number,objeto:object,huella:[number,number]}> }}
 */
function generarInstanciasPOI({ pois, mapaId, carpetaSalida, semillaMundo, catalogoPOIs, onProgreso = () => {} }) {
  // Requires perezosos: ciudades/interiores son módulos "pesados" (cargan
  // catálogos propios) que la mayoría de bakes de mapa exterior ni tocan
  // (mapas de prueba sin POIs de asentamiento/edificio) — cargarlos solo
  // si de verdad hace falta alguno.
  let generarEdificio = null;
  let catalogosInteriores = null;
  let hornearCiudad = null;
  function catalogosInterioresPerezosos() {
    if (!catalogosInteriores) {
      ({ generarEdificio } = require("../../interiores/src/edificio"));
      catalogosInteriores = require("../../interiores/src/catalogo").cargarCatalogos();
    }
    return catalogosInteriores;
  }
  function hornearCiudadPerezoso() {
    if (!hornearCiudad) ({ hornearCiudad } = require("../../ciudades/src/index"));
    return hornearCiudad;
  }
  let generarMazmorra = null;
  let catalogosMazmorra = null;
  function mazmorraPerezosa() {
    if (!generarMazmorra) {
      ({ generarMazmorra } = require("../../mazmorras/src/generarMazmorra"));
      catalogosMazmorra = { tiposDungeon: require("../../mazmorras/catalogo/tipos_dungeon.json") };
    }
    return { generarMazmorra, catalogosMazmorra };
  }

  const portales = [];
  const objetosPorPOI = new Map();

  for (const poi of pois) {
    const def = buscarDefinicion(poi, catalogoPOIs);
    const categoria = def?.categoria || "decorativo";
    if (categoria === "decorativo") continue;

    const slug = slugPOI(poi);
    const semillaPOI = `${semillaMundo}:poi:${slug}`;

    if (categoria === "asentamiento") {
      if (!def.tier) continue;
      const carpetaPOI = path.join(carpetaSalida, "pois", slug);
      onProgreso(`  POI "${poi.id}" (asentamiento, ${def.tier}) en (${poi.x},${poi.y})...`);
      hornearCiudadPerezoso()(def.tier, semillaPOI, carpetaPOI);
      portales.push({
        tipo: "exterior",
        x: poi.x,
        y: poi.y,
        destino: { tipo: "region", mapaId: `${mapaId}/pois/${slug}` },
      });
      continue;
    }

    if (categoria === "edificio") {
      const catalogos = catalogosInterioresPerezosos();
      const defEd = catalogos.tiposEdificio[def.tipoEdificioId];
      if (!defEd) continue; // catálogo mal referenciado: mejor omitir el POI que romper el bake entero
      onProgreso(`  POI "${poi.id}" (edificio, ${def.tipoEdificioId}) en (${poi.x},${poi.y})...`);

      const edificio = generarEdificio({ tipoEdificioId: def.tipoEdificioId, catalogos, semilla: semillaPOI });
      const carpetaInteriores = path.join(carpetaSalida, "interiores");
      fs.mkdirSync(carpetaInteriores, { recursive: true });
      fs.writeFileSync(path.join(carpetaInteriores, `${edificio.id}.json`), JSON.stringify(edificio));

      const [hw, hl] = defEd.huellaExterior || [7, 6];
      // Sin rotación: a diferencia de ciudades/ (edificios en fila mirando
      // a una calle), un POI suelto no tiene calle a la que orientarse —
      // puerta siempre en +Y, una fila justo debajo de la huella, mismo
      // criterio que ciudades/src/generar.js usa para SU puerta propia.
      const puertaX = Math.round(poi.x);
      const puertaY = Math.round(poi.y) + Math.ceil(hl / 2) + 1;

      objetosPorPOI.set(slug, {
        x: poi.x,
        y: poi.y,
        huella: [hw, hl],
        objeto: { i: def.tipoEdificioId, t: "e", va: 0, ro: 0, es: 1, w: hw, h: hl, dx: 0, dy: 0 },
      });
      portales.push({
        tipo: "interior",
        x: puertaX,
        y: puertaY,
        edificio: edificio.id,
        tipoEdificioId: def.tipoEdificioId,
      });
      continue;
    }

    if (categoria === "mazmorra") {
      const { generarMazmorra, catalogosMazmorra } = mazmorraPerezosa();
      const dungeonDef = catalogosMazmorra.tiposDungeon[def.dungeonTipoId];
      if (!dungeonDef) continue; // catálogo mal referenciado: se omite el POI, no rompe el bake

      if (dungeonDef.estiloExterior === "asentamiento") {
        // Idéntico al camino "asentamiento" de arriba, pero con el tier
        // hostil del tipo de mazmorra — sin enemigos dentro de las casas
        // todavía (pendiente real, ver docs/GDD_Bakeador_Dungeons.md).
        if (!dungeonDef.tierAsentamiento) continue;
        const carpetaPOI = path.join(carpetaSalida, "pois", slug);
        onProgreso(`  POI "${poi.id}" (mazmorra-asentamiento, ${dungeonDef.tierAsentamiento}) en (${poi.x},${poi.y})...`);
        hornearCiudadPerezoso()(dungeonDef.tierAsentamiento, semillaPOI, carpetaPOI);
        portales.push({
          tipo: "exterior", x: poi.x, y: poi.y,
          destino: { tipo: "region", mapaId: `${mapaId}/pois/${slug}` },
        });
        continue;
      }

      // "edificio" o "cueva": interior generado por mazmorras/, no interiores/.
      const catalogos = catalogosInterioresPerezosos();
      onProgreso(`  POI "${poi.id}" (mazmorra-${dungeonDef.estiloExterior}, ${def.dungeonTipoId}) en (${poi.x},${poi.y})...`);
      const mazmorra = generarMazmorra({
        tipoDungeonId: def.dungeonTipoId, catalogosMazmorra, catalogosInteriores: catalogos, semilla: semillaPOI,
      });
      const carpetaInteriores = path.join(carpetaSalida, "interiores");
      fs.mkdirSync(carpetaInteriores, { recursive: true });
      fs.writeFileSync(path.join(carpetaInteriores, `${mazmorra.id}.json`), JSON.stringify(mazmorra));

      let puertaX = Math.round(poi.x), puertaY = Math.round(poi.y);
      if (dungeonDef.estiloExterior === "edificio") {
        const defEd = catalogos.tiposEdificio[dungeonDef.tipoEdificioIdExterior];
        const [hw, hl] = defEd?.huellaExterior || [7, 6];
        puertaY = Math.round(poi.y) + Math.ceil(hl / 2) + 1;
        objetosPorPOI.set(slug, {
          x: poi.x, y: poi.y, huella: [hw, hl],
          objeto: { i: dungeonDef.tipoEdificioIdExterior, t: "e", va: 0, ro: 0, es: 1, w: hw, h: hl, dx: 0, dy: 0 },
        });
      }
      // "cueva": sin caja 3D (una boca de cueva no es una caja rectangular)
      // — solo el disparador del portal, en la propia casilla del POI.

      portales.push({
        tipo: "interior", x: puertaX, y: puertaY,
        edificio: mazmorra.id, tipoEdificioId: def.dungeonTipoId, esMazmorra: true,
      });
    }
  }

  return { portales, objetosPorPOI };
}

module.exports = { generarInstanciasPOI, slugPOI };
