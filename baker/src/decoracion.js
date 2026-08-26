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
      if (opciones.requiereAgua && !opciones.esAgua) continue;
      if (opciones.requiereCercaAgua && !opciones.cercaAgua) continue;
      const ruido = capaPara(id, datos.escalaRuido || 20).fbm(x, y, 3);
      const densidad = (datos.densidadBase || 0.01) * ruido * 2; // ruido 0..1 -> variación en torno a la base
      if (prngLocal() < densidad) {
        const variantes = datos.variantes || 1;
        // Claves cortas y escala redondeada a 2 decimales — con miles de
        // objetos por chunk, el peso de cada campo cuenta de verdad
        // (GDD sección 14, optimización). t: v=vegetación, a=animal, r=roca.
        resultado.push({
          i: id,
          t: catalogo === catalogoAnimales ? "a" : catalogo === catalogoRocas ? "r" : "v",
          va: Math.floor(prngLocal() * variantes),
          ro: Math.floor(prngLocal() * 360),
          es: Math.round((0.85 + prngLocal() * 0.3) * 100) / 100,
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
        if (!celda || !celda.transitable) continue;

        const opciones = { esAgua: false, cercaAgua: celda.cercaAgua };
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
