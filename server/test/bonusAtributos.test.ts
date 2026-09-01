// Tests de personaje/bonusAtributos.ts — qué hace cada nivel de cada
// atributo (docs/GDD_Personaje.md §3.3, pedido 2026-08-30: "nivel 1 sin
// bonus, nivel 10 con bonus, cada nivel que tenga"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  paMaxPorDestreza,
  cooldownNpcHablarMs,
  descuentoComercio,
  factorVelocidadCrafteo,
  pesoMaximoTransportable,
  vidaMaximaPorResistencia,
  probabilidadHuirPorCarisma,
} from "../src/personaje/bonusAtributos";

test("pesoMaximoTransportable: nivel 1 es la base (20), nivel 10 el máximo, monótona entre medias", () => {
  assert.strictEqual(pesoMaximoTransportable(1), 20);
  assert.strictEqual(pesoMaximoTransportable(10), 56);
  for (let n = 2; n <= 10; n++) assert.ok(pesoMaximoTransportable(n) > pesoMaximoTransportable(n - 1));
});

test("vidaMaximaPorResistencia: nivel 1 es la vida base del jugador (100), nivel 10 el máximo", () => {
  assert.strictEqual(vidaMaximaPorResistencia(1), 100);
  assert.strictEqual(vidaMaximaPorResistencia(10), 190);
  for (let n = 2; n <= 10; n++) assert.ok(vidaMaximaPorResistencia(n) > vidaMaximaPorResistencia(n - 1));
});

test("paMaxPorDestreza: nivel 1 sin bonus (6 PA, el mismo tope fijo PA_MAX_COMBATE de antes), sube por tramos de 3 niveles", () => {
  assert.strictEqual(paMaxPorDestreza(1), 6);
  assert.strictEqual(paMaxPorDestreza(3), 6);
  assert.strictEqual(paMaxPorDestreza(4), 7);
  assert.strictEqual(paMaxPorDestreza(6), 7);
  assert.strictEqual(paMaxPorDestreza(7), 8);
  assert.strictEqual(paMaxPorDestreza(10), 9);
});

test("factorVelocidadCrafteo: nivel 1 = 1.0 (sin bonus), sube monótono hasta nivel 10", () => {
  assert.strictEqual(factorVelocidadCrafteo(1), 1);
  assert.ok(factorVelocidadCrafteo(10) > factorVelocidadCrafteo(1));
  for (let n = 2; n <= 10; n++) assert.ok(factorVelocidadCrafteo(n) > factorVelocidadCrafteo(n - 1));
});

test("cooldownNpcHablarMs: nivel 1 es el cooldown ya existente (3000ms), nunca baja de 1000ms", () => {
  assert.strictEqual(cooldownNpcHablarMs(1), 3000);
  assert.ok(cooldownNpcHablarMs(10) >= 1000);
  assert.ok(cooldownNpcHablarMs(10) < cooldownNpcHablarMs(1));
});

test("descuentoComercio: (Comercio fusionado dentro de Carisma) nivel 1 = 0 (precio de lista), tope duro en 18% aunque se le dé más nivel del máximo", () => {
  assert.strictEqual(descuentoComercio(1), 0);
  assert.strictEqual(descuentoComercio(10), 0.18);
  assert.strictEqual(descuentoComercio(999), 0.18, "nunca supera el tope, aunque se llame con un nivel fuera de rango");
});

test("probabilidadHuirPorCarisma: nivel 1 = 30% base (pedido streamer), nivel 10 = 52.5%, monótona entre medias", () => {
  assert.strictEqual(probabilidadHuirPorCarisma(1), 0.3);
  assert.strictEqual(probabilidadHuirPorCarisma(10), 0.525);
  for (let n = 2; n <= 10; n++) assert.ok(probabilidadHuirPorCarisma(n) > probabilidadHuirPorCarisma(n - 1));
});
