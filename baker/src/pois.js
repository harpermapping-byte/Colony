"use strict";

const { crearPRNG, semillaDesdeTexto } = require("./ruido");

// Colocación de POIs: variante práctica de disco de Poisson por rejilla
// (GDD sección 6) — se reparte el mapa en celdas de separación mínima, se
// intenta un punto por celda con jitter, y se descarta si cae en terreno
// inválido o repite la última plantilla usada cerca (regla anti-repetición).
function colocarPOIs({ anchoTiles, altoTiles, separacionMinima, semilla, biomaEn, terrenoEn, catalogoPOIs, probabilidadLegendaria }) {
  const prng = crearPRNG(semillaDesdeTexto(semilla + ":pois"));
  const pois = [];
  let ultimaPlantillaPorBioma = {};

  const celdas = Math.floor(separacionMinima);
  for (let cy = 0; cy < altoTiles; cy += celdas) {
    for (let cx = 0; cx < anchoTiles; cx += celdas) {
      const x = cx + Math.floor(prng() * celdas);
      const y = cy + Math.floor(prng() * celdas);
      if (x >= anchoTiles || y >= altoTiles) continue;

      const bioma = biomaEn(x, y);
      const plantillas = catalogoPOIs[bioma];
      if (!plantillas || plantillas.length === 0) continue;

      const terreno = terrenoEn(x, y);
      if (!terreno || !terreno.transitable || terreno.esBaseRocosa) continue;

      // Probabilidad de colocar un POI en esta celda candidata (no todas las
      // celdas de la rejilla llevan uno, si no saldría demasiado denso).
      if (prng() > 0.35) continue;

      let candidatas = plantillas;
      const ultima = ultimaPlantillaPorBioma[bioma];
      if (ultima && plantillas.length > 1) {
        candidatas = plantillas.filter((p) => p.id !== ultima);
      }
      const elegida = candidatas[Math.floor(prng() * candidatas.length)];
      ultimaPlantillaPorBioma[bioma] = elegida.id;

      const esLegendario = prng() < probabilidadLegendaria;

      pois.push({
        id: elegida.id,
        tipo: elegida.tipo,
        bioma,
        x,
        y,
        legendario: esLegendario,
      });
    }
  }

  return pois;
}

module.exports = { colocarPOIs };
