// Tests de la lógica PURA de clima (server/src/mundo/clima.ts, docs/GDD_Clima.md).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { climaDelDia, temperaturaMundo, estadoClima } from "../src/mundo/clima";

test("climaDelDia: determinista — mismo día y estación siempre da el mismo resultado", () => {
  const a = climaDelDia(123, "invierno");
  const b = climaDelDia(123, "invierno");
  assert.strictEqual(a, b);
});

test("climaDelDia: días distintos pueden dar climas distintos (no siempre el mismo valor fijo)", () => {
  const resultados = new Set<string>();
  for (let dia = 0; dia < 60; dia++) resultados.add(climaDelDia(dia, "invierno"));
  assert.ok(resultados.size > 1, `esperaba variedad de clima, salió siempre ${[...resultados]}`);
});

test("climaDelDia: nunca nieva fuera de invierno (peso 0 en el catálogo)", () => {
  for (const estacion of ["primavera", "verano", "otono"] as const) {
    for (let dia = 0; dia < 200; dia++) {
      assert.notStrictEqual(climaDelDia(dia, estacion), "nieve", `nevó en ${estacion}, día ${dia}`);
    }
  }
});

test("climaDelDia: sí puede nevar en invierno (con suficientes días, alguno cae 'nieve')", () => {
  const vistos = new Set<string>();
  for (let dia = 0; dia < 300; dia++) vistos.add(climaDelDia(dia, "invierno"));
  assert.ok(vistos.has("nieve"), `nunca salió nieve en 300 días de invierno probados: ${[...vistos]}`);
});

test("temperaturaMundo: verano es más cálido que invierno a la misma hora", () => {
  assert.ok(temperaturaMundo("verano", 15) > temperaturaMundo("invierno", 15));
});

test("temperaturaMundo: media tarde (15h) es más cálida que la madrugada (3h) en la misma estación", () => {
  assert.ok(temperaturaMundo("verano", 15) > temperaturaMundo("verano", 3));
});

test("temperaturaMundo: determinista (mismos argumentos, mismo resultado)", () => {
  assert.strictEqual(temperaturaMundo("otono", 10), temperaturaMundo("otono", 10));
});

test("estadoClima: combina climaDelDia y temperaturaMundo en un solo resultado", () => {
  const e = estadoClima(50, "primavera", 12);
  assert.strictEqual(e.tipo, climaDelDia(50, "primavera"));
  assert.strictEqual(e.temperaturaC, temperaturaMundo("primavera", 12));
});
