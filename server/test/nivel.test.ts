// Tests de progresion/nivel.ts — curva de niveles compartida (docs/GDD_Personaje.md,
// pedido 2026-08-30: "cada atributo de 1 a 10 niveles, más XP por nivel, que
// no se leveé muy rápido"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { generarUmbrales, nivelDeXp, UMBRALES_NIVEL, UMBRALES_NIVEL_ATRIBUTO } from "../src/progresion/nivel";

test("generarUmbrales: reproduce EXACTAMENTE la tabla de oficios ya existente (6 niveles, base 100)", () => {
  assert.deepStrictEqual(generarUmbrales(6, 100), [0, 100, 300, 600, 1000, 1500]);
  assert.deepStrictEqual(UMBRALES_NIVEL, [0, 100, 300, 600, 1000, 1500]);
});

test("generarUmbrales: 10 niveles — cada salto pide MÁS que el anterior (nunca lineal)", () => {
  const umbrales = generarUmbrales(10, 100);
  assert.strictEqual(umbrales.length, 10);
  assert.deepStrictEqual(umbrales, [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]);
  for (let i = 2; i < umbrales.length; i++) {
    const saltoActual = umbrales[i] - umbrales[i - 1];
    const saltoAnterior = umbrales[i - 1] - umbrales[i - 2];
    assert.ok(saltoActual > saltoAnterior, `el salto al nivel ${i + 1} (${saltoActual}) debería ser mayor que al nivel ${i} (${saltoAnterior})`);
  }
});

test("UMBRALES_NIVEL_ATRIBUTO: tope real en nivel 10, 3x más caro que el antiguo tope de oficios (nivel 6)", () => {
  assert.strictEqual(UMBRALES_NIVEL_ATRIBUTO.length, 10);
  assert.strictEqual(UMBRALES_NIVEL_ATRIBUTO[9], 4500);
  assert.strictEqual(UMBRALES_NIVEL_ATRIBUTO[9], UMBRALES_NIVEL[5] * 3);
});

test("nivelDeXp: con la curva de atributos, nunca pasa de nivel 10 por mucha XP que se le dé", () => {
  assert.strictEqual(nivelDeXp(4500, UMBRALES_NIVEL_ATRIBUTO), 10);
  assert.strictEqual(nivelDeXp(999999, UMBRALES_NIVEL_ATRIBUTO), 10);
  assert.strictEqual(nivelDeXp(4499, UMBRALES_NIVEL_ATRIBUTO), 9);
});

test("nivelDeXp: sin segundo argumento sigue usando la curva de oficios (compatibilidad con crafteo.ts)", () => {
  assert.strictEqual(nivelDeXp(1500), 6);
  assert.strictEqual(nivelDeXp(999999), 6);
});
