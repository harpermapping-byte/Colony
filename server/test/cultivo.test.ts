// Tests de cultivo/cultivo.ts (docs/GDD_Agricultura.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  nivelAgua,
  nivelFertilizante,
  puedeSembrarEnMes,
  listaParaCosechar,
  resolverCosecha,
  mezclarRasgos,
  derivarCrecimientoHibrido,
  nombreHibrido,
  nombreLegible,
  mezclarColor,
  VARIACION_INJERTO,
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

// --- Injertos (docs/Backlog_Mecanicas_Futuras.md, diseño ya cerrado) ---

test("mezclarRasgos: sin variación (azar=0.5, sin desvío), cada rasgo es la media exacta de los dos padres", () => {
  const a = { rendimiento: 0.6, calidad: 0.4, resistenciaEnfermedad: 0.8, velocidadCrecimiento: 0.2, necesidadAgua: 0.5, tamanoFruto: 0.6 };
  const b = { rendimiento: 0.2, calidad: 0.8, resistenciaEnfermedad: 0.4, velocidadCrecimiento: 0.6, necesidadAgua: 0.5, tamanoFruto: 0.2 };
  const r = mezclarRasgos(a, b, () => 0.5); // (azar*2-1)=0 -> sin variación
  const redondeado = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  assert.deepStrictEqual(redondeado, { rendimiento: 0.4, calidad: 0.6, resistenciaEnfermedad: 0.6, velocidadCrecimiento: 0.4, necesidadAgua: 0.5, tamanoFruto: 0.4 });
});

test("mezclarRasgos: la variación nunca se sale de [0,1] ni con padres en los extremos", () => {
  const a = { rendimiento: 1, calidad: 1, resistenciaEnfermedad: 1, velocidadCrecimiento: 1, necesidadAgua: 1, tamanoFruto: 1 };
  const b = { rendimiento: 1, calidad: 1, resistenciaEnfermedad: 1, velocidadCrecimiento: 1, necesidadAgua: 1, tamanoFruto: 1 };
  const rMax = mezclarRasgos(a, b, () => 1); // variación máxima hacia arriba
  for (const v of Object.values(rMax)) assert.ok(v <= 1 && v >= 0);
  const rMin = mezclarRasgos({ ...a, rendimiento: 0 }, { ...b, rendimiento: 0 }, () => 0); // variación máxima hacia abajo
  assert.ok(rMin.rendimiento >= 0);
});

test("mezclarRasgos: el rango de variación es exactamente ±VARIACION_INJERTO", () => {
  const a = { rendimiento: 0.5, calidad: 0.5, resistenciaEnfermedad: 0.5, velocidadCrecimiento: 0.5, necesidadAgua: 0.5, tamanoFruto: 0.5 };
  const r = mezclarRasgos(a, a, () => 1); // media=0.5, variación=+VARIACION_INJERTO
  assert.ok(Math.abs(r.rendimiento - (0.5 + VARIACION_INJERTO)) < 1e-9);
});

test("derivarCrecimientoHibrido: mesesSiembra es la unión sin duplicados de ambos padres, ordenada", () => {
  const a = { diasCrecimiento: 4, mesesSiembra: [3, 5], cosechaRecurrente: false, cantidadPorCosecha: 2 };
  const b = { diasCrecimiento: 4, mesesSiembra: [4, 5, 9], cosechaRecurrente: false, cantidadPorCosecha: 2 };
  const rasgos = { rendimiento: 0.5, calidad: 0.5, resistenciaEnfermedad: 0.5, velocidadCrecimiento: 0.5, necesidadAgua: 0.5, tamanoFruto: 0.5 };
  const d = derivarCrecimientoHibrido(a, b, rasgos);
  assert.deepStrictEqual(d.mesesSiembra, [3, 4, 5, 9]);
});

test("derivarCrecimientoHibrido: cosechaRecurrente si CUALQUIERA de los dos padres lo es", () => {
  const base = { diasCrecimiento: 4, mesesSiembra: [3], cantidadPorCosecha: 2 };
  const rasgos = { rendimiento: 0.5, calidad: 0.5, resistenciaEnfermedad: 0.5, velocidadCrecimiento: 0.5, necesidadAgua: 0.5, tamanoFruto: 0.5 };
  assert.strictEqual(derivarCrecimientoHibrido({ ...base, cosechaRecurrente: true }, { ...base, cosechaRecurrente: false }, rasgos).cosechaRecurrente, true);
  assert.strictEqual(derivarCrecimientoHibrido({ ...base, cosechaRecurrente: false }, { ...base, cosechaRecurrente: false }, rasgos).cosechaRecurrente, false);
});

test("derivarCrecimientoHibrido: más velocidadCrecimiento acorta diasCrecimiento", () => {
  const a = { diasCrecimiento: 10, mesesSiembra: [3], cosechaRecurrente: false, cantidadPorCosecha: 2 };
  const rasgosLento = { rendimiento: 0.5, calidad: 0.5, resistenciaEnfermedad: 0.5, velocidadCrecimiento: 0, necesidadAgua: 0.5, tamanoFruto: 0.5 };
  const rasgosRapido = { ...rasgosLento, velocidadCrecimiento: 1 };
  const dLento = derivarCrecimientoHibrido(a, a, rasgosLento);
  const dRapido = derivarCrecimientoHibrido(a, a, rasgosRapido);
  assert.ok(dRapido.diasCrecimiento < dLento.diasCrecimiento);
});

test("derivarCrecimientoHibrido: más rendimiento sube cantidadPorCosecha", () => {
  const a = { diasCrecimiento: 4, mesesSiembra: [3], cosechaRecurrente: false, cantidadPorCosecha: 4 };
  const rasgosBajo = { rendimiento: 0, calidad: 0.5, resistenciaEnfermedad: 0.5, velocidadCrecimiento: 0.5, necesidadAgua: 0.5, tamanoFruto: 0.5 };
  const rasgosAlto = { ...rasgosBajo, rendimiento: 1 };
  assert.ok(derivarCrecimientoHibrido(a, a, rasgosAlto).cantidadPorCosecha > derivarCrecimientoHibrido(a, a, rasgosBajo).cantidadPorCosecha);
});

test("nombreHibrido: formato 'Híbrido A×B'", () => {
  assert.strictEqual(nombreHibrido("Tomate", "Fresa"), "Híbrido Tomate×Fresa");
});

test("nombreLegible: quita guiones bajos y capitaliza cada palabra", () => {
  assert.strictEqual(nombreLegible("semilla_tomate"), "Semilla Tomate");
});

test("mezclarColor: mezcla blanco y negro da gris medio", () => {
  assert.strictEqual(mezclarColor("#ffffff", "#000000"), "#808080");
});

test("mezclarColor: mezclar un color consigo mismo lo deja igual", () => {
  assert.strictEqual(mezclarColor("#c9402a", "#c9402a"), "#c9402a");
});
