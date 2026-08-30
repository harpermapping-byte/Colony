// Tests del calendario (server/src/mundo/tiempoMundo.ts, docs/GDD_Clima.md:
// 12 meses de 30 días = 1 año de 360 días, 4 estaciones de 3 meses).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { tiempoMundo } from "../src/mundo/tiempoMundo";
import * as tiempoJson from "../../assets/mundo/tiempo.json";

const MS_POR_DIA = tiempoJson.minutosRealesPorDia * 60_000;
const EPOCA = tiempoJson.epocaUnixMs;

function paraDia(dia: number, horaFraccional = 0) {
  return tiempoMundo(EPOCA + (dia + horaFraccional / 24) * MS_POR_DIA);
}

test("mes: día 0 es mes 1, estación primavera (arranque del calendario)", () => {
  const t = paraDia(0);
  assert.strictEqual(t.mes, 1);
  assert.strictEqual(t.estacion, "primavera");
});

test("mes: sube de 1 a 12 a lo largo del año, nunca se sale de rango", () => {
  for (let dia = 0; dia < 400; dia += 7) {
    const t = paraDia(dia);
    assert.ok(t.mes >= 1 && t.mes <= 12, `mes fuera de rango: ${t.mes} en día ${dia}`);
  }
});

test("mes 4 (día 90) cae en verano — primer mes de la segunda estación", () => {
  const t = paraDia(90);
  assert.strictEqual(t.mes, 4);
  assert.strictEqual(t.estacion, "verano");
});

test("el año se repite tras 360 días (día 360 vuelve a mes 1 / primavera, año 1)", () => {
  const t = paraDia(360);
  assert.strictEqual(t.mes, 1);
  assert.strictEqual(t.estacion, "primavera");
  assert.strictEqual(t.anio, 1);
});

test("las 4 estaciones duran 90 días cada una (3 meses de 30 días)", () => {
  const estaciones = ["primavera", "verano", "otono", "invierno"];
  for (let i = 0; i < 4; i++) {
    const inicio = paraDia(i * 90);
    const finalDeEstacion = paraDia(i * 90 + 89);
    assert.strictEqual(inicio.estacion, estaciones[i], `día ${i * 90}`);
    assert.strictEqual(finalDeEstacion.estacion, estaciones[i], `día ${i * 90 + 89}`);
  }
});
