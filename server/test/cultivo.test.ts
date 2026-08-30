// Tests de cultivo/cultivo.ts (docs/GDD_Agricultura.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  nivelAgua,
  nivelFertilizante,
  puedeSembrarEnMes,
  listaParaCosechar,
  resolverCosecha,
  DECAIMIENTO_AGUA_POR_DIA,
  DECAIMIENTO_FERTILIZANTE_POR_DIA,
} from "../src/cultivo/cultivo";

test("nivelAgua: nunca regada = 0", () => {
  assert.strictEqual(nivelAgua({}, 10), 0);
});

test("nivelAgua: recién regada = 100, decae con los días, nunca baja de 0", () => {
  assert.strictEqual(nivelAgua({ diaUltimoRiego: 5 }, 5), 100);
  assert.strictEqual(nivelAgua({ diaUltimoRiego: 5 }, 6), 100 - DECAIMIENTO_AGUA_POR_DIA);
  assert.strictEqual(nivelAgua({ diaUltimoRiego: 5 }, 100), 0);
});

test("nivelFertilizante: decae más despacio que el agua", () => {
  assert.strictEqual(nivelFertilizante({ diaUltimoAbono: 5 }, 6), 100 - DECAIMIENTO_FERTILIZANTE_POR_DIA);
  assert.ok(DECAIMIENTO_FERTILIZANTE_POR_DIA < DECAIMIENTO_AGUA_POR_DIA);
});

test("puedeSembrarEnMes: solo dentro de los meses declarados por la semilla", () => {
  assert.strictEqual(puedeSembrarEnMes([3, 4, 5], 4), true);
  assert.strictEqual(puedeSembrarEnMes([3, 4, 5], 6), false);
});

test("listaParaCosechar: falso si no está plantada", () => {
  assert.strictEqual(listaParaCosechar({}, 5, 10), false);
});

test("listaParaCosechar: falso si aún no ha pasado diasCrecimiento", () => {
  const estado = { semillaId: "semilla_trigo", diaPlantado: 10, diaUltimoRiego: 10 };
  assert.strictEqual(listaParaCosechar(estado, 5, 12), false);
});

test("listaParaCosechar: falso si el agua llegó a 0 aunque ya tocaría cosecha", () => {
  const estado = { semillaId: "semilla_trigo", diaPlantado: 0, diaUltimoRiego: 0 };
  assert.strictEqual(listaParaCosechar(estado, 5, 100), false); // agua a 0 hace tiempo
});

test("listaParaCosechar: true con tiempo cumplido y agua > 0", () => {
  const estado = { semillaId: "semilla_trigo", diaPlantado: 0, diaUltimoRiego: 5 };
  assert.strictEqual(listaParaCosechar(estado, 5, 5), true);
});

test("resolverCosecha: cantidad base × multiplicador de maceta, sin fertilizante", () => {
  const estado = { diaUltimoAbono: undefined };
  const r = resolverCosecha(estado, 2, false, 2, 10);
  assert.strictEqual(r.cantidad, 4);
  assert.strictEqual(r.siguePlantada, false);
});

test("resolverCosecha: +50% si el fertilizante está al 50% o más", () => {
  const estado = { diaUltimoAbono: 10 };
  const r = resolverCosecha(estado, 2, true, 1, 10); // fertilizante recién puesto = 100
  assert.strictEqual(r.cantidad, 3); // 2 * 1 * 1.5 = 3
  assert.strictEqual(r.siguePlantada, true);
});

test("resolverCosecha: sin bonus si el fertilizante bajó de 50", () => {
  const diasParaBajarDe50 = Math.ceil(51 / DECAIMIENTO_FERTILIZANTE_POR_DIA);
  const estado = { diaUltimoAbono: 0 };
  const r = resolverCosecha(estado, 2, false, 1, diasParaBajarDe50);
  assert.strictEqual(r.cantidad, 2);
});
