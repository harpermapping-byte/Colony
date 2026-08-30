// Tests de mundo/crecimientoBosques.ts (docs/GDD_Bosques.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { EspecieArbol, tocaMadurar, intentaPropagar, puntoAleatorioEnRadio } from "../src/mundo/crecimientoBosques";

const PINO: EspecieArbol = { radioPropagacion: 5, probabilidadPropagacion: 0.045, diasMaduracion: 180 };

test("tocaMadurar: false antes del plazo, true justo al cumplirse y después", () => {
  assert.strictEqual(tocaMadurar(100, 180, 100 + 179), false);
  assert.strictEqual(tocaMadurar(100, 180, 100 + 180), true);
  assert.strictEqual(tocaMadurar(100, 180, 100 + 200), true);
});

test("intentaPropagar: determinista con rnd inyectado — por debajo de la probabilidad es éxito", () => {
  assert.strictEqual(intentaPropagar(PINO, () => 0), true);
  assert.strictEqual(intentaPropagar(PINO, () => PINO.probabilidadPropagacion - 0.001), true);
  assert.strictEqual(intentaPropagar(PINO, () => PINO.probabilidadPropagacion), false);
  assert.strictEqual(intentaPropagar(PINO, () => 0.999), false);
});

test("intentaPropagar: probabilidad 0 nunca tiene éxito, 1 siempre lo tiene (salvo rnd()===valor límite)", () => {
  const nunca: EspecieArbol = { ...PINO, probabilidadPropagacion: 0 };
  assert.strictEqual(intentaPropagar(nunca, () => 0), false);
  const siempre: EspecieArbol = { ...PINO, probabilidadPropagacion: 1 };
  assert.strictEqual(intentaPropagar(siempre, () => 0), true);
  assert.strictEqual(intentaPropagar(siempre, () => 0.999999), true);
});

test("puntoAleatorioEnRadio: rnd()=0 devuelve el propio centro (distancia 0)", () => {
  const p = puntoAleatorioEnRadio(10, 20, 5, () => 0);
  assert.deepStrictEqual(p, { x: 10, y: 20 });
});

test("puntoAleatorioEnRadio: nunca se sale del radio pedido (muestreo)", () => {
  let rndIdx = 0;
  const secuencia = [0.1, 0.9, 0.3, 0.7, 0.99, 0.01, 0.5, 0.25];
  const rnd = () => secuencia[rndIdx++ % secuencia.length];
  for (let i = 0; i < 20; i++) {
    const p = puntoAleatorioEnRadio(0, 0, 5, rnd);
    const dist = Math.hypot(p.x, p.y);
    assert.ok(dist <= 5 + 1e-9, `punto (${p.x},${p.y}) a distancia ${dist} > radio 5`);
  }
});

test("puntoAleatorioEnRadio: radio 0 siempre devuelve el centro exacto", () => {
  const p = puntoAleatorioEnRadio(7, -3, 0, () => 0.5);
  assert.deepStrictEqual(p, { x: 7, y: -3 });
});
