// Tests de la lógica PURA de crafteo final (server/src/construccion/crafteo.ts,
// docs/GDD_Crafteo.md §5-6). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { nivelDeXp, validarCrafteo, crafteoListo, RecetaCrafteo } from "../src/construccion/crafteo";

test("nivelDeXp: sin XP es nivel 1", () => {
  assert.strictEqual(nivelDeXp(0), 1);
});

test("nivelDeXp: sube según los umbrales, nunca de golpe a un nivel que no toca", () => {
  assert.strictEqual(nivelDeXp(89), 1);
  assert.strictEqual(nivelDeXp(90), 2);
  assert.strictEqual(nivelDeXp(269), 2);
  assert.strictEqual(nivelDeXp(270), 3);
  assert.strictEqual(nivelDeXp(999999), 10, "se queda en el nivel máximo de la tabla, no explota");
});

const RECETA: RecetaCrafteo = {
  id: "lingote_hierro_basico",
  oficio: "herrero",
  mesas: ["fundicion_hierro"],
  nivelMinimo: 2,
  insumos: [{ itemId: "hierro", cantidad: 2 }],
  resultado: { itemId: "lingote_hierro", cantidad: 1 },
  tiempoBaseSeg: 10,
};

test("validarCrafteo: mesa incorrecta se rechaza", () => {
  const r = validarCrafteo(RECETA, "yunque", 500, [{ itemId: "hierro", cantidad: 10 }]);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "esta no es la mesa correcta para esta receta");
});

test("validarCrafteo: nivel insuficiente se rechaza", () => {
  const r = validarCrafteo(RECETA, "fundicion_hierro", 0, [{ itemId: "hierro", cantidad: 10 }]);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "nivel de oficio insuficiente");
});

test("validarCrafteo: insumos insuficientes en el inventario se rechaza", () => {
  const r = validarCrafteo(RECETA, "fundicion_hierro", 500, [{ itemId: "hierro", cantidad: 1 }]);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "te falta hierro");
});

test("validarCrafteo: mesa correcta + nivel + insumos, aceptado", () => {
  const r = validarCrafteo(RECETA, "fundicion_hierro", 500, [{ itemId: "hierro", cantidad: 5 }]);
  assert.strictEqual(r.ok, true);
});

test("validarCrafteo: sin el insumo en el inventario en absoluto (no solo escaso), rechazado igual", () => {
  const r = validarCrafteo(RECETA, "fundicion_hierro", 500, []);
  assert.strictEqual(r.ok, false);
});

test("crafteoListo: false antes de terminaEn, true en/después", () => {
  const estado = { recetaId: "x", terminaEn: 1000 };
  assert.strictEqual(crafteoListo(estado, 999), false);
  assert.strictEqual(crafteoListo(estado, 1000), true);
  assert.strictEqual(crafteoListo(estado, 5000), true);
});
