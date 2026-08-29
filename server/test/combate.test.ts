// Tests de combate/combate.ts — fórmula pura de daño/curación (docs/GDD_Mecanicas.md
// §5.4, pedido 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  Estadisticas,
  VIDA_BASE_JUGADOR,
  calcularDanio,
  aplicarDanio,
  estaMuerto,
  curar,
  estadisticasAnimal,
  estadisticasJugadorBase,
} from "../src/combate/combate";

test("calcularDanio: resta la defensa del ataque", () => {
  assert.strictEqual(calcularDanio(20, 5), 15);
});

test("calcularDanio: nunca baja de 1, aunque la defensa sea mayor que el ataque", () => {
  assert.strictEqual(calcularDanio(5, 100), 1);
  assert.strictEqual(calcularDanio(5, 5), 1);
});

test("calcularDanio: un animal (defensa 0) recibe el ataque tal cual", () => {
  assert.strictEqual(calcularDanio(12, 0), 12);
});

test("aplicarDanio: resta de la vida sin bajar de 0", () => {
  const s: Estadisticas = { vida: 10, vidaMax: 50, ataque: 5, defensa: 0 };
  assert.strictEqual(aplicarDanio(s, 4).vida, 6);
  assert.strictEqual(aplicarDanio(s, 100).vida, 0);
});

test("aplicarDanio: no muta el original", () => {
  const s: Estadisticas = { vida: 10, vidaMax: 50, ataque: 5, defensa: 0 };
  aplicarDanio(s, 4);
  assert.strictEqual(s.vida, 10);
});

test("estaMuerto: true a 0 o menos, false por encima", () => {
  assert.strictEqual(estaMuerto({ vida: 0 }), true);
  assert.strictEqual(estaMuerto({ vida: -3 }), true);
  assert.strictEqual(estaMuerto({ vida: 1 }), false);
});

test("curar: suma vida sin pasar de vidaMax, no muta el original", () => {
  const s: Estadisticas = { vida: 10, vidaMax: 20, ataque: 5, defensa: 0 };
  const curado = curar(s, 100);
  assert.strictEqual(curado.vida, 20);
  assert.strictEqual(s.vida, 10, "no muta el original");
  assert.strictEqual(curar(s, 3).vida, 13);
});

test("estadisticasAnimal: siempre sale con defensa 0, vida = vidaMax de catálogo", () => {
  const s = estadisticasAnimal({ vidaMaxima: 50, ataque: 12 });
  assert.deepStrictEqual(s, { vida: 50, vidaMax: 50, ataque: 12, defensa: 0 });
});

test("estadisticasJugadorBase: 100 HP, con defensa (0 sin armadura todavía)", () => {
  const s = estadisticasJugadorBase();
  assert.strictEqual(s.vida, VIDA_BASE_JUGADOR);
  assert.strictEqual(s.vidaMax, VIDA_BASE_JUGADOR);
  assert.strictEqual(s.defensa, 0);
  assert.ok(s.ataque > 0, "a puño limpio ya hace algo de daño");
});
