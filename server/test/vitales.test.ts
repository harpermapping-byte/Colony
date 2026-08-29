// Tests de la lógica PURA de vitales (server/src/personaje/vitales.ts,
// docs/GDD_Personaje.md). Ejecutar: npm test (tsx --test) desde server/.
// NO cubre "vida" — vive en Player.vida/vidaMax (docs/GDD_Mecanicas.md §5.4,
// server/src/combate/combate.ts), ver server/test/combate.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
import { vitalesIniciales, tickVitales, restaurarVital, VITAL_MAX } from "../src/personaje/vitales";

test("vitalesIniciales: un jugador nuevo empieza lleno", () => {
  const v = vitalesIniciales();
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

test("tickVitales: horasTranscurridas<=0 no hace nada (sin efectos raros con dt=0)", () => {
  const v = vitalesIniciales();
  tickVitales(v, 0);
  assert.deepStrictEqual(v, vitalesIniciales());
});

test("restaurarVital: sube el vital indicado sin pasarse del tope", () => {
  const v = vitalesIniciales();
  v.comida = 30;
  restaurarVital(v, "comida", 40);
  assert.strictEqual(v.comida, 70);
  restaurarVital(v, "comida", 1000);
  assert.strictEqual(v.comida, VITAL_MAX);
});
