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

  // Posiciones ya usadas por especies con `distanciaMinima` (territorio de
  // depredadores grandes/raros, pedido 2026-08-29) — vive en el cierre de
  // `crearColocadorDecoracion`, así que persiste entre TODOS los chunks del
  // bake (no solo dentro de uno), como una guarida de oso de verdad no
  // debería repetirse cada pocas casillas cruzando un borde de chunk. Solo
  // se usa/actualiza para las pocas especies que declaran el campo — coste
  // cero para el resto del catálogo.
  const posicionesPorEspecie = new Map();

  // Afinidad de presa (pedido 2026-08-29, "depredador cerca de presa"): en
  // vez de depender del ORDEN en que se procesan las casillas (frágil, y
  // cruza fronteras de chunk mal), se mide la densidad de cada presa DE
  // VERDAD en este mismo punto con su propia fórmula de siempre — es un
  // proxy de "esto es buen territorio de caza para esta presa", sin
  // consumir su tirada real ni depender de si ya se colocó una instancia
  // concreta cerca. Barato: mismas capas de ruido ya cacheadas por especie.
  function afinidadPresa(presasDe, x, y) {
    if (!presasDe || !presasDe.length) return 0;
    let mejor = 0;
    for (const presaId of presasDe) {
      const datosPresa = catalogoAnimales[presaId];
      if (!datosPresa) continue;
      const ruido = capaPara(presaId, datosPresa.escalaRuido || 20).fbm(x, y, 3);
      const peso = (datosPresa.densidadBase || 0.01) * ruido * 2;
      if (peso > mejor) mejor = peso;
    }
    return mejor;
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
        // Peces de río/lago (requiereAguaDulce) solo en agua dulce de
        // verdad, nunca en mar — y viceversa, peces de mar (sin el flag)
        // nunca en un río/lago (pedido 2026-08-29: "peces de rio peces de
        // mar salada de lagos" como pools distintos, no todo mezclado).
        if (datos.requiereAguaDulce && !opciones.aguaDulce) continue;
        if (!datos.requiereAguaDulce && opciones.aguaDulce) continue;
        // Profundidad (pedido 2026-08-29, "2 alturas de agua — pocos
        // profunda ríos/orilla, profunda mar o centro de lago"): mismo
        // terreno `agua` (banda<=1, orilla/río) vs `agua_profunda` (mar
        // adentro o el centro de un lago si el fondo baja lo bastante) que
        // ya distingue el bakeador — undefined = sin preferencia, en
        // cualquiera de las dos.
        if (datos.prefiereAguaProfunda === true && !opciones.profundoAgua) continue;
        if (datos.prefiereAguaProfunda === false && opciones.profundoAgua) continue;
      } else {
        if (datos.requiereAgua) continue;
        if (datos.requiereCercaAgua && !opciones.cercaAgua) continue;
        // Yacimientos de arcilla (pedido 2026-08-29): solo en las casillas
        // de orilla que ya salieron pintadas de barro (ver override en
        // generar.js) — no en cualquier "cerca de agua" (playa/orilla dura
        // también cuentan como cercaAgua, pero no son barro).
        if (datos.requiereBarro && !opciones.esBarro) continue;
        // Escombros de acantilado (pedido 2026-08-29, "spawns como los
        // arbustos/árboles, que den piedra al picarse"): solo en el borde
        // de pendiente que ya detecta calcularTerrenoTile (mismo flag que
        // usan las rocas de acantilado deterministas).
        if (datos.requiereAcantilado && !opciones.esAcantilado) continue;
        // Decoración de camino (pedido 2026-08-29): mojones/postes solo
        // pegados a un camino de verdad Y dentro del radio cercano a la
        // ciudad — más allá, el camino se estrecha y deja de "cuidarse".
        if (datos.requiereJuntoCamino && !opciones.juntoCamino) continue;
        if (datos.requiereCercaCiudad && !opciones.cercaDeCiudad) continue;
      }
      const ruido = capaPara(id, datos.escalaRuido || 20).fbm(x, y, 3);
      let peso = (datos.densidadBase || 0.01) * ruido * 2; // peso RELATIVO entre especies (para elegir cuál gana), no una probabilidad por sí sola
      // Depredador cerca de presa (pedido 2026-08-29): un lobo/lince/etc.
      // con `presasDe` sube de peso donde su presa tendría buena densidad
      // — más probable en zonas con caza real, no repartido uniforme por
      // todo el bioma. FACTOR_AFINIDAD_PRESA moderado: refuerza, no
      // sustituye la densidad propia del depredador.
      if (catalogo === catalogoAnimales && datos.presasDe) {
        const FACTOR_AFINIDAD_PRESA = 6;
        peso *= 1 + afinidadPresa(datos.presasDe, x, y) * FACTOR_AFINIDAD_PRESA;
      }
      if (peso > 0) {
        supervivientes.push([id, datos, peso]);
        pesoTotal += peso;
      }
    }
    if (supervivientes.length === 0) return [];

    // Gradiente de borde de bioma (pedido 2026-08-29, "densidad gradiente"):
    // solo apaga vegetación, nunca rocas/fauna — un árbol se rarifica según
    // te acercas a otro bioma, una piedra no tiene ese motivo real.
    const factorBorde = catalogo === catalogoVegetacion ? opciones.factorBordeBioma ?? 1 : 1;
    const densidadEfectiva = Math.min(techoPara(catalogo), pesoTotal) * factorDensidadRegional(catalogo, x, y) * factorBorde;
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

    // Espaciado territorial (pedido 2026-08-29, "depredadores grandes/raros
    // sin dos guaridas a 5 casillas"): solo para especies con
    // `distanciaMinima` — coste cero para el resto del catálogo. Si cae
    // demasiado cerca de una instancia YA colocada de la MISMA especie (en
    // cualquier chunk anterior del bake, no solo este), se descarta la
    // tirada entera — la casilla se queda sin nada, no reintenta con otra
    // especie (mismo criterio simple que "sin sitio" en otros sistemas del
    // proyecto: mejor esfuerzo, no garantizado).
    if (datos.distanciaMinima) {
      const previas = posicionesPorEspecie.get(id);
      if (previas) {
        for (const [px, py] of previas) {
          if (Math.hypot(x - px, y - py) < datos.distanciaMinima) return [];
        }
      }
      if (!previas) posicionesPorEspecie.set(id, []);
      posicionesPorEspecie.get(id).push([x, y]);
    }

    const variantes = datos.variantes || 1;
    const escalaBase = datos.escalaBase || 1;
    // Manadas/bandadas (pedido 2026-08-29, "adelante con todas"): reusa
    // `capacidadMaximaPorChunk` — campo que YA vivía en el catálogo sin que
    // nada lo leyera — como tamaño de grupo. >1 = social: al acertar la
    // tirada de la casilla, sale un grupo de 1..capacidadMaximaPorChunk
    // individuos (no siempre el máximo, variedad de manada pequeña/grande),
    // dispersos en un jitter corto alrededor del punto — el resto de
    // especies (la inmensa mayoría, valor 1) no cambian de comportamiento.
    const tamanoGrupo =
      catalogo === catalogoAnimales && (datos.capacidadMaximaPorChunk || 1) > 1
        ? 1 + Math.floor(prngLocal() * datos.capacidadMaximaPorChunk)
        : 1;

    const salida = [];
    for (let g = 0; g < tamanoGrupo; g++) {
      // Tirada de activación independiente de cuál especie ganó la casilla
      // — así la proporción activo/reserva es la misma para todas las
      // especies, no depende de si una es más rara que otra. `ac` se omite
      // cuando está activo (el caso normal) y solo se guarda `ac:0` para
      // los inactivos — más barato en el JSON exportado que guardar el
      // campo siempre.
      const activo = prngLocal() < fraccionActivaInicial;
      // Claves cortas y escala redondeada a 2 decimales — con miles de
      // objetos por chunk, el peso de cada campo cuenta de verdad (GDD
      // sección 14, optimización). t: v=vegetación, a=animal, r=roca.
      salida.push({
        i: id,
        t: catalogo === catalogoAnimales ? "a" : catalogo === catalogoRocas ? "r" : "v",
        va: Math.floor(prngLocal() * variantes),
        ro: Math.floor(prngLocal() * 360),
        es: Math.round(escalaBase * (0.85 + prngLocal() * 0.3) * 100) / 100,
        // El primero del grupo (g=0) va exacto en la casilla que ganó la
        // tirada; el resto se dispersa ±2 casillas (jitter, sin validar
        // terreno individual — mismo criterio que roca_acantilado_*: barato
        // y suficientemente bueno para fauna, que no bloquea el paso).
        ...(g > 0 ? { dgx: Math.round((prngLocal() - 0.5) * 4), dgy: Math.round((prngLocal() - 0.5) * 4) } : {}),
        ...(activo ? {} : { ac: 0 }),
      });
    }
    return salida;
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
        // Calzada (camino/puente): transitable, pero nunca con decoración
        // encima — un roble en mitad de la carretera no es un bosque, es
        // un bug (la gente PISA por aquí a diario, nada crece ni anida).
        if (celda.esCamino) continue;

        const opciones = {
          esAgua: !!celda.esAgua,
          aguaDulce: !!celda.aguaDulce,
          profundoAgua: !!celda.profundoAgua,
          cercaAgua: celda.cercaAgua,
          esBarro: !!celda.esBarro,
          esAcantilado: !!celda.esAcantilado,
          factorBordeBioma: celda.factorBordeBioma ?? 1,
          juntoCamino: !!celda.juntoCamino,
          cercaDeCiudad: !!celda.cercaDeCiudad,
        };
        const veg = objetosEnCasilla(catalogoVegetacion, celda.bioma, celda.banda, x, y, prng, opciones);
        const roc = objetosEnCasilla(catalogoRocas, celda.bioma, celda.banda, x, y, prng, opciones);
        const fauna = objetosEnCasilla(catalogoAnimales, celda.bioma, celda.banda, x, y, prng, opciones);

        for (const obj of [...veg, ...roc, ...fauna]) {
          // Jitter de grupo (manadas/bandadas) — dgx/dgy solo existen en
          // individuos g>0 de un grupo (ver objetosEnCasilla); se aplican
          // aquí y se recortan a los límites del propio chunk (mismo
          // criterio barato que roca_acantilado_*: no busca la casilla
          // válida más cercana, solo evita salirse del chunk).
          const { dgx, dgy, ...resto } = obj;
          const fx = dgx ? Math.min(tamanoChunk - 1, Math.max(0, lx + dgx)) : lx;
          const fy = dgy ? Math.min(tamanoChunk - 1, Math.max(0, ly + dgy)) : ly;
          objetos.push({ ...resto, x: fx, y: fy });
        }
      }
    }
    return objetos;
  }

  return { generarParaChunk };
}

module.exports = { crearColocadorDecoracion };
