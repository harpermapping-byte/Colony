// Tests de mundo/lootCaza.ts — loot automático al matar (carne/tendones/
// tripas) y qué da desollar (piel + tirada de trofeo). Lógica PURA, sin BD
// ni Colyseus. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { rellenarLootCaza, pielDeDesollado, PROBABILIDAD_TROFEO } from "../src/mundo/lootCaza";
import { EstadisticasCombateAnimal } from "../src/mundo/catalogoCombateFauna";
import { crearContenedor, cargarCatalogoItems } from "../src/inventario/inventario";

const catalogo = cargarCatalogoItems();

const JABALI: EstadisticasCombateAnimal = {
  categoriaVida: "grande",
  vidaMaxima: 200,
  ataque: 25,
  peligroso: true,
  domesticable: false,
  categoriaRecursoCarne: "carne_caza_mayor",
  categoriaRecursoPiel: "cuero_grueso",
};

const CONEJO: EstadisticasCombateAnimal = {
  categoriaVida: "pequeno",
  vidaMaxima: 15,
  ataque: 2,
  peligroso: false,
  domesticable: false,
  categoriaRecursoCarne: "carne_blanca",
  categoriaRecursoPiel: "piel_basta",
};

// Especie sin categoriaRecursoCarne/Piel en absoluto (caso límite real: el
// backlog admite que no todo el catálogo de animales.json tiene estos campos).
const SIN_RECURSOS: EstadisticasCombateAnimal = {
  categoriaVida: "mediano",
  vidaMaxima: 50,
  ataque: 8,
  peligroso: false,
  domesticable: false,
};

test("rellenarLootCaza: da carne + tendones + tripas, escalado por categoriaVida (grande > pequeño)", () => {
  const cJabali = crearContenedor(4, 3);
  rellenarLootCaza(cJabali, catalogo, JABALI);
  const cConejo = crearContenedor(4, 3);
  rellenarLootCaza(cConejo, catalogo, CONEJO);

  const cantidadDe = (contenedor: typeof cJabali, itemId: string) =>
    contenedor.items.filter((it) => it.itemId === itemId).reduce((s, it) => s + it.cantidad, 0);

  assert.strictEqual(cantidadDe(cJabali, "carne_caza_mayor"), 7);
  assert.strictEqual(cantidadDe(cJabali, "tendones"), 3);
  assert.strictEqual(cantidadDe(cJabali, "tripas"), 3);

  assert.strictEqual(cantidadDe(cConejo, "carne_blanca"), 2);
  assert.strictEqual(cantidadDe(cConejo, "tendones"), 1);
  assert.strictEqual(cantidadDe(cConejo, "tripas"), 1);

  // el jabalí (grande) da más de todo que el conejo (pequeño)
  assert.ok(cantidadDe(cJabali, "tendones") > cantidadDe(cConejo, "tendones"));
});

test("rellenarLootCaza: NUNCA piel en el loot automático — eso es solo de pielDeDesollado", () => {
  const c = crearContenedor(4, 3);
  rellenarLootCaza(c, catalogo, JABALI);
  assert.ok(!c.items.some((it) => it.itemId === "cuero_grueso"));
});

test("rellenarLootCaza: especie sin categoriaRecursoCarne no revienta, sigue dando tendones/tripas", () => {
  const c = crearContenedor(4, 3);
  rellenarLootCaza(c, catalogo, SIN_RECURSOS);
  assert.ok(c.items.some((it) => it.itemId === "tendones"));
  assert.ok(c.items.some((it) => it.itemId === "tripas"));
  assert.strictEqual(c.items.filter((it) => !["tendones", "tripas"].includes(it.itemId)).length, 0);
});

test("pielDeDesollado: da la piel de la especie, cantidad por categoriaVida", () => {
  const r = pielDeDesollado(JABALI, () => 0.99); // rnd alto: sin trofeo, aislar solo la piel
  assert.strictEqual(r.pielItemId, "cuero_grueso");
  assert.strictEqual(r.pielCantidad, 3); // grande
  assert.strictEqual(r.trofeoItemId, null);
});

test("pielDeDesollado: especie sin categoriaRecursoPiel da pielItemId null y cantidad 0", () => {
  const r = pielDeDesollado(SIN_RECURSOS, () => 0.99);
  assert.strictEqual(r.pielItemId, null);
  assert.strictEqual(r.pielCantidad, 0);
});

test("pielDeDesollado: trofeo exactamente en el umbral de PROBABILIDAD_TROFEO (5%)", () => {
  const justoDebajo = pielDeDesollado(JABALI, () => PROBABILIDAD_TROFEO - 0.0001);
  assert.strictEqual(justoDebajo.trofeoItemId, "cabeza_trofeo_grande"); // grande/alfa -> tier grande
  const justoEncimaOIgual = pielDeDesollado(JABALI, () => PROBABILIDAD_TROFEO);
  assert.strictEqual(justoEncimaOIgual.trofeoItemId, null); // rnd() < PROBABILIDAD_TROFEO, no <=
});

test("pielDeDesollado: tier de trofeo por categoriaVida (pequeño/mediano/grande)", () => {
  assert.strictEqual(pielDeDesollado(CONEJO, () => 0).trofeoItemId, "cabeza_trofeo_pequena");
  assert.strictEqual(pielDeDesollado(SIN_RECURSOS, () => 0).trofeoItemId, "cabeza_trofeo_mediana");
  assert.strictEqual(pielDeDesollado(JABALI, () => 0).trofeoItemId, "cabeza_trofeo_grande");
});

test("catálogo real: todos los ítems que usa lootCaza.ts existen de verdad en items.json", () => {
  for (const id of ["tendones", "tripas", "curtiente", "cuchillo_desollar", "cabeza_trofeo_pequena", "cabeza_trofeo_mediana", "cabeza_trofeo_grande"]) {
    assert.ok(catalogo[id], `falta ${id} en items/catalogo/items.json`);
  }
});
