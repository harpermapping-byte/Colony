"use strict";

const { CapaRuido, conDomainWarp } = require("./ruido");

// Cuánto se sale un rango de [min,max]: 0 si cae dentro, mayor cuanto más lejos.
function distanciaFuera(valor, min, max) {
  if (valor < min) return min - valor;
  if (valor > max) return valor - max;
  return 0;
}

function crearGeneradorBiomas(semilla, biomasHabilitados, catalogoBiomas) {
  // Capas de ruido independientes (GDD sección 3): elevación, temperatura,
  // humedad, continentalidad, más warp para romper el aspecto "de ordenador".
  const nElevacion = new CapaRuido(semilla + ":elevacion", 180);
  const nTemperatura = new CapaRuido(semilla + ":temperatura", 220);
  const nHumedad = new CapaRuido(semilla + ":humedad", 160);
  const nContinental = new CapaRuido(semilla + ":continental", 300);
  const warpX = new CapaRuido(semilla + ":warpx", 90);
  const warpY = new CapaRuido(semilla + ":warpy", 90);
  const nVulcanismo = new CapaRuido(semilla + ":vulcanismo", 250);

  const entradas = biomasHabilitados.map((id) => ({ id, ...catalogoBiomas[id] }));

  function muestrear(x, y) {
    const elevacion = conDomainWarp(nElevacion, warpX, warpY, x, y, 60);
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

  function clasificar(x, y) {
    const m = muestrear(x, y);
    const banda = bandaDeElevacion(m.elevacion);

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
