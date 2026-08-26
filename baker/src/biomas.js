"use strict";

const { CapaRuido, conDomainWarp } = require("./ruido");

// Cuánto se sale un rango de [min,max]: 0 si cae dentro, mayor cuanto más lejos.
function distanciaFuera(valor, min, max) {
  if (valor < min) return min - valor;
  if (valor > max) return valor - max;
  return 0;
}

// Cuánto empuja cada tipo de borde a la elevación continua (0..1) cerca de
// ese lado del mapa, y qué tan gruesa (en tiles) es la franja de influencia
// como fracción de la dimensión menor del mapa. mar_abierto empuja fuerte
// hacia abajo (mar), montana/cerrado empujan fuerte hacia arriba (muro
// infranqueable — banda 6 es roca_inaccesible), tierra_abierta apenas
// suaviza para que no salgan ni charcos ni picos justo en el borde.
const PERFIL_BORDE = {
  mar_abierto: { objetivo: -0.62, fraccionGrosor: 0.16 },
  montana: { objetivo: 0.85, fraccionGrosor: 0.07 },
  cerrado: { objetivo: 0.85, fraccionGrosor: 0.07 },
  tierra_abierta: { objetivo: 0.12, fraccionGrosor: 0.035 },
};

function crearGeneradorBiomas(semilla, biomasHabilitados, catalogoBiomas, opciones = {}) {
  const { anchoTiles = 0, altoTiles = 0, bordes = null } = opciones;

  // Todas las escalas de "qué bioma es esto" (temperatura/humedad/
  // continentalidad/elevación) se fijan como fracción del lado menor del
  // mapa, no como constantes absolutas — así "cuántas zonas de bioma caben
  // en el mapa" no depende de si el mapa mide 40 o 100 chunks, y una
  // fracción más grande que antes da zonas GRANDES y coherentes (praderas,
  // bosques, cordilleras enteras) en vez de mosaico de trozos pequeños, que
  // era el problema real: con una escala fija (ej. 180 tiles) un mapa de
  // miles de tiles de lado mete decenas de oscilaciones del ruido, cada una
  // un cambio de bioma.
  //
  // OJO con pasarse: `ruido.js` es ruido de valor con una sola celda
  // bilineal por "escala" (no Simplex/Perlin de verdad) — si la escala se
  // acerca al tamaño del mapa, quedan tan pocas celdas de rejilla (2-3)
  // que la propia interpolación bilineal se ve como bandas diagonales
  // geométricas en vez de terreno orgánico (visto de verdad probando con
  // fracciones altas: el mapa de elevación salía con una "X" perfecta).
  // Por eso el objetivo aquí es unas 6-10 celdas de rejilla por el lado
  // menor del mapa — bastante menos que las ~25-40 de antes (de ahí el
  // mosaico pequeño), pero lejos de las 2-3 que rompen la textura. El
  // detalle fino DENTRO de cada zona no se pierde — sigue viniendo de las
  // octavas altas de cada `fbm` (1/2, 1/4, 1/8 de esta escala base) y de
  // la decoración/vegetación, que es su propia capa. 400 tiles de mínimo
  // evita escalas absurdas si algún caller no pasa anchoTiles/altoTiles
  // (tests, mapas de prueba diminutos).
  const dimensionMenor = Math.max(400, Math.min(anchoTiles || Infinity, altoTiles || Infinity));
  const escalaClima = (fraccion) => Math.round(dimensionMenor * fraccion);

  // Capas de ruido independientes (GDD sección 3): elevación, temperatura,
  // humedad, continentalidad, más warp para romper el aspecto "de ordenador".
  // La elevación se queda con más celdas que el resto (ratio ~10) porque
  // además de decidir bioma da forma al terreno real que siguen ríos y
  // caminos — demasiado pocas celdas ahí se nota mucho más que en un eje
  // puramente climático.
  const nElevacion = new CapaRuido(semilla + ":elevacion", escalaClima(0.10));
  const nTemperatura = new CapaRuido(semilla + ":temperatura", escalaClima(0.15));
  const nHumedad = new CapaRuido(semilla + ":humedad", escalaClima(0.13));
  const nContinental = new CapaRuido(semilla + ":continental", escalaClima(0.17));
  // El domain warp escala con la capa que distorsiona (mantiene la misma
  // fuerza RELATIVA que antes — ver `fuerza` en las llamadas a
  // conDomainWarp más abajo) en vez de quedarse en una escala fija: si la
  // escala base crece pero el warp no, el warp se vuelve casi invisible y
  // los límites de zona salen demasiado lisos/geométricos otra vez.
  const warpX = new CapaRuido(semilla + ":warpx", escalaClima(0.10));
  const warpY = new CapaRuido(semilla + ":warpy", escalaClima(0.10));
  const nVulcanismo = new CapaRuido(semilla + ":vulcanismo", escalaClima(0.15));
  // Modula localmente cuánto empuja un borde de mar/montaña: en vez de un
  // muro/costa perfectamente uniforme, unos tramos reciben más empuje
  // (acantilados que caen o suben de golpe) y otros menos (playas suaves,
  // cabos que resisten y se meten mar adentro) — GDD sección "bordes". Esta
  // sí se queda en escala fina absoluta a propósito: es textura LOCAL del
  // borde, no una zona de bioma, no debe crecer con el mapa.
  const nAsperezaBorde = new CapaRuido(semilla + ":asperezaborde", 70);

  const bordesInfo = bordes
    ? [
        ["norte", bordes.norte],
        ["sur", bordes.sur],
        ["este", bordes.este],
        ["oeste", bordes.oeste],
      ].filter(([, b]) => b && PERFIL_BORDE[b.tipo])
    : [];

  function distanciaABorde(lado, x, y) {
    if (lado === "norte") return y;
    if (lado === "sur") return altoTiles - 1 - y;
    if (lado === "este") return anchoTiles - 1 - x;
    return x; // oeste
  }

  // Sesgo aditivo de elevación por cercanía a bordes configurados: el borde
  // más influyente en este punto (mayor magnitud) gana, para no sumar
  // empujes contradictorios en las esquinas donde coinciden dos tipos.
  function sesgoElevacionBorde(x, y) {
    if (bordesInfo.length === 0) return 0;
    let mejorValor = 0;
    for (const [lado, borde] of bordesInfo) {
      const perfil = PERFIL_BORDE[borde.tipo];
      const grosor = Math.max(12, dimensionMenor * perfil.fraccionGrosor);
      const d = distanciaABorde(lado, x, y);
      if (d >= grosor) continue;
      const t = 1 - d / grosor;
      const curva = t * t; // cae rápido al alejarse del borde
      const textura = 0.55 + nAsperezaBorde.fbm(x, y, 2) * 0.9; // ~0.55..1.45
      const valor = perfil.objetivo * curva * textura;
      if (Math.abs(valor) > Math.abs(mejorValor)) mejorValor = valor;
    }
    return mejorValor;
  }

  function muestrear(x, y) {
    // Fuerza del warp como fracción de la escala de la capa que distorsiona
    // (mismo ratio ~1/3 y ~1/4 que tenía el bakeador antes de que estas
    // escalas empezaran a depender del tamaño del mapa) — así el warp
    // sigue rompiendo el borde con la misma fuerza relativa sea cual sea
    // el tamaño del mapa, en vez de volverse invisible al crecer la base.
    const elevacionBase = conDomainWarp(nElevacion, warpX, warpY, x, y, nElevacion.escala / 3);
    const elevacion = Math.min(1, Math.max(0, elevacionBase + sesgoElevacionBorde(x, y)));
    const temperatura = nTemperatura.fbm(x, y, 3);
    const humedad = conDomainWarp(nHumedad, warpX, warpY, x, y, nHumedad.escala / 4);
    const continentalidad = nContinental.fbm(x, y, 2);
    const vulcanismo = nVulcanismo.fbm(x, y, 2);
    return { elevacion, temperatura, humedad, continentalidad, vulcanismo };
  }

  // Banda de elevación discreta 0..6 a partir del valor continuo 0..1.
  function bandaDeElevacion(elevacionContinua) {
    return Math.min(6, Math.floor(elevacionContinua * 7));
  }

  const bMarProfundo = catalogoBiomas["mar_profundo"];
  const bMarBajo = catalogoBiomas["mar_bajo"];
  const entradas = biomasHabilitados.map((id) => ({ id, ...catalogoBiomas[id] }));

  function clasificar(x, y) {
    const m = muestrear(x, y);
    const banda = bandaDeElevacion(m.elevacion);

    // El mar (profundo o bajo) se decide por umbral directo de elevación,
    // antes que el resto de biomas por rangos — así siempre hay océano de
    // verdad donde la elevación cae lo bastante, tanto si lo empuja un
    // borde de mar_abierto como si sale de pura casualidad del ruido base.
    if (bMarProfundo && m.elevacion < bMarProfundo.elevacionMax) {
      return { bioma: "mar_profundo", banda, elevacionContinua: m.elevacion, humedad: m.humedad, temperatura: m.temperatura };
    }
    if (bMarBajo && m.elevacion < bMarBajo.elevacionMax) {
      return { bioma: "mar_bajo", banda, elevacionContinua: m.elevacion, humedad: m.humedad, temperatura: m.temperatura };
    }

    let mejor = null;
    let mejorPuntuacion = Infinity;
    for (const bioma of entradas) {
      if (bioma.requiereVulcanismo && m.vulcanismo < 0.75) continue;
      if (!bioma.requiereVulcanismo && bioma.rangos === undefined) continue;
      const r = bioma.rangos;
      const puntuacion =
        distanciaFuera(m.temperatura, r.temperatura[0], r.temperatura[1]) +
        distanciaFuera(m.humedad, r.humedad[0], r.humedad[1]) +
        distanciaFuera(banda, r.bandaElevacion[0], r.bandaElevacion[1]) * 0.3 +
        distanciaFuera(m.continentalidad, r.continentalidad[0], r.continentalidad[1]);
      if (puntuacion < mejorPuntuacion) {
        mejorPuntuacion = puntuacion;
        mejor = bioma.id;
      }
    }

    return { bioma: mejor, banda, elevacionContinua: m.elevacion, humedad: m.humedad, temperatura: m.temperatura };
  }

  return { clasificar, bandaDeElevacion };
}

// Suavizado por autómata celular: cada celda adopta el bioma mayoritario de
// sus vecinas tras unas pocas pasadas, elimina "salpicaduras" (GDD sección 3).
function suavizarBiomas(rejilla, ancho, alto, iteraciones = 2) {
  // rejilla es un Uint8Array (índice de bioma, valor pequeño acotado) — se
  // opera siempre sobre typed arrays para no pagar el coste de un Array JS
  // plano de 41M elementos (boxing/representación no empaquetada, ~1.4GB
  // extra medidos en el mapa principal de 200x200 chunks).
  const conteo = new Uint16Array(256); // más que suficiente para el nº de biomas del catálogo
  const tocados = new Uint8Array(256); // biomas distintos vistos en la ventana 3x3 de esta celda
  const bufA = new Uint8Array(rejilla.length);
  const bufB = iteraciones > 1 ? new Uint8Array(rejilla.length) : null;
  let actual = rejilla;
  let siguiente = bufA;
  for (let it = 0; it < iteraciones; it++) {
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const idx = y * ancho + x;
        const yMin = Math.max(0, y - 1);
        const yMax = Math.min(alto - 1, y + 1);
        const xMin = Math.max(0, x - 1);
        const xMax = Math.min(ancho - 1, x + 1);
        let nTocados = 0;
        for (let ny = yMin; ny <= yMax; ny++) {
          for (let nx = xMin; nx <= xMax; nx++) {
            const b = actual[ny * ancho + nx];
            if (conteo[b] === 0) tocados[nTocados++] = b;
            conteo[b]++;
          }
        }
        let mejorBioma = actual[idx];
        let mejorConteo = -1;
        for (let i = 0; i < nTocados; i++) {
          const b = tocados[i];
          if (conteo[b] > mejorConteo) {
            mejorConteo = conteo[b];
            mejorBioma = b;
          }
          conteo[b] = 0;
        }
        siguiente[idx] = mejorBioma;
      }
    }
    actual = siguiente;
    siguiente = siguiente === bufA ? bufB : bufA;
  }
  return actual;
}

module.exports = { crearGeneradorBiomas, suavizarBiomas };
