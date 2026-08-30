// Tests de mundo/lootCaza.ts — REDISEÑADO 2026-08-30 (octava pasada):
// matar un animal ya no da carne/tendones/tripas sueltos, da UN ÚNICO ítem
// "cadáver entero" (procesarlo es cosa de despiece.ts, ver despiece.test.ts).
// Lógica PURA, sin BD ni Colyseus. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { rellenarLootCaza, cadaverItemId, datosDeCadaver, sacrificarAnimalGranja, PROBABILIDAD_TROFEO } from "../src/mundo/lootCaza";
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

test("cadaverItemId: codifica carne+piel+tamaño en el propio id", () => {
  assert.strictEqual(cadaverItemId(JABALI), "cadaver_carne_caza_mayor_cuero_grueso_grande");
  assert.strictEqual(cadaverItemId(CONEJO), "cadaver_carne_blanca_piel_basta_pequeno");
});

test("cadaverItemId: sin categoriaRecursoCarne/Piel usa generico/sinpiel", () => {
  assert.strictEqual(cadaverItemId(SIN_RECURSOS), "cadaver_generico_sinpiel_mediano");
});

test("datosDeCadaver: resuelve carne/piel/categoriaVida a partir del itemId de un cadáver real", () => {
  const datos = datosDeCadaver(cadaverItemId(JABALI));
  assert.deepStrictEqual(datos, { carne: "carne_caza_mayor", piel: "cuero_grueso", categoriaVida: "grande" });
});

test("datosDeCadaver: itemId que no es un cadáver conocido devuelve undefined", () => {
  assert.strictEqual(datosDeCadaver("madera_dura"), undefined);
  assert.strictEqual(datosDeCadaver("cadaver_inventado_sin_dar_de_alta_alfa"), undefined);
});

test("rellenarLootCaza: da UN ÚNICO ítem 'cadáver entero', nunca carne/tendones/tripas sueltos", () => {
  const c = crearContenedor(4, 3);
  rellenarLootCaza(c, catalogo, JABALI);
  assert.strictEqual(c.items.length, 1);
  assert.strictEqual(c.items[0].itemId, cadaverItemId(JABALI));
  assert.strictEqual(c.items[0].cantidad, 1);
});

test("rellenarLootCaza: especie sin categoriaRecursoCarne/Piel también da su cadáver genérico (no revienta)", () => {
  const c = crearContenedor(4, 3);
  rellenarLootCaza(c, catalogo, SIN_RECURSOS);
  assert.strictEqual(c.items.length, 1);
  assert.strictEqual(c.items[0].itemId, "cadaver_generico_sinpiel_mediano");
});

test("rellenarLootCaza: combo sin dar de alta en el catálogo no revienta, simplemente no da nada (mismo criterio 'las listas crecen')", () => {
  const c = crearContenedor(4, 3);
  const especieRara: EstadisticasCombateAnimal = { ...JABALI, categoriaVida: "cria", categoriaRecursoCarne: "carne_inventada_para_el_test" };
  rellenarLootCaza(c, catalogo, especieRara);
  assert.strictEqual(c.items.length, 0);
});

test("sacrificarAnimalGranja: rendimiento COMPLETO instantáneo (sin fracción de campo), sin ítem cadáver de por medio", () => {
  const r = sacrificarAnimalGranja(JABALI, () => 0.99); // rnd alto: sin trofeo, aislar el resto
  assert.deepStrictEqual(r.carne, { itemId: "carne_caza_mayor", cantidad: 7 }); // grande, cantidad completa
  assert.strictEqual(r.tendones, 3);
  assert.strictEqual(r.tripas, 3);
  assert.strictEqual(r.grasa, 4);
  assert.deepStrictEqual(r.piel, { itemId: "cuero_grueso", cantidad: 3 });
  assert.strictEqual(r.trofeoItemId, undefined);
});

test("sacrificarAnimalGranja: especie sin categoriaRecursoCarne/Piel da tendones/tripas/grasa sin carne ni piel", () => {
  const r = sacrificarAnimalGranja(SIN_RECURSOS, () => 0.99);
  assert.strictEqual(r.carne, undefined);
  assert.strictEqual(r.piel, undefined);
  assert.strictEqual(r.tendones, 2); // mediano
  assert.strictEqual(r.tripas, 2);
  assert.strictEqual(r.grasa, 2);
});

test("sacrificarAnimalGranja: trofeo exactamente en el umbral de PROBABILIDAD_TROFEO (5%)", () => {
  const justoDebajo = sacrificarAnimalGranja(JABALI, () => PROBABILIDAD_TROFEO - 0.0001);
  assert.strictEqual(justoDebajo.trofeoItemId, "cabeza_trofeo_grande");
  const justoEncimaOIgual = sacrificarAnimalGranja(JABALI, () => PROBABILIDAD_TROFEO);
  assert.strictEqual(justoEncimaOIgual.trofeoItemId, undefined); // rnd() < PROBABILIDAD_TROFEO, no <=
});

test("catálogo real: todos los ítems que usa lootCaza.ts existen de verdad en items.json", () => {
  for (const id of ["tendones", "tripas", "grasa", "curtiente", "cuchillo_desollar", "cabeza_trofeo_pequena", "cabeza_trofeo_mediana", "cabeza_trofeo_grande"]) {
    assert.ok(catalogo[id], `falta ${id} en items/catalogo/items.json`);
  }
});

test("catálogo real: cadaverItemId de TODA especie real de baker/catalogo/animales.json resuelve a un item real", () => {
  const animales = JSON.parse(require("fs").readFileSync(require("path").resolve(__dirname, "..", "..", "baker", "catalogo", "animales.json"), "utf8"));
  const huerfanas = new Set<string>();
  for (const [id, def] of Object.entries<any>(animales)) {
    if (id.startsWith("_") || !def.categoriaVida) continue;
    const especie: EstadisticasCombateAnimal = {
      categoriaVida: def.categoriaVida, vidaMaxima: 1, ataque: 1, peligroso: false, domesticable: false,
      categoriaRecursoCarne: def.categoriaRecursoCarne, categoriaRecursoPiel: def.categoriaRecursoPiel,
    };
    const itemId = cadaverItemId(especie);
    if (!catalogo[itemId]) huerfanas.add(itemId);
  }
  assert.deepStrictEqual([...huerfanas], [], `combos de animales.json sin item de cadáver: ${[...huerfanas].join(", ")}`);
});
