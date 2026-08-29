// Tests de twitch/catalogoEventos.ts (docs/GDD_Twitch.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { EVENTOS_MALOS, EVENTOS_BUENOS, elegirEventoAleatorio, cooldownCumplido, COOLDOWN_CANJE_MS } from "../src/twitch/catalogoEventos";

test("catálogo: 5 eventos malos, 4 buenos, ids únicos en cada pool (pedido literal 2026-08-30)", () => {
  assert.strictEqual(EVENTOS_MALOS.length, 5);
  assert.strictEqual(EVENTOS_BUENOS.length, 4);
  assert.strictEqual(new Set(EVENTOS_MALOS.map((e) => e.id)).size, 5);
  assert.strictEqual(new Set(EVENTOS_BUENOS.map((e) => e.id)).size, 4);
});

test("catálogo: los 9 eventos acordados están, ni uno de más ni de menos", () => {
  const ids = [...EVENTOS_MALOS, ...EVENTOS_BUENOS].map((e) => e.id).sort();
  assert.deepStrictEqual(ids, [
    "bendicion_gremio", "corralito", "eclipse", "hay_que_trabajar",
    "lluvia_dinero", "mercado_oferta", "plaga_ratas", "terremoto", "tormenta_rayos",
  ].sort());
});

test("elegirEventoAleatorio: azar=0 elige el primero del pool, siempre del tipo pedido", () => {
  const malo = elegirEventoAleatorio("malo", () => 0);
  assert.strictEqual(malo.id, EVENTOS_MALOS[0].id);
  assert.strictEqual(malo.tipo, "malo");
  const bueno = elegirEventoAleatorio("bueno", () => 0);
  assert.strictEqual(bueno.id, EVENTOS_BUENOS[0].id);
  assert.strictEqual(bueno.tipo, "bueno");
});

test("elegirEventoAleatorio: azar cercano a 1 elige el último del pool (sin desbordar el array)", () => {
  const malo = elegirEventoAleatorio("malo", () => 0.999999);
  assert.strictEqual(malo.id, EVENTOS_MALOS[EVENTOS_MALOS.length - 1].id);
});

test("cooldownCumplido: nunca activado (null/undefined) siempre está listo", () => {
  assert.strictEqual(cooldownCumplido(null), true);
  assert.strictEqual(cooldownCumplido(undefined), true);
});

test("cooldownCumplido: justo antes de los 5 min no está listo, justo después sí", () => {
  const ultimo = 1_000_000;
  assert.strictEqual(cooldownCumplido(ultimo, ultimo + COOLDOWN_CANJE_MS - 1), false);
  assert.strictEqual(cooldownCumplido(ultimo, ultimo + COOLDOWN_CANJE_MS), true);
});
