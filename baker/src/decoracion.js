"use strict";

const { CapaRuido, crearPRNG, semillaDesdeTexto } = require("./ruido");

// Coloca vegetación, fauna y rocas sobre un chunk ya generado (terreno +
// bioma + elevación conocidos). Cada categoría del catálogo usa su propia
// capa de ruido independiente (GDD sección 5) para que no se agrupen todas
// igual — así salen claros, manchas y zonas dispersas en vez de un "mar"
// uniforme del mismo tipo.
function crearColocadorDecoracion(semilla, catalogoVegetacion, catalogoAnimales, catalogoRocas, opcionesGlobales = {}) {
  // Pool de spawn en vez de "un único resultado final" (GDD: ver
  // Backlog_Mecanicas_Futuras.md sección de recolectables): el bakeador ya
  // no decide para siempre qué hay en cada casilla — marca varios candidatos
  // válidos por casilla (el pool) y solo una fracción arranca "activa"
  // (`ac` en el objeto exportado). El resto queda en el archivo, inactivo,
  // como reserva para que un servidor en vivo pueda activarlo más adelante
  // (más densidad de fauna/recolectables configurada, o repoblar un punto
  // tras recolectar uno activo) sin tener que re-hornear el mapa. Con
  // multiplicadorPool=1 (o desactivado) se comporta exactamente como antes
  // — un único resultado, siempre activo.
  const multiplicadorPool = Math.max(1, opcionesGlobales.multiplicadorPool ?? 3);
  const fraccionActivaInicial = 1 / multiplicadorPool;
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
  // menos flores, tramos de desierto con más o menos rocas, etc. Una capa
  // independiente por categoría (vegetación/fauna/rocas) para que no salgan
  // siempre correlacionadas (una mancha de rocas no tiene por qué coincidir
  // con una de flores). Recortada por debajo de un umbral a CERO de verdad
  // (zonas realmente vacías — "aquí no hay nada", no solo "un poco menos
  // que la media") y con más recorrido por arriba que antes (grupos/campos
  // notablemente más poblados) — el rango 0.35x..1.85x de antes nunca
  // llegaba a vaciar ni a saturar una zona de verdad, todo el mapa se veía
  // parecido.
  const nDensidadRegionVeg = new CapaRuido(semilla + ":densidadRegionVeg", 550);
  const nDensidadRegionFauna = new CapaRuido(semilla + ":densidadRegionFauna", 480);
  const nDensidadRegionRocas = new CapaRuido(semilla + ":densidadRegionRocas", 620);
  // fbm(...,2) de esta capa no sale repartido uniforme 0..1 — con 2
  // octavas e interpolación bilineal se concentra alrededor de 0.35-0.55
  // (comprobado muestreando la capa real), así que el umbral no puede ser
  // "la mitad de la escala" o apenas recorta nada. 0.35 deja ~1/4 del mapa
  // en densidad CERO de verdad.
  const UMBRAL_VACIO = 0.35;
  function factorDensidadRegional(catalogo, x, y) {
    const capa = catalogo === catalogoAnimales ? nDensidadRegionFauna : catalogo === catalogoRocas ? nDensidadRegionRocas : nDensidadRegionVeg;
    const n = capa.fbm(x, y, 2);
    if (n <= UMBRAL_VACIO) return 0;
    return Math.pow((n - UMBRAL_VACIO) / (1 - UMBRAL_VACIO), 1.3) * 1.8;
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

  // Techo de densidad POR CAPA (no por especie): cuántas especies válidas
  // tenga un bioma no debe decidir cuánto se llena de cosas una casilla —
  // antes cada especie tiraba su propia probabilidad de forma
  // independiente, así que en un bioma con muchas especies válidas (bosque,
  // ~40) las probabilidades se SUMABAN (>1.5 de probabilidad esperada por
  // casilla) y casi siempre acertaba alguna: prácticamente ninguna casilla
  // se quedaba sin decoración, en todo el mapa. Ahora hay UNA sola tirada
  // de "aparece algo de esta capa aquí" con este techo (antes de aplicar el
  // factor regional), y solo si acierta se elige QUÉ especie gana,
  // ponderado por su densidadBase relativa — la fauna es bastante más rara
  // que la vegetación a propósito, no se ve un animal en cada casilla.
  const TECHO_POR_CAPA = { vegetacion: 0.055, fauna: 0.012, rocas: 0.02 };
  function techoPara(catalogo) {
    return catalogo === catalogoAnimales ? TECHO_POR_CAPA.fauna : catalogo === catalogoRocas ? TECHO_POR_CAPA.rocas : TECHO_POR_CAPA.vegetacion;
  }

  // Para una casilla concreta, decide qué objetos de una capa (vegetación,
  // fauna o roca) le corresponden, si le corresponde alguno.
  function objetosEnCasilla(catalogo, bioma, banda, x, y, prngLocal, opciones = {}) {
    const candidatos = entradasValidas(catalogo, bioma, banda);
    const supervivientes = [];
    let pesoTotal = 0;
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
      const peso = (datos.densidadBase || 0.01) * ruido * 2; // peso RELATIVO entre especies (para elegir cuál gana), no una probabilidad por sí sola
      if (peso > 0) {
        supervivientes.push([id, datos, peso]);
        pesoTotal += peso;
      }
    }
    if (supervivientes.length === 0) return [];

    const densidadEfectiva = Math.min(techoPara(catalogo), pesoTotal) * factorDensidadRegional(catalogo, x, y);
    if (prngLocal() >= densidadEfectiva * multiplicadorPool) return [];

    // Elegido ponderado por su peso relativo, no siempre el primero del
    // catálogo: antes el orden de declaración en el JSON decidía casi
    // siempre el empate (una especie muy común y listada primero, como el
    // pino, se comía el hueco de las demás casi cada vez que también
    // acertaban).
    let elegido = supervivientes[0];
    let r = prngLocal() * pesoTotal;
    for (const s of supervivientes) {
      r -= s[2];
      if (r <= 0) {
        elegido = s;
        break;
      }
    }
    const [id, datos] = elegido;
    const variantes = datos.variantes || 1;
    const escalaBase = datos.escalaBase || 1;
    // Tirada de activación independiente de cuál especie ganó la casilla —
    // así la proporción activo/reserva es la misma para todas las especies,
    // no depende de si una es más rara que otra. `ac` se omite cuando está
    // activo (el caso normal) y solo se guarda `ac:0` para los inactivos —
    // más barato en el JSON exportado que guardar el campo siempre.
    const activo = prngLocal() < fraccionActivaInicial;
    // Claves cortas y escala redondeada a 2 decimales — con miles de
    // objetos por chunk, el peso de cada campo cuenta de verdad (GDD
    // sección 14, optimización). t: v=vegetación, a=animal, r=roca.
    return [{
      i: id,
      t: catalogo === catalogoAnimales ? "a" : catalogo === catalogoRocas ? "r" : "v",
      va: Math.floor(prngLocal() * variantes),
      ro: Math.floor(prngLocal() * 360),
      es: Math.round(escalaBase * (0.85 + prngLocal() * 0.3) * 100) / 100,
      ...(activo ? {} : { ac: 0 }),
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
