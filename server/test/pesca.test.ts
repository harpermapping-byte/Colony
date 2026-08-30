// Tests de personaje/pesca.ts (docs/GDD_Pesca.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import { tocaPicar, elegirCaptura, TABLA_CAPTURAS, PROBABILIDAD_PICADA } from "../src/personaje/pesca";

test("tocaPicar: azar por debajo de la probabilidad = pica", () => {
  assert.strictEqual(tocaPicar(() => 0), true);
  assert.strictEqual(tocaPicar(() => PROBABILIDAD_PICADA - 0.0001), true);
});

test("tocaPicar: azar en o por encima de la probabilidad = no pica", () => {
  assert.strictEqual(tocaPicar(() => PROBABILIDAD_PICADA), false);
  assert.strictEqual(tocaPicar(() => 0.999999), false);
});

test("elegirCaptura: azar=0 siempre cae en la primera entrada de la tabla", () => {
  assert.strictEqual(elegirCaptura(TABLA_CAPTURAS, () => 0), TABLA_CAPTURAS[0].itemId);
});

test("elegirCaptura: azar justo al borde de la última entrada cae en la última", () => {
  assert.strictEqual(elegirCaptura(TABLA_CAPTURAS, () => 0.999999), TABLA_CAPTURAS[TABLA_CAPTURAS.length - 1].itemId);
});

test("elegirCaptura: respeta el reparto por peso con una tabla simple 1:1", () => {
  const tabla = [
    { itemId: "a", peso: 1 },
    { itemId: "b", peso: 1 },
  ];
  assert.strictEqual(elegirCaptura(tabla, () => 0), "a");
  assert.strictEqual(elegirCaptura(tabla, () => 0.49), "a");
  assert.strictEqual(elegirCaptura(tabla, () => 0.51), "b");
  assert.strictEqual(elegirCaptura(tabla, () => 0.99), "b");
});

test("elegirCaptura: siempre devuelve un itemId de la tabla dada, para cualquier azar en [0,1)", () => {
  const ids = new Set(TABLA_CAPTURAS.map((c) => c.itemId));
  for (const r of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.999]) {
    assert.ok(ids.has(elegirCaptura(TABLA_CAPTURAS, () => r)), `r=${r}`);
  }
});
