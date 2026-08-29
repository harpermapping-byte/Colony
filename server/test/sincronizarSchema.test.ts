// Test de inventario/sincronizarSchema.ts — el puente Contenedor puro ->
// ContenedorSchema que faltaba (bug real detectado en la crítica adversarial
// de la fase 2 de inventario: sin esto, "coger" borraba del mundo pero el
// propio jugador nunca veía el ítem en su inventario replicado).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { sincronizarContenedor } from "../src/inventario/sincronizarSchema";
import { ContenedorSchema } from "../src/rooms/schema/HubState";
import { crearContenedor, agregarItem, CatalogoItems } from "../src/inventario/inventario";

const CATALOGO: CatalogoItems = {
  trebol: { tipo: "recurso", huella: [1, 1], peso: 0.15, apilable: true, stackMax: 5, variantes: 1, colorDebug: "#000" },
};

test("sincronizarContenedor: copia ancho/alto y cada instancia al Schema (el Schema nace en 0/0, hay que dimensionarlo explícitamente)", () => {
  const puro = crearContenedor(8, 6);
  agregarItem(puro, CATALOGO, "trebol", 3);
  const schema = new ContenedorSchema();
  assert.strictEqual(schema.ancho, 0);
  assert.strictEqual(schema.alto, 0);

  sincronizarContenedor(schema, puro);

  assert.strictEqual(schema.ancho, 8);
  assert.strictEqual(schema.alto, 6);
  assert.strictEqual(schema.items.length, 1);
  assert.strictEqual(schema.items[0].itemId, "trebol");
  assert.strictEqual(schema.items[0].cantidad, 3);
  assert.strictEqual(schema.items[0].id, puro.items[0].id);
});

test("sincronizarContenedor: reconstruye entero (clear+push) — una segunda llamada refleja el estado ACTUAL, no acumula lo viejo", () => {
  const puro = crearContenedor(4, 4);
  agregarItem(puro, CATALOGO, "trebol", 1);
  const schema = new ContenedorSchema();
  sincronizarContenedor(schema, puro);
  assert.strictEqual(schema.items.length, 1);

  puro.items = []; // simula un quitarItem que vació el contenedor
  sincronizarContenedor(schema, puro);
  assert.strictEqual(schema.items.length, 0, "no debe quedar ningún ItemInstanciaSchema fantasma de la sincronización anterior");
});
