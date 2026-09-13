import { test } from "node:test";
import assert from "node:assert/strict";
import { xpProgresoTexto } from "../src/construccion/panelCrafteo";

// Auditoría de interacciones 2026-09-13: `oficio:estado`/`crafteo:completado`
// ya traían xp/nivel reales pero el panel nunca mostraba cuánto faltaba
// para el siguiente nivel — solo detectaba el SALTO (toast). Estos tests
// fijan la curva portada de `server/src/progresion/nivel.ts::generarUmbrales(10,90)`
// para que un cambio en el servidor sin replicar aquí se note enseguida.

test("xpProgresoTexto: null sin datos reales todavía (oficio:estado aún no llegó)", () => {
  assert.equal(xpProgresoTexto(undefined, 1), null);
  assert.equal(xpProgresoTexto(50, null), null);
});

test("xpProgresoTexto: nivel 1 muestra el umbral real del nivel 2 (90 XP)", () => {
  assert.equal(xpProgresoTexto(0, 1), "0/90 XP");
  assert.equal(xpProgresoTexto(45, 1), "45/90 XP");
});

test("xpProgresoTexto: umbrales intermedios coinciden con generarUmbrales(10,90)", () => {
  assert.equal(xpProgresoTexto(300, 3), "300/540 XP");
  assert.equal(xpProgresoTexto(1000, 5), "1000/1350 XP");
  assert.equal(xpProgresoTexto(1500, 6), "1500/1890 XP");
});

test("xpProgresoTexto: nivel 9, el último umbral real, es 4050 (el mismo que documenta nivel.ts)", () => {
  assert.equal(xpProgresoTexto(3500, 9), "3500/4050 XP");
});

test("xpProgresoTexto: nivel máximo (10) no promete un umbral siguiente inexistente", () => {
  assert.equal(xpProgresoTexto(4050, 10), "4050 XP (nivel máximo)");
  assert.equal(xpProgresoTexto(9999, 10), "9999 XP (nivel máximo)");
});
