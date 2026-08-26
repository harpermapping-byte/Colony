"use strict";

const { crearPRNG, semillaDesdeTexto } = require("./ruido");

// Comprueba si una casilla candidata a llevar un POI cumple las reglasSitio
// de la plantilla (declaradas en el catálogo pero, antes de este arreglo,
// nunca comprobadas — así que "cabaña de cazador" podía salir en llano y
// "oasis" en terreno inválido sin que nadie lo detectara).
function cercaDeAgua(x, y, terrenoEn) {
  const offsets = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, -5], [5, -5], [-5, 5]];
  for (const [dx, dy] of offsets) {
    const t = terrenoEn(x + dx, y + dy);
    if (t && (t.requiereNadar || t.esPlaya)) return true;
  }
  return false;
}

function cumpleReglasSitio(reglas, banda, x, y, terrenoEn) {
  if (!reglas || reglas.length === 0) return true;
  for (const regla of reglas) {
    if (regla === "terrenoLlano" && (banda < 2 || banda > 4)) return false;
    if (regla === "cercaAgua" && !cercaDeAgua(x, y, terrenoEn)) return false;
    if (regla.startsWith("bandaElevacionMin:") && banda < Number(regla.split(":")[1])) return false;
    if (regla.startsWith("bandaElevacionMax:") && banda > Number(regla.split(":")[1])) return false;
  }
  return true;
}

// Elección ponderada por "peso" (por defecto 10) — permite que unos tipos de
// POI sean comunes y otros mucho más raros ("TOP") dentro del mismo pool,
// en vez de que todos tengan la misma probabilidad.
function elegirPonderado(candidatas, prng) {
  const total = candidatas.reduce((suma, p) => suma + (p.peso ?? 10), 0);
  let r = prng() * total;
  for (const p of candidatas) {
    r -= p.peso ?? 10;
    if (r <= 0) return p;
  }
  return candidatas[candidatas.length - 1];
}

// Colocación de POIs: variante práctica de disco de Poisson por rejilla
// (GDD sección 6) — se reparte el mapa en celdas de separación mínima, se
// intenta un punto por celda con jitter, y se descarta si cae en terreno
// inválido o repite la última plantilla usada cerca (regla anti-repetición).
// catalogoPOIs["_cualquiera"] es un pool extra que se añade siempre, para
// tipos que pueden salir en cualquier bioma (cuevas, ruinas, campamentos
// enemigos) sin tener que duplicar la entrada en cada bioma del catálogo.
function colocarPOIs({ anchoTiles, altoTiles, separacionMinima, semilla, biomaEn, terrenoEn, bandaEn, catalogoPOIs, probabilidadLegendaria }) {
  const prng = crearPRNG(semillaDesdeTexto(semilla + ":pois"));
  const pois = [];
  let ultimaPlantillaPorBioma = {};
  const universales = catalogoPOIs["_cualquiera"] || [];

  const celdas = Math.floor(separacionMinima);
  for (let cy = 0; cy < altoTiles; cy += celdas) {
    for (let cx = 0; cx < anchoTiles; cx += celdas) {
      const x = cx + Math.floor(prng() * celdas);
      const y = cy + Math.floor(prng() * celdas);
      if (x >= anchoTiles || y >= altoTiles) continue;

      const bioma = biomaEn(x, y);
      const propias = catalogoPOIs[bioma] || [];
      if (propias.length === 0 && universales.length === 0) continue;
      const plantillas = universales.length ? [...propias, ...universales] : propias;
      if (plantillas.length === 0) continue;

      const terreno = terrenoEn(x, y);
      if (!terreno || !terreno.transitable || terreno.esBaseRocosa) continue;
      const banda = bandaEn ? bandaEn(x, y) : 3;

      // Probabilidad de colocar un POI en esta celda candidata (no todas las
      // celdas de la rejilla llevan uno, si no saldría demasiado denso).
      if (prng() > 0.35) continue;

      let candidatas = plantillas.filter((p) => cumpleReglasSitio(p.reglasSitio, banda, x, y, terrenoEn));
      if (candidatas.length === 0) continue;
      const ultima = ultimaPlantillaPorBioma[bioma];
      if (ultima && candidatas.length > 1) {
        const sinRepetir = candidatas.filter((p) => p.id !== ultima);
        if (sinRepetir.length > 0) candidatas = sinRepetir;
      }
      const elegida = elegirPonderado(candidatas, prng);
      ultimaPlantillaPorBioma[bioma] = elegida.id;

      const esLegendario = prng() < probabilidadLegendaria;

      pois.push({
        id: elegida.id,
        tipo: elegida.tipo,
        bioma,
        x,
        y,
        legendario: esLegendario,
        faccion: elegida.faccion || null,
        radio: elegida.radio || 3, // cuánto ocupa la estructura (casillas), para despejar decoración alrededor
      });
    }
  }

  return pois;
}

module.exports = { colocarPOIs };
