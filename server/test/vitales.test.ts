// Tests de la lógica PURA de vitales (server/src/personaje/vitales.ts,
// docs/GDD_Personaje.md). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { vitalesIniciales, tickVitales, restaurarVital, VITAL_MAX } from "../src/personaje/vitales";

test("vitalesIniciales: un jugador nuevo empieza lleno", () => {
  const v = vitalesIniciales();
  assert.strictEqual(v.vida, VITAL_MAX);
  assert.strictEqual(v.comida, VITAL_MAX);
  assert.strictEqual(v.bebida, VITAL_MAX);
  assert.strictEqual(v.sueno, VITAL_MAX);
  assert.strictEqual(v.estamina, VITAL_MAX);
});

test("tickVitales: comida/bebida/sueño decaen con las horas transcurridas, nunca bajan de 0", () => {
  const v = vitalesIniciales();
  tickVitales(v, 16); // exactamente la vida media de comida (100/16 por hora)
  assert.ok(Math.abs(v.comida - 0) < 1e-6, `comida debería quedar en ~0, quedó en ${v.comida}`);
  tickVitales(v, 1000); // horas de más — no debe irse a negativo
  assert.strictEqual(v.comida, 0);
  assert.strictEqual(v.bebida, 0);
  assert.strictEqual(v.sueno, 0);
});

test("tickVitales: estamina se regenera sola hasta el máximo (nada la gasta todavía)", () => {
  const v = vitalesIniciales();
  v.estamina = 50;
  tickVitales(v, 0.5); // regenera 50/1h * 0.5h = 25
  assert.ok(v.estamina > 50 && v.estamina <= VITAL_MAX);
  tickVitales(v, 100);
  assert.strictEqual(v.estamina, VITAL_MAX);
});

test("tickVitales: vida NO drena mientras ningún vital básico esté en 0", () => {
  const v = vitalesIniciales();
  tickVitales(v, 5); // ninguno llega a 0 todavía
  assert.strictEqual(v.vida, VITAL_MAX);
});

test("tickVitales: vida drena cuando un vital básico llega a 0, se detiene en el propio 0 de vida", () => {
  const v = vitalesIniciales();
  tickVitales(v, 10000); // todos los básicos a 0 de sobra
  assert.ok(v.vida < VITAL_MAX, "la vida debe haber empezado a drenar");
  const vidaTrasMucho = v.vida;
  tickVitales(v, 100000); // muchísimo más — debe clampar en 0, no ir a negativo
  assert.strictEqual(v.vida, 0);
  assert.ok(vidaTrasMucho >= 0);
});

test("tickVitales: tres vitales en 0 a la vez drenan el TRIPLE de vida por hora que uno solo", () => {
  const soloUno = vitalesIniciales();
  soloUno.comida = 0;
  tickVitales(soloUno, 1);
  const perdidaUno = VITAL_MAX - soloUno.vida;

  const tresACero = vitalesIniciales();
  tresACero.comida = 0;
  tresACero.bebida = 0;
  tresACero.sueno = 0;
  tickVitales(tresACero, 1);
  const perdidaTres = VITAL_MAX - tresACero.vida;

  assert.ok(Math.abs(perdidaTres - perdidaUno * 3) < 1e-9, `esperaba ${perdidaUno * 3}, fue ${perdidaTres}`);
});

test("restaurarVital: sube el vital indicado sin pasarse del tope", () => {
  const v = vitalesIniciales();
  v.comida = 30;
  restaurarVital(v, "comida", 40);
  assert.strictEqual(v.comida, 70);
  restaurarVital(v, "comida", 1000);
  assert.strictEqual(v.comida, VITAL_MAX);
});

test("restaurarVital: vida respeta vidaMax, no VITAL_MAX, si difieren", () => {
  const v = vitalesIniciales();
  v.vida = 10;
  v.vidaMax = 50; // hipotético vidaMax distinto de VITAL_MAX
  restaurarVital(v, "vida", 1000);
  assert.strictEqual(v.vida, 50);
});
