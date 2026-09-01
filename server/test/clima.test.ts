// Tests de la lógica PURA de clima (server/src/mundo/clima.ts, docs/GDD_Clima.md).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  climaDeFranja,
  temperaturaMundo,
  tipoConcreto,
  franjaDeHora,
  nevoEnFranja,
  algunaFranjaNevo,
  temperaturaTarde,
  estadoClimaEnHora,
  estadoClimaDelDia,
  temperaturaMundoDelDia,
  type Estacion,
} from "../src/mundo/clima";
import { estacionYDiaDelAnio } from "../src/mundo/tiempoMundo";

// diaDelAnio de referencia: 135 = mitad de verano (pico de calor), 315 = mitad de invierno (pico de frío).
const DIA_MITAD_VERANO = 135;
const DIA_MITAD_INVIERNO = 315;

test("franjaDeHora: reparte el día en 4 franjas de 6h", () => {
  assert.strictEqual(franjaDeHora(0), 0);
  assert.strictEqual(franjaDeHora(5.9), 0);
  assert.strictEqual(franjaDeHora(6), 1);
  assert.strictEqual(franjaDeHora(11.9), 1);
  assert.strictEqual(franjaDeHora(12), 2);
  assert.strictEqual(franjaDeHora(18), 3);
  assert.strictEqual(franjaDeHora(23.9), 3);
});

test("climaDeFranja: determinista — mismo día/franja/estación siempre da el mismo resultado", () => {
  assert.strictEqual(climaDeFranja(123, 2, "invierno"), climaDeFranja(123, 2, "invierno"));
});

test("climaDeFranja: franjas distintas del mismo día pueden dar climas distintos", () => {
  const resultados = new Set<string>();
  for (let dia = 0; dia < 80; dia++) {
    for (let f = 0; f < 4; f++) resultados.add(climaDeFranja(dia, f, "invierno"));
  }
  assert.ok(resultados.size > 1, `esperaba variedad, salió siempre ${[...resultados]}`);
});

test("climaDeFranja: nunca sale un estado fuera del catálogo (soleado/nublado/precipitacion/viento/niebla)", () => {
  const validos = new Set(["soleado", "nublado", "precipitacion", "viento", "niebla"]);
  for (let dia = 0; dia < 100; dia++) {
    for (let f = 0; f < 4; f++) assert.ok(validos.has(climaDeFranja(dia, f, "primavera")));
  }
});

test("temperaturaMundo: mitad de verano es más cálido que mitad de invierno a la misma hora", () => {
  assert.ok(temperaturaMundo(DIA_MITAD_VERANO, 15) > temperaturaMundo(DIA_MITAD_INVIERNO, 15));
});

test("temperaturaMundo: media tarde (15h) es más cálida que la madrugada (3h) el mismo día", () => {
  assert.ok(temperaturaMundo(DIA_MITAD_VERANO, 15) > temperaturaMundo(DIA_MITAD_VERANO, 3));
});

test("temperaturaMundo: determinista", () => {
  assert.strictEqual(temperaturaMundo(200, 10), temperaturaMundo(200, 10));
});

test("temperaturaMundo: extremos exactos -5°C / 35°C (madrugada de mitad de invierno / tarde de mitad de verano)", () => {
  assert.ok(Math.abs(temperaturaMundo(DIA_MITAD_INVIERNO, 3) - -5) < 1e-9);
  assert.ok(Math.abs(temperaturaMundo(DIA_MITAD_VERANO, 15) - 35) < 1e-9);
});

test("temperaturaMundo: nunca se sale del rango [-5, 35] para ningún día/hora", () => {
  for (let dia = 0; dia < 360; dia += 5) {
    for (let hora = 0; hora < 24; hora += 3) {
      const t = temperaturaMundo(dia, hora);
      assert.ok(t >= -5.0001 && t <= 35.0001, `temperatura fuera de rango: día ${dia} hora ${hora} = ${t}`);
    }
  }
});

test("tipoConcreto: precipitacion se resuelve a nieve si hace <=5°C, a lluvia si no", () => {
  assert.strictEqual(tipoConcreto("precipitacion", 5), "nieve");
  assert.strictEqual(tipoConcreto("precipitacion", 4.9), "nieve");
  assert.strictEqual(tipoConcreto("precipitacion", -5), "nieve");
  assert.strictEqual(tipoConcreto("precipitacion", 5.1), "lluvia");
  assert.strictEqual(tipoConcreto("precipitacion", 30), "lluvia");
});

test("tipoConcreto: el resto de estados pasan tal cual", () => {
  assert.strictEqual(tipoConcreto("soleado", 20), "soleado");
  assert.strictEqual(tipoConcreto("nublado", -5), "nublado");
  assert.strictEqual(tipoConcreto("viento", 10), "viento");
});

test("nevoEnFranja/algunaFranjaNevo: nunca nieva en pleno verano (demasiado calor en toda la franja)", () => {
  const { estacion, diaDelAnio } = estacionYDiaDelAnio(DIA_MITAD_VERANO);
  for (let dia = DIA_MITAD_VERANO; dia < DIA_MITAD_VERANO + 60; dia++) {
    assert.strictEqual(algunaFranjaNevo(dia, estacion as Estacion, diaDelAnio), false, `nevó en pleno verano, día ${dia}`);
  }
});

test("algunaFranjaNevo: SÍ puede nevar en mitad de invierno (con suficientes días probados)", () => {
  let alguno = false;
  for (let anio = 0; anio < 10 && !alguno; anio++) {
    const dia = DIA_MITAD_INVIERNO + anio * 360;
    const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
    if (algunaFranjaNevo(dia, estacion as Estacion, diaDelAnio)) alguno = true;
  }
  assert.ok(alguno, "nunca nevó en 10 años de mitad de invierno probados");
});

test("algunaFranjaNevo: más frecuente en el corazón del invierno que en sus bordes (tapering pedido por el streamer)", () => {
  let enCorazon = 0, enBorde = 0;
  const ANIOS = 15;
  for (let anio = 0; anio < ANIOS; anio++) {
    // corazón: día 300-330 (mitad de invierno, más frío); borde: día 271-285 (recién empezado, más templado)
    for (let dia = 271 + anio * 360; dia <= 285 + anio * 360; dia++) {
      const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
      if (algunaFranjaNevo(dia, estacion as Estacion, diaDelAnio)) enBorde++;
    }
    for (let dia = 300 + anio * 360; dia <= 330 + anio * 360; dia++) {
      const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
      if (algunaFranjaNevo(dia, estacion as Estacion, diaDelAnio)) enCorazon++;
    }
  }
  assert.ok(enCorazon > enBorde, `esperaba más días de nieve en el corazón del invierno (${enCorazon}) que en el borde (${enBorde})`);
});

test("temperaturaTarde: coincide con temperaturaMundo a la hora representativa de la franja 'tarde' (15h)", () => {
  assert.strictEqual(temperaturaTarde(200), temperaturaMundo(200, 15));
});

test("estadoClimaEnHora: el tipo es el de la franja, la temperatura es la curva continua real de esa hora exacta", () => {
  const dia = 300;
  const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
  const e = estadoClimaEnHora(dia, 13, estacion as Estacion, diaDelAnio);
  assert.strictEqual(e.temperaturaC, temperaturaMundo(diaDelAnio, 13));
  // misma franja (tarde, 12-18h) a otra hora: mismo tipo, temperatura distinta
  const e2 = estadoClimaEnHora(dia, 17, estacion as Estacion, diaDelAnio);
  assert.strictEqual(e.tipo, e2.tipo);
  assert.notStrictEqual(e.temperaturaC, e2.temperaturaC);
});

test("estadoClimaDelDia/temperaturaMundoDelDia: conveniencias que derivan estación/día-del-año igual que estacionYDiaDelAnio", () => {
  const dia = 500;
  const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
  assert.deepStrictEqual(estadoClimaDelDia(dia, 9), estadoClimaEnHora(dia, 9, estacion as Estacion, diaDelAnio));
  assert.strictEqual(temperaturaMundoDelDia(dia, 9), temperaturaMundo(diaDelAnio, 9));
});
