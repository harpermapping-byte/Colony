// Tests de mundo/lootProcedural.ts — loot procedural de cadáver de jefe
// HUMANOIDE (pedido 2026-08-31: "loot procedural por cadáver de enemigos,
// solo bosses humanoides no animales"). Lógica PURA, sin BD ni Colyseus.
import { test } from "node:test";
import * as assert from "node:assert";
import { generarLootBoss, cargarCatalogoLootBoss, cargarCatalogoLootTematico, cargarCatalogoLootLegendario } from "../src/mundo/lootProcedural";
import { esEnemigoHumanoide, temasDeEnemigo } from "../src/mundo/catalogoEnemigos";
import { cargarCatalogoItems } from "../src/inventario/inventario";

const catalogo = cargarCatalogoLootBoss();
const catalogoItems = cargarCatalogoItems();

test("cargarCatalogoLootBoss: todos los itemId del pool existen de verdad en items/catalogo/items.json", () => {
  for (const entrada of catalogo.pool) {
    assert.ok(entrada.itemId in catalogoItems, `${entrada.itemId} no está en el catálogo de ítems`);
  }
});

test("generarLootBoss: siempre da entre numDropsMin y numDropsMax artículos (acotado al tamaño del pool), sin itemId repetido", () => {
  for (let i = 0; i < 50; i++) {
    const loot = generarLootBoss(catalogo);
    assert.ok(loot.length >= Math.min(catalogo.numDropsMin, catalogo.pool.length));
    assert.ok(loot.length <= Math.min(catalogo.numDropsMax, catalogo.pool.length));
    assert.strictEqual(new Set(loot.map((l) => l.itemId)).size, loot.length, "sin duplicados en la misma muerte");
    for (const { itemId, cantidad } of loot) {
      const entrada = catalogo.pool.find((e) => e.itemId === itemId)!;
      assert.ok(cantidad >= entrada.cantidadMin && cantidad <= entrada.cantidadMax, `${itemId}: cantidad ${cantidad} fuera de rango`);
    }
  }
});

test("generarLootBoss: con un pool más pequeño que numDropsMin, no revienta — da como mucho el tamaño del pool", () => {
  const catalogoPequeno = { numDropsMin: 5, numDropsMax: 8, pool: [{ itemId: "daga", peso: 1, cantidadMin: 1, cantidadMax: 1 }] };
  const loot = generarLootBoss(catalogoPequeno);
  assert.strictEqual(loot.length, 1);
});

test("esEnemigoHumanoide: true para un enemigo npc (bandido/goblin/orco...), false para uno animal, false para un id inexistente", () => {
  assert.strictEqual(esEnemigoHumanoide("capitan_bandidos"), true);
  assert.strictEqual(esEnemigoHumanoide("jefe_goblin_grande"), true);
  assert.strictEqual(esEnemigoHumanoide("lobo_alfa"), false, "boss animal — excluido a propósito");
  assert.strictEqual(esEnemigoHumanoide("reina_arana"), false, "boss animal — excluido a propósito");
  assert.strictEqual(esEnemigoHumanoide("esto_no_existe"), false);
});

// docs/GDD_Combate.md §11ter (2026-09-07, pedido streamer: "sus armaduras y
// armas... pero con la tematica del enemigo") — loot temático de boss,
// complemento del pool genérico de arriba.
const tematico = cargarCatalogoLootTematico();

test("cargarCatalogoLootTematico: los 7 temas tienen exactamente 1 arma + 1 armadura, todas existen de verdad en items.json", () => {
  const temasEsperados = ["goblin", "trasgo", "no_muerto", "bandido", "orco", "cultista", "pirata"];
  for (const tema of temasEsperados) {
    const entrada = tematico[tema];
    assert.ok(entrada, `falta el tema ${tema}`);
    assert.strictEqual(entrada.armas.length, 1, `${tema}: se esperaba 1 arma`);
    assert.strictEqual(entrada.armaduras.length, 1, `${tema}: se esperaba 1 armadura`);
    for (const itemId of [...entrada.armas, ...entrada.armaduras]) {
      assert.ok(itemId in catalogoItems, `${tema}: ${itemId} no está en items.json`);
    }
  }
});

test("generarLootBoss: sin `temas`, nunca cuela loot temático (retrocompatible con las llamadas de siempre)", () => {
  for (let i = 0; i < 200; i++) {
    const loot = generarLootBoss(catalogo);
    assert.ok(!loot.some((l) => l.itemId.endsWith("_goblin") || l.itemId.endsWith("_orco")), "loot temático sin pedirlo");
  }
});

test("generarLootBoss: con un tema desconocido, se comporta igual que sin tema (no revienta, nunca añade nada)", () => {
  for (let i = 0; i < 50; i++) {
    const loot = generarLootBoss(catalogo, ["tema_que_no_existe"]);
    assert.ok(loot.length <= catalogo.numDropsMax);
  }
});

test("generarLootBoss: con un tema real, en un número suficiente de tiradas cae AL MENOS UNA VEZ el arma o la armadura de ESE tema (probabilístico, no cada vez)", () => {
  const piezasGoblin = new Set(tematico.goblin.armas.concat(tematico.goblin.armaduras));
  let vecesConTematico = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const loot = generarLootBoss(catalogo, ["goblin"]);
    if (loot.some((l) => piezasGoblin.has(l.itemId))) vecesConTematico++;
  }
  assert.ok(vecesConTematico > 0, "en 300 tiradas con tema goblin, nunca cayó su pieza temática");
  assert.ok(vecesConTematico < N, "en 300 tiradas con tema goblin, SIEMPRE cayó — debería ser probabilístico, no garantizado");
});

test("temasDeEnemigo: devuelve los temasEnemigo reales del catálogo, array vacío si no existe", () => {
  assert.deepStrictEqual(temasDeEnemigo("jefe_goblin_grande"), ["goblin"]);
  assert.deepStrictEqual(temasDeEnemigo("guardian_arcano"), ["cultista", "no_muerto"]);
  assert.deepStrictEqual(temasDeEnemigo("esto_no_existe"), []);
});

// docs/GDD_Combate.md §11quinquies (2026-09-07, pedido streamer: "que estas no
// tienen blueprint, y tienen stats mas altos... sets especiales enteros por
// partes de cuerpo") — tercer nivel de loot, aún más raro que el temático.
const legendario = cargarCatalogoLootLegendario();
const recetasCatalogo: Record<string, { salidaItemId?: string }> = require("../../items/catalogo/recetas.json");
const idsConReceta = new Set(Object.values(recetasCatalogo).filter((r) => r && r.salidaItemId).map((r) => r.salidaItemId as string));

test("cargarCatalogoLootLegendario: los 7 temas tienen 1 arma + 5 piezas de armadura (6 piezas), todas existen en items.json", () => {
  const temasEsperados = ["goblin", "trasgo", "no_muerto", "bandido", "orco", "cultista", "pirata"];
  for (const tema of temasEsperados) {
    const entrada = legendario[tema];
    assert.ok(entrada, `falta el tema ${tema}`);
    assert.strictEqual(entrada.piezas.length, 6, `${tema}: se esperaban 6 piezas (1 arma + 5 de armadura)`);
    for (const itemId of entrada.piezas) assert.ok(itemId in catalogoItems, `${tema}: ${itemId} no está en items.json`);
  }
});

test("las 42 piezas legendarias NUNCA tienen receta de crafteo real (nunca craftables, a propósito)", () => {
  for (const tema of ["goblin", "trasgo", "no_muerto", "bandido", "orco", "cultista", "pirata"]) {
    for (const itemId of legendario[tema].piezas) assert.ok(!idsConReceta.has(itemId), `${itemId} tiene receta — debería ser exclusivo de loot`);
  }
});

test("generarLootBoss: con un tema real, en un número suficiente de tiradas cae AL MENOS UNA VEZ una pieza legendaria (mucho más raro que el bonus temático, pero no nunca)", () => {
  const piezasGoblin = new Set(legendario.goblin.piezas);
  let veces = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const loot = generarLootBoss(catalogo, ["goblin"]);
    if (loot.some((l) => piezasGoblin.has(l.itemId))) veces++;
  }
  assert.ok(veces > 0, "en 600 tiradas con tema goblin, nunca cayó una pieza legendaria");
  assert.ok(veces < N, "en 600 tiradas, SIEMPRE cayó pieza legendaria — debería ser probabilístico y raro");
});
