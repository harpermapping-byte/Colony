// Tests de mundo/lootProcedural.ts — loot procedural de cadáver de jefe
// HUMANOIDE (pedido 2026-08-31: "loot procedural por cadáver de enemigos,
// solo bosses humanoides no animales"). Lógica PURA, sin BD ni Colyseus.
import { test } from "node:test";
import * as assert from "node:assert";
import { generarLootBoss, cargarCatalogoLootBoss } from "../src/mundo/lootProcedural";
import { esEnemigoHumanoide } from "../src/mundo/catalogoEnemigos";
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
