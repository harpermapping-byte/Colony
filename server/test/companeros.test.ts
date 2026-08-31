// Tests de personaje/companeros.ts (docs/GDD_Companeros.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  probabilidadReclutar, intentarPersuadir, costeReclutar,
  UMBRALES_NIVEL_COMPANERO, nivelCompanero, bonusAtaquePorNivelCompanero, bonusDefensaPorNivelCompanero,
  hambreInicial, resolverHambreCompanero, UMBRAL_HAMBRE_COME_SOLO, HORAS_PARA_HAMBRE_TOTAL, DRENAJE_VIDA_POR_HAMBRE_POR_HORA,
} from "../src/personaje/companeros";

const rndSiempreSi = () => 0;
const rndSiempreNo = () => 0.999999;

test("probabilidadReclutar: sube con el nivel de carisma, nunca garantizada del todo (tope 90%)", () => {
  assert.strictEqual(probabilidadReclutar(1), 0.3);
  assert.ok(probabilidadReclutar(10) > probabilidadReclutar(1));
  assert.strictEqual(probabilidadReclutar(10), 0.9);
  assert.strictEqual(probabilidadReclutar(20), 0.9); // nunca pasa del tope
});

test("intentarPersuadir: respeta el rnd inyectado", () => {
  assert.strictEqual(intentarPersuadir(5, rndSiempreSi), true);
  assert.strictEqual(intentarPersuadir(5, rndSiempreNo), false);
});

test("costeReclutar: determinista por NPC (mismo slot siempre el mismo coste)", () => {
  const c1 = costeReclutar("aldea_norte_slot_3");
  const c2 = costeReclutar("aldea_norte_slot_3");
  assert.strictEqual(c1, c2);
  assert.ok(c1 >= 40 && c1 <= 160);
});

test("costeReclutar: NPCs distintos, coste distinto (\"cada recluta sea diferente\")", () => {
  const costes = new Set([
    costeReclutar("slot_a"), costeReclutar("slot_b"), costeReclutar("slot_c"),
    costeReclutar("slot_d"), costeReclutar("slot_e"),
  ]);
  assert.ok(costes.size > 1, "5 NPCs distintos no deberían costar TODOS lo mismo");
});

test("nivelCompanero: MISMA curva de umbrales 1-10 que los atributos de jugador", () => {
  assert.strictEqual(UMBRALES_NIVEL_COMPANERO.length, 10);
  assert.strictEqual(nivelCompanero(0), 1);
  assert.strictEqual(nivelCompanero(99), 1);
  assert.strictEqual(nivelCompanero(100), 2);
  assert.strictEqual(nivelCompanero(4500), 10);
  assert.strictEqual(nivelCompanero(999999), 10, "se queda en el nivel máximo, no explota");
});

test("bonus por nivel: modesto y coherente — nivel 1 sin bonus, tope nivel 10", () => {
  assert.strictEqual(bonusAtaquePorNivelCompanero(1), 0);
  assert.strictEqual(bonusAtaquePorNivelCompanero(10), 9);
  assert.strictEqual(bonusDefensaPorNivelCompanero(1), 0);
  assert.strictEqual(bonusDefensaPorNivelCompanero(10), 4.5);
});

test("resolverHambreCompanero: sube con el tiempo, come sola si tiene comida en su inventario", () => {
  const estado = hambreInicial();
  assert.strictEqual(estado.hambre, 0);
  let comida = true;
  let comida_consumida = false;
  const msg = resolverHambreCompanero(
    estado, HORAS_PARA_HAMBRE_TOTAL * (UMBRAL_HAMBRE_COME_SOLO / 100), { vida: 100 },
    () => comida, () => { comida_consumida = true; },
  );
  assert.strictEqual(msg, null);
  assert.strictEqual(estado.hambre, 0, "se comió sola y el contador se resetea");
  assert.strictEqual(comida_consumida, true);
});

test("resolverHambreCompanero: sin comida y hambre TOTAL, drena vida y avisa", () => {
  const estado = hambreInicial();
  const jugador = { vida: 100 };
  const msg = resolverHambreCompanero(estado, HORAS_PARA_HAMBRE_TOTAL * 2, jugador, () => false, () => {});
  assert.strictEqual(estado.hambre, 100);
  assert.ok(msg && msg.length > 0, "avisa de que se muere de hambre");
  assert.strictEqual(jugador.vida, 100 - DRENAJE_VIDA_POR_HAMBRE_POR_HORA * (HORAS_PARA_HAMBRE_TOTAL * 2));
});

test("resolverHambreCompanero: hambre parcial (no llega a come-sola ni a total) no hace nada más que subir el contador", () => {
  const estado = hambreInicial();
  const jugador = { vida: 100 };
  const msg = resolverHambreCompanero(estado, 1, jugador, () => false, () => {});
  assert.strictEqual(msg, null);
  assert.strictEqual(jugador.vida, 100);
  assert.ok(estado.hambre > 0 && estado.hambre < UMBRAL_HAMBRE_COME_SOLO);
});

test("resolverHambreCompanero: horasTranscurridas<=0 no hace nada", () => {
  const estado = hambreInicial();
  const jugador = { vida: 100 };
  const msg = resolverHambreCompanero(estado, 0, jugador, () => true, () => {});
  assert.strictEqual(msg, null);
  assert.strictEqual(estado.hambre, 0);
  assert.strictEqual(jugador.vida, 100);
});
