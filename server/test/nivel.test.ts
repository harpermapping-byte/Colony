// Tests de progresion/nivel.ts — curva de niveles compartida (docs/GDD_Personaje.md,
// pedido 2026-08-30: "cada atributo de 1 a 10 niveles, más XP por nivel, que
// no se leveé muy rápido"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { generarUmbrales, nivelDeXp, UMBRALES_NIVEL, UMBRALES_NIVEL_ATRIBUTO } from "../src/progresion/nivel";

test("generarUmbrales: 10 niveles base 90 (curva de oficios ronda 2, pedido 2026-08-30)", () => {
  assert.deepStrictEqual(generarUmbrales(10, 90), [0, 90, 270, 540, 900, 1350, 1890, 2520, 3240, 4050]);
  assert.deepStrictEqual(UMBRALES_NIVEL, [0, 90, 270, 540, 900, 1350, 1890, 2520, 3240, 4050]);
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

test("UMBRALES_NIVEL_ATRIBUTO: tope real en nivel 10, algo más caro que el tope de oficios (mismos 10 niveles, base más alta)", () => {
  assert.strictEqual(UMBRALES_NIVEL_ATRIBUTO.length, 10);
  assert.strictEqual(UMBRALES_NIVEL_ATRIBUTO[9], 4500);
  assert.ok(UMBRALES_NIVEL_ATRIBUTO[9] > UMBRALES_NIVEL[9], "un atributo al máximo debe costar más XP que un oficio al máximo");
});

test("nivelDeXp: con la curva de atributos, nunca pasa de nivel 10 por mucha XP que se le dé", () => {
  assert.strictEqual(nivelDeXp(4500, UMBRALES_NIVEL_ATRIBUTO), 10);
  assert.strictEqual(nivelDeXp(999999, UMBRALES_NIVEL_ATRIBUTO), 10);
  assert.strictEqual(nivelDeXp(4499, UMBRALES_NIVEL_ATRIBUTO), 9);
});

test("nivelDeXp: sin segundo argumento sigue usando la curva de oficios (compatibilidad con crafteo.ts), ahora con tope en nivel 10", () => {
  assert.strictEqual(nivelDeXp(4050), 10);
  assert.strictEqual(nivelDeXp(999999), 10);
});
