// Tests de la lógica PURA de atributos (server/src/personaje/atributos.ts +
// server/src/progresion/nivel.ts, docs/GDD_Personaje.md).
import { test } from "node:test";
import * as assert from "node:assert";
import { ATRIBUTOS, esAtributoValido, bonusVelocidadCorrerPorNivelResistencia } from "../src/personaje/atributos";
import { nivelDeXp } from "../src/progresion/nivel";

test("ATRIBUTOS: los 5 finales 2026-08-30 (liderazgo fuera, resistencia dentro, sigilo retirado, comercio fusionado en carisma), en este orden", () => {
  assert.deepStrictEqual(ATRIBUTOS, ["fuerza", "destreza", "inteligencia", "resistencia", "carisma"]);
});

test("esAtributoValido: reconoce los 5 válidos y rechaza cualquier otra cosa", () => {
  for (const a of ATRIBUTOS) assert.strictEqual(esAtributoValido(a), true);
  assert.strictEqual(esAtributoValido("liderazgo"), false, "liderazgo se retiró de la lista de atributos");
  assert.strictEqual(esAtributoValido("sigilo"), false, "sigilo se retiró entero, sin sistema al que engancharlo");
  assert.strictEqual(esAtributoValido("comercio"), false, "comercio se fusionó dentro de carisma");
  assert.strictEqual(esAtributoValido("oficio_inventado"), false);
  assert.strictEqual(esAtributoValido(""), false);
});

test("nivelDeXp: nivel base sin XP es 1, mismo comportamiento que oficios (fuente compartida)", () => {
  assert.strictEqual(nivelDeXp(0), 1);
  assert.strictEqual(nivelDeXp(29), 1);
  assert.strictEqual(nivelDeXp(100), 2);
});

// docs/GDD_Personaje.md §3.4bis (2026-09-07, pedido streamer: "correr podrias
// ir mas rapido dependiendo de tu nivel de habilidad") — 0% en nivel 1, +20%
// en nivel 10, lineal, mismo criterio que bonusVelocidadCrafteoPorNivelOficio.
test("bonusVelocidadCorrerPorNivelResistencia: x1 en nivel 1, x1.2 en nivel 10, lineal entre medias, y nunca revienta fuera de rango", () => {
  assert.strictEqual(bonusVelocidadCorrerPorNivelResistencia(1), 1);
  assert.strictEqual(bonusVelocidadCorrerPorNivelResistencia(10), 1.2);
  assert.ok(Math.abs(bonusVelocidadCorrerPorNivelResistencia(5) - 1.0889) < 0.001);
  assert.strictEqual(bonusVelocidadCorrerPorNivelResistencia(0), bonusVelocidadCorrerPorNivelResistencia(1), "por debajo de 1 se acota a nivel 1");
  assert.strictEqual(bonusVelocidadCorrerPorNivelResistencia(99), bonusVelocidadCorrerPorNivelResistencia(10), "por encima de 10 se acota al tope");
});
