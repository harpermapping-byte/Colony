// Tests de la lógica PURA de atributos (server/src/personaje/atributos.ts +
// server/src/progresion/nivel.ts, docs/GDD_Personaje.md).
import { test } from "node:test";
import * as assert from "node:assert";
import { ATRIBUTOS, esAtributoValido } from "../src/personaje/atributos";
import { nivelDeXp } from "../src/progresion/nivel";

test("ATRIBUTOS: son los 6 que pidió el streamer, en este orden", () => {
  assert.deepStrictEqual(ATRIBUTOS, ["fuerza", "destreza", "inteligencia", "sigilo", "carisma", "liderazgo"]);
});

test("esAtributoValido: reconoce los 6 válidos y rechaza cualquier otra cosa", () => {
  for (const a of ATRIBUTOS) assert.strictEqual(esAtributoValido(a), true);
  assert.strictEqual(esAtributoValido("oficio_inventado"), false);
  assert.strictEqual(esAtributoValido(""), false);
});

test("nivelDeXp: nivel base sin XP es 1, mismo comportamiento que oficios (fuente compartida)", () => {
  assert.strictEqual(nivelDeXp(0), 1);
  assert.strictEqual(nivelDeXp(29), 1);
  assert.strictEqual(nivelDeXp(100), 2);
});
