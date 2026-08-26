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

function crearExportador(carpetaSalida, leyendaTerreno, anchoChunks, altoChunks) {
  const indiceTerreno = new Map(leyendaTerreno.map((id, i) => [id, i]));
  const sectores = new Map();
  let numeroSectoresEscritos = 0;

  function claveSector(sx, sy) {
    return `${sx}_${sy}`;
  }

  // Cuántos chunks le tocan en total a un sector — TAMANO_SECTOR_CHUNKS² para
  // uno interior, menos en los sectores parciales del borde derecho/inferior
  // cuando anchoChunks/altoChunks no es múltiplo exacto de TAMANO_SECTOR_CHUNKS.
  function chunksEsperadosEnSector(sx, sy) {
    const anchoEnChunks = Math.min(TAMANO_SECTOR_CHUNKS, anchoChunks - sx * TAMANO_SECTOR_CHUNKS);
    const altoEnChunks = Math.min(TAMANO_SECTOR_CHUNKS, altoChunks - sy * TAMANO_SECTOR_CHUNKS);
    return anchoEnChunks * altoEnChunks;
  }

  function escribirSector(sector) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
    const nombre = `sector_${String(sector.sectorX).padStart(3, "0")}_${String(sector.sectorY).padStart(3, "0")}.json`;
    fs.writeFileSync(path.join(carpetaSalida, nombre), JSON.stringify({ sectorX: sector.sectorX, sectorY: sector.sectorY, chunks: sector.chunks }));
    numeroSectoresEscritos++;
  }

  function agregarChunk(chunkX, chunkY, tamanoChunk, terrenoPorCasilla, objetos, poisDelChunk, elevacionPorCasilla) {
    const sx = Math.floor(chunkX / TAMANO_SECTOR_CHUNKS);
    const sy = Math.floor(chunkY / TAMANO_SECTOR_CHUNKS);
    const clave = claveSector(sx, sy);
    if (!sectores.has(clave)) {
      sectores.set(clave, { sectorX: sx, sectorY: sy, chunks: {}, pendientes: chunksEsperadosEnSector(sx, sy) });
    }

    let cadena = "";
    for (let i = 0; i < terrenoPorCasilla.length; i++) {
      const idxT = indiceTerreno.get(terrenoPorCasilla[i]);
      cadena += (idxT === undefined ? 0 : idxT).toString(36);
    }

    const sector = sectores.get(clave);
    sector.chunks[`${chunkX}_${chunkY}`] = {
      terreno: cadena,
      elevacion: elevacionPorCasilla || "",
      tamano: tamanoChunk,
      objetos,
      pois: poisDelChunk || [],
    };
    sector.pendientes--;

    // En cuanto un sector recibe todos los chunks que le tocan se escribe a
    // disco y se libera de memoria ahí mismo — el bucle principal recorre
    // en orden de fila, así que cada sector se completa tan pronto como es
    // posible. Sin esto, un mapa de 200x200 chunks (400 sectores) retiene
    // el mundo entero horneado en RAM hasta el último chunk: era el mayor
    // consumo de memoria de todo el pipeline, y la causa real del out of
    // memory en mapas grandes (más que biomas.js o hidrologia.js).
    if (sector.pendientes <= 0) {
      escribirSector(sector);
      sectores.delete(clave);
    }
  }

  function finalizar(metadatosMapa) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
    // Por robustez: cualquier sector que por lo que sea no se haya
    // completado durante el bucle principal se escribe aquí también.
    for (const sector of sectores.values()) {
      escribirSector(sector);
    }
    sectores.clear();

    const indice = {
      version: VERSION_HORNEADO,
      tamanoSectorChunks: TAMANO_SECTOR_CHUNKS,
      leyendaTerreno,
      ...metadatosMapa,
    };
    fs.writeFileSync(path.join(carpetaSalida, "indice.json"), JSON.stringify(indice, null, 2));
    return { numeroSectores: numeroSectoresEscritos };
  }

  return { agregarChunk, finalizar, TAMANO_SECTOR_CHUNKS };
}

module.exports = { crearExportador, TAMANO_SECTOR_CHUNKS, VERSION_HORNEADO };
