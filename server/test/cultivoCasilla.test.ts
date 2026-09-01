// Tests de mundo/cultivoCasilla.ts (docs/GDD_Carros.md §9, propuesta 2026-09-04 —
// agricultura por casilla, en paralelo a la de construcción de cultivo.ts).
import { test } from "node:test";
import * as assert from "node:assert";
import { labrar, plantar, listaParaCosechar, cosechar, EstadoCasillaCultivo } from "../src/mundo/cultivoCasilla";

test("labrar: casilla vacía (undefined) da 'labrada' del dueño que labra", () => {
  const r = labrar(undefined, 7);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.valor, { estado: "labrada", duenoId: 7 });
});

test("labrar: casilla ya labrada/sembrada se rechaza", () => {
  const yaLabrada: EstadoCasillaCultivo = { estado: "labrada", duenoId: 7 };
  assert.strictEqual(labrar(yaLabrada, 7).ok, false);
  assert.strictEqual(labrar(yaLabrada, 7).motivo, "ya_labrada");
  const sembrada: EstadoCasillaCultivo = { estado: "sembrada", duenoId: 7, semillaId: "semilla_trigo", diaPlantado: 1 };
  assert.strictEqual(labrar(sembrada, 7).ok, false);
});

test("plantar: sin labrar (undefined) se rechaza", () => {
  const r = plantar(undefined, "semilla_trigo", 7, 10);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_labrar");
});

test("plantar: casilla labrada de OTRO dueño se rechaza", () => {
  const casilla: EstadoCasillaCultivo = { estado: "labrada", duenoId: 7 };
  const r = plantar(casilla, "semilla_trigo", 99, 10);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "no_es_tuya");
});

test("plantar: casilla ya sembrada se rechaza (hay que cosechar primero)", () => {
  const casilla: EstadoCasillaCultivo = { estado: "sembrada", duenoId: 7, semillaId: "semilla_trigo", diaPlantado: 1 };
  const r = plantar(casilla, "semilla_maiz", 7, 10);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "ya_sembrada");
});

test("plantar: casilla labrada propia -> sembrada con el día actual", () => {
  const casilla: EstadoCasillaCultivo = { estado: "labrada", duenoId: 7 };
  const r = plantar(casilla, "semilla_trigo", 7, 10);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.valor, { estado: "sembrada", duenoId: 7, semillaId: "semilla_trigo", diaPlantado: 10 });
});

test("listaParaCosechar: false si no está sembrada, o si no ha pasado el tiempo, true justo al cumplirse", () => {
  assert.strictEqual(listaParaCosechar(undefined, 3, 10), false);
  const labrada: EstadoCasillaCultivo = { estado: "labrada", duenoId: 7 };
  assert.strictEqual(listaParaCosechar(labrada, 3, 10), false);
  const sembradaDia5 = (dia: number): EstadoCasillaCultivo => ({ estado: "sembrada", duenoId: 7, semillaId: "s", diaPlantado: dia });
  assert.strictEqual(listaParaCosechar(sembradaDia5(5), 3, 7), false); // 2 días, faltan 1
  assert.strictEqual(listaParaCosechar(sembradaDia5(5), 3, 8), true); // exactamente 3 días
  assert.strictEqual(listaParaCosechar(sembradaDia5(5), 3, 12), true); // de sobra
});

test("cosechar: no recurrente vuelve a 'labrada' vacía (sin re-arar, solo re-plantar)", () => {
  const casilla: EstadoCasillaCultivo = { estado: "sembrada", duenoId: 7, semillaId: "semilla_trigo", diaPlantado: 5 };
  const r = cosechar(casilla, 4, false, 12);
  assert.strictEqual(r.cantidad, 4);
  assert.deepStrictEqual(r.siguienteCasilla, { estado: "labrada", duenoId: 7 });
});

test("cosechar: recurrente sigue 'sembrada' con la MISMA semilla y el ciclo reiniciado al día actual", () => {
  const casilla: EstadoCasillaCultivo = { estado: "sembrada", duenoId: 7, semillaId: "semilla_frambuesa", diaPlantado: 5 };
  const r = cosechar(casilla, 6, true, 12);
  assert.strictEqual(r.cantidad, 6);
  assert.deepStrictEqual(r.siguienteCasilla, { estado: "sembrada", duenoId: 7, semillaId: "semilla_frambuesa", diaPlantado: 12 });
  // un segundo ciclo desde ahí no está listo hasta que pasen otros diasCrecimiento días
  assert.strictEqual(listaParaCosechar(r.siguienteCasilla, 5, 15), false);
  assert.strictEqual(listaParaCosechar(r.siguienteCasilla, 5, 17), true);
});
