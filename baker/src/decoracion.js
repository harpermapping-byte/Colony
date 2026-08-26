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

  // Densidad regional de bosque: capa de ruido de gran escala (regiones
  // enteras, no casilla a casilla) que multiplica la densidad de la
  // vegetación del bioma "bosque" — así unas zonas de bosque salen grandes
  // y muy pobladas y otras más pequeñas y ralas, nunca todas iguales.
  const nDensidadBosque = new CapaRuido(semilla + ":densidadRegionBosque", 550);
  function factorDensidadRegional(bioma, x, y) {
    if (bioma !== "bosque") return 1;
    return 0.35 + nDensidadBosque.fbm(x, y, 2) * 1.5; // ~0.35..1.85
  }

  function entradasValidas(catalogo, bioma, banda) {
    const salida = [];
    for (const [id, datos] of Object.entries(catalogo)) {
      if (id.startsWith("_")) continue;
      if (!datos.biomas || !datos.biomas.includes(bioma)) continue;
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
    const resultado = [];
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
      const densidad = (datos.densidadBase || 0.01) * ruido * 2 * factorDensidadRegional(bioma, x, y);
      if (prngLocal() < densidad) {
        const variantes = datos.variantes || 1;
        const escalaBase = datos.escalaBase || 1;
        // Claves cortas y escala redondeada a 2 decimales — con miles de
        // objetos por chunk, el peso de cada campo cuenta de verdad
        // (GDD sección 14, optimización). t: v=vegetación, a=animal, r=roca.
        resultado.push({
          i: id,
          t: catalogo === catalogoAnimales ? "a" : catalogo === catalogoRocas ? "r" : "v",
          va: Math.floor(prngLocal() * variantes),
          ro: Math.floor(prngLocal() * 360),
          es: Math.round(escalaBase * (0.85 + prngLocal() * 0.3) * 100) / 100,
        });
        break; // solo un objeto de esta capa por casilla, evita amontonar
      }
    }
    return resultado;
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
