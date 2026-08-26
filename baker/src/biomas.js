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

  // Capas de ruido independientes (GDD sección 3): elevación, temperatura,
  // humedad, continentalidad, más warp para romper el aspecto "de ordenador".
  const nElevacion = new CapaRuido(semilla + ":elevacion", 180);
  const nTemperatura = new CapaRuido(semilla + ":temperatura", 220);
  const nHumedad = new CapaRuido(semilla + ":humedad", 160);
  const nContinental = new CapaRuido(semilla + ":continental", 300);
  const warpX = new CapaRuido(semilla + ":warpx", 90);
  const warpY = new CapaRuido(semilla + ":warpy", 90);
  const nVulcanismo = new CapaRuido(semilla + ":vulcanismo", 250);
  // Modula localmente cuánto empuja un borde de mar/montaña: en vez de un
  // muro/costa perfectamente uniforme, unos tramos reciben más empuje
  // (acantilados que caen o suben de golpe) y otros menos (playas suaves,
  // cabos que resisten y se meten mar adentro) — GDD sección "bordes".
  const nAsperezaBorde = new CapaRuido(semilla + ":asperezaborde", 70);

  const dimensionMenor = Math.max(1, Math.min(anchoTiles || Infinity, altoTiles || Infinity));

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
    const elevacionBase = conDomainWarp(nElevacion, warpX, warpY, x, y, 60);
    const elevacion = Math.min(1, Math.max(0, elevacionBase + sesgoElevacionBorde(x, y)));
    const temperatura = nTemperatura.fbm(x, y, 3);
    const humedad = conDomainWarp(nHumedad, warpX, warpY, x, y, 40);
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
  let actual = rejilla;
  for (let it = 0; it < iteraciones; it++) {
    const siguiente = new Array(actual.length);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const idx = y * ancho + x;
        const conteo = new Map();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
            const b = actual[ny * ancho + nx];
            conteo.set(b, (conteo.get(b) || 0) + 1);
          }
        }
        let mejorBioma = actual[idx];
        let mejorConteo = -1;
        for (const [bioma, n] of conteo) {
          if (n > mejorConteo) {
            mejorConteo = n;
            mejorBioma = bioma;
          }
        }
        siguiente[idx] = mejorBioma;
      }
    }
    actual = siguiente;
  }
  return actual;
}

module.exports = { crearGeneradorBiomas, suavizarBiomas };
