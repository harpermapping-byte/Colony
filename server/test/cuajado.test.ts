// Tests de construccion/cuajado.ts (docs/GDD_Cocina.md, cocina v2 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  estadoQueseraInicial, iniciarLoteQueso, loteQuesoListo, recolectarLoteQueso, resultadoLote,
  HORAS_MANTEQUILLA, HORAS_QUESO, LECHE_POR_LOTE,
} from "../src/construccion/cuajado";

test("estadoQueseraInicial: sin leche ni lote", () => {
  const e = estadoQueseraInicial();
  assert.strictEqual(e.stockLeche, 0);
  assert.strictEqual(e.lote, undefined);
});

test("iniciarLoteQueso: falla si no hay suficiente leche", () => {
  const e = { stockLeche: LECHE_POR_LOTE - 1 };
  assert.strictEqual(iniciarLoteQueso(e, false, Date.now()), null);
});

test("iniciarLoteQueso: falla si ya hay un lote en curso", () => {
  const e = { stockLeche: LECHE_POR_LOTE * 2, lote: { cantidadLeche: LECHE_POR_LOTE, conSal: false, iniciadoEn: 0 } };
  assert.strictEqual(iniciarLoteQueso(e, true, Date.now()), null);
});

test("iniciarLoteQueso: consume LECHE_POR_LOTE del stock, deja el lote marcado con conSal", () => {
  const e = { stockLeche: LECHE_POR_LOTE + 3 };
  const r = iniciarLoteQueso(e, true, 1000)!;
  assert.ok(r);
  assert.strictEqual(r.stockLeche, 3);
  assert.strictEqual(r.lote?.conSal, true);
  assert.strictEqual(r.lote?.iniciadoEn, 1000);
});

test("resultadoLote: con sal da queso, sin sal da mantequilla", () => {
  assert.strictEqual(resultadoLote({ cantidadLeche: LECHE_POR_LOTE, conSal: true, iniciadoEn: 0 }), "queso");
  assert.strictEqual(resultadoLote({ cantidadLeche: LECHE_POR_LOTE, conSal: false, iniciadoEn: 0 }), "mantequilla");
});

test("loteQuesoListo: mantequilla lista en HORAS_MANTEQUILLA, queso tarda más (HORAS_QUESO)", () => {
  const inicio = 1_000_000;
  const mantequilla = { stockLeche: 0, lote: { cantidadLeche: LECHE_POR_LOTE, conSal: false, iniciadoEn: inicio } };
  const queso = { stockLeche: 0, lote: { cantidadLeche: LECHE_POR_LOTE, conSal: true, iniciadoEn: inicio } };

  assert.strictEqual(loteQuesoListo(mantequilla, inicio + HORAS_MANTEQUILLA * 3_600_000 - 1), false);
  assert.strictEqual(loteQuesoListo(mantequilla, inicio + HORAS_MANTEQUILLA * 3_600_000), true);

  assert.strictEqual(loteQuesoListo(queso, inicio + HORAS_MANTEQUILLA * 3_600_000), false, "el queso tarda más que la mantequilla");
  assert.strictEqual(loteQuesoListo(queso, inicio + HORAS_QUESO * 3_600_000), true);
});

test("loteQuesoListo: false si no hay ningún lote", () => {
  assert.strictEqual(loteQuesoListo(estadoQueseraInicial(), Date.now()), false);
});

test("recolectarLoteQueso: null si el lote no está listo todavía", () => {
  const e = { stockLeche: 0, lote: { cantidadLeche: LECHE_POR_LOTE, conSal: false, iniciadoEn: 1000 } };
  assert.strictEqual(recolectarLoteQueso(e, 1000), null);
});

test("recolectarLoteQueso: entrega el itemId correcto y deja el mueble sin lote, con el stock de leche intacto", () => {
  const e = { stockLeche: 5, lote: { cantidadLeche: LECHE_POR_LOTE, conSal: true, iniciadoEn: 0 } };
  const r = recolectarLoteQueso(e, HORAS_QUESO * 3_600_000)!;
  assert.ok(r);
  assert.strictEqual(r.itemId, "queso");
  assert.strictEqual(r.estado.stockLeche, 5);
  assert.strictEqual(r.estado.lote, undefined);
});
