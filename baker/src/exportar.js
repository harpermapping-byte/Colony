"use strict";

const fs = require("fs");
const path = require("path");

// Formato de salida (GDD sección 18): un archivo por "sector" de 10x10
// chunks, no uno por chunk suelto — con mapas grandes, un archivo por chunk
// serían decenas de miles de archivos, poco manejable en Git. El terreno se
// codifica como un caracter por casilla (índice en base36 sobre la leyenda
// de tipos de terreno) en vez de repetir el nombre de cada tipo, igual que
// hace el otro proyecto del streamer con su mapa (mapLayoutCodec.js) — mucho
// más compacto que un array de strings.
const TAMANO_SECTOR_CHUNKS = 10;
const VERSION_HORNEADO = 1;

function crearExportador(carpetaSalida, leyendaTerreno) {
  const indiceTerreno = new Map(leyendaTerreno.map((id, i) => [id, i]));
  const sectores = new Map();

  function claveSector(sx, sy) {
    return `${sx}_${sy}`;
  }

  function agregarChunk(chunkX, chunkY, tamanoChunk, terrenoPorCasilla, objetos, poisDelChunk) {
    const sx = Math.floor(chunkX / TAMANO_SECTOR_CHUNKS);
    const sy = Math.floor(chunkY / TAMANO_SECTOR_CHUNKS);
    const clave = claveSector(sx, sy);
    if (!sectores.has(clave)) {
      sectores.set(clave, { sectorX: sx, sectorY: sy, chunks: {} });
    }

    let cadena = "";
    for (let i = 0; i < terrenoPorCasilla.length; i++) {
      const idxT = indiceTerreno.get(terrenoPorCasilla[i]);
      cadena += (idxT === undefined ? 0 : idxT).toString(36);
    }

    sectores.get(clave).chunks[`${chunkX}_${chunkY}`] = {
      terreno: cadena,
      tamano: tamanoChunk,
      objetos,
      pois: poisDelChunk || [],
    };
  }

  function finalizar(metadatosMapa) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
    for (const sector of sectores.values()) {
      const nombre = `sector_${String(sector.sectorX).padStart(3, "0")}_${String(sector.sectorY).padStart(3, "0")}.json`;
      fs.writeFileSync(path.join(carpetaSalida, nombre), JSON.stringify(sector));
    }

    const indice = {
      version: VERSION_HORNEADO,
      tamanoSectorChunks: TAMANO_SECTOR_CHUNKS,
      leyendaTerreno,
      ...metadatosMapa,
    };
    fs.writeFileSync(path.join(carpetaSalida, "indice.json"), JSON.stringify(indice, null, 2));
    return { numeroSectores: sectores.size };
  }

  return { agregarChunk, finalizar, TAMANO_SECTOR_CHUNKS };
}

module.exports = { crearExportador, TAMANO_SECTOR_CHUNKS, VERSION_HORNEADO };
