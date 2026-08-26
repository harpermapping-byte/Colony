"use strict";

const { CapaRuido, crearPRNG, semillaDesdeTexto } = require("./ruido");

// Coloca vegetación, fauna y rocas sobre un chunk ya generado (terreno +
// bioma + elevación conocidos). Cada categoría del catálogo usa su propia
// capa de ruido independiente (GDD sección 5) para que no se agrupen todas
// igual — así salen claros, manchas y zonas dispersas en vez de un "mar"
// uniforme del mismo tipo.
function crearColocadorDecoracion(semilla, catalogoVegetacion, catalogoAnimales, catalogoRocas) {
  const capasRuido = new Map();
  function capaPara(nombre, escala) {
    const clave = nombre + ":" + escala;
    if (!capasRuido.has(clave)) {
      capasRuido.set(clave, new CapaRuido(semilla + ":decor:" + clave, escala));
    }
    return capasRuido.get(clave);
  }

  // Densidad regional: capa de ruido de gran escala (regiones enteras, no
  // casilla a casilla) que multiplica la densidad — así hay zonas de bosque
  // grandes y muy pobladas y otras pequeñas y ralas, praderas con más o
  // menos flores, tramos de desierto con más o menos rocas, etc. Nunca todo
  // el mapa a la misma densidad. Una capa independiente por categoría
  // (vegetación/fauna/rocas) para que no salgan siempre correlacionadas
  // (una mancha de rocas no tiene por qué coincidir con una de flores).
  const nDensidadRegionVeg = new CapaRuido(semilla + ":densidadRegionVeg", 550);
  const nDensidadRegionFauna = new CapaRuido(semilla + ":densidadRegionFauna", 480);
  const nDensidadRegionRocas = new CapaRuido(semilla + ":densidadRegionRocas", 620);
  function factorDensidadRegional(catalogo, x, y) {
    const capa = catalogo === catalogoAnimales ? nDensidadRegionFauna : catalogo === catalogoRocas ? nDensidadRegionRocas : nDensidadRegionVeg;
    return 0.35 + capa.fbm(x, y, 2) * 1.5; // ~0.35..1.85
  }

  // Indexado por bioma UNA VEZ al construir el colocador — con el catálogo
  // ya bastante grande (~70 especies de vegetación, ~110 de fauna), volver a
  // recorrer Object.entries(catalogo) entero en cada casilla (3 veces por
  // casilla, una por capa) es el cuello de botella real en mapas grandes:
  // aquí se pasa de O(catálogo completo) a O(solo lo que aplica a ese bioma).
  function indexarPorBioma(catalogo) {
    const indice = new Map();
    for (const [id, datos] of Object.entries(catalogo)) {
      if (id.startsWith("_") || !datos.biomas) continue;
      for (const bioma of datos.biomas) {
        if (!indice.has(bioma)) indice.set(bioma, []);
        indice.get(bioma).push([id, datos]);
      }
    }
    return indice;
  }
  const indices = new Map([
    [catalogoVegetacion, indexarPorBioma(catalogoVegetacion)],
    [catalogoAnimales, indexarPorBioma(catalogoAnimales)],
    [catalogoRocas, indexarPorBioma(catalogoRocas)],
  ]);

  function entradasValidas(catalogo, bioma, banda) {
    const lista = indices.get(catalogo).get(bioma);
    if (!lista || lista.length === 0) return lista || [];
    const salida = [];
    for (const [id, datos] of lista) {
      if (datos.bandaElevacionMax !== undefined && banda > datos.bandaElevacionMax) continue;
      if (datos.bandaElevacionMin !== undefined && banda < datos.bandaElevacionMin) continue;
      salida.push([id, datos]);
    }
    return salida;
  }

  // Para una casilla concreta, decide qué objetos de una capa (vegetación,
  // fauna o roca) le corresponden, si le corresponde alguno.
  function objetosEnCasilla(catalogo, bioma, banda, x, y, prngLocal, opciones = {}) {
    const candidatos = entradasValidas(catalogo, bioma, banda);
    const exitos = [];
    for (const [id, datos] of candidatos) {
      // Vida acuática (requiereAgua) solo en agua; todo lo demás nunca en
      // agua abierta — antes esta comprobación estaba rota (opciones.esAgua
      // siempre llegaba a false), así que ni una sola casilla de agua
      // procesaba decoración: nada de vida marina podía existir nunca.
      if (opciones.esAgua) {
        if (!datos.requiereAgua) continue;
      } else {
        if (datos.requiereAgua) continue;
        if (datos.requiereCercaAgua && !opciones.cercaAgua) continue;
      }
      const ruido = capaPara(id, datos.escalaRuido || 20).fbm(x, y, 3);
      const densidad = (datos.densidadBase || 0.01) * ruido * 2 * factorDensidadRegional(catalogo, x, y);
      if (prngLocal() < densidad) {
        exitos.push([id, datos, densidad]);
      }
    }
    if (exitos.length === 0) return [];

    // Solo un objeto de esta capa por casilla (evita amontonar) — pero si
    // varias especies "acertaron" a la vez, se elige una ponderada por su
    // propia densidad, no siempre la primera del catálogo: antes el orden
    // de declaración en el JSON decidía casi siempre el empate (una especie
    // muy común y listada primero, como el pino, se comía el hueco de las
    // demás casi cada vez que también acertaban).
    let elegido = exitos[0];
    if (exitos.length > 1) {
      const total = exitos.reduce((suma, e) => suma + e[2], 0);
      let r = prngLocal() * total;
      for (const e of exitos) {
        r -= e[2];
        if (r <= 0) {
          elegido = e;
          break;
        }
      }
    }
    const [id, datos] = elegido;
    const variantes = datos.variantes || 1;
    const escalaBase = datos.escalaBase || 1;
    // Claves cortas y escala redondeada a 2 decimales — con miles de
    // objetos por chunk, el peso de cada campo cuenta de verdad (GDD
    // sección 14, optimización). t: v=vegetación, a=animal, r=roca.
    return [{
      i: id,
      t: catalogo === catalogoAnimales ? "a" : catalogo === catalogoRocas ? "r" : "v",
      va: Math.floor(prngLocal() * variantes),
      ro: Math.floor(prngLocal() * 360),
      es: Math.round(escalaBase * (0.85 + prngLocal() * 0.3) * 100) / 100,
    }];
  }

  function generarParaChunk(chunkX, chunkY, tamanoChunk, obtenerCelda) {
    const objetos = [];
    const prng = crearPRNG(semillaDesdeTexto(`${semilla}:chunk:${chunkX}:${chunkY}`));
    for (let ly = 0; ly < tamanoChunk; ly++) {
      for (let lx = 0; lx < tamanoChunk; lx++) {
        const x = chunkX * tamanoChunk + lx;
        const y = chunkY * tamanoChunk + ly;
        const celda = obtenerCelda(lx, ly);
        if (!celda) continue;
        // Las casillas de agua (esAgua) no son "transitable" pero sí deben
        // procesarse — es donde vive la fauna y flora marina/de río. Roca
        // sólida u otro terreno intransitable sin agua no lleva decoración.
        if (!celda.transitable && !celda.esAgua) continue;

        const opciones = { esAgua: !!celda.esAgua, cercaAgua: celda.cercaAgua };
        const veg = objetosEnCasilla(catalogoVegetacion, celda.bioma, celda.banda, x, y, prng, opciones);
        const roc = objetosEnCasilla(catalogoRocas, celda.bioma, celda.banda, x, y, prng, opciones);
        const fauna = objetosEnCasilla(catalogoAnimales, celda.bioma, celda.banda, x, y, prng, opciones);

        for (const obj of [...veg, ...roc, ...fauna]) {
          objetos.push({ ...obj, x: lx, y: ly });
        }
      }
    }
    return objetos;
  }

  return { generarParaChunk };
}

module.exports = { crearColocadorDecoracion };
