// Tests de cocina/cocina.ts (docs/GDD_Cocina.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import { cocinarSimple, cocinarPlato, clavePlato, nombrePlato, UNIDADES_POR_PLATO, BONUS_MEZCLA, BOOST_COCINA_SIMPLE, type IngredienteCocina } from "../src/cocina/cocina";

test("cocinarSimple: sube comida por el boost, redondeando hacia arriba", () => {
  const r = cocinarSimple({ comida: 6 });
  assert.strictEqual(r.comida, Math.ceil(6 * BOOST_COCINA_SIMPLE));
});

test("cocinarSimple: solo boostea los ejes presentes, el resto queda undefined", () => {
  const r = cocinarSimple({ vida: 4, comida: 8 });
  assert.strictEqual(r.vida, Math.ceil(4 * BOOST_COCINA_SIMPLE));
  assert.strictEqual(r.estamina, undefined);
  assert.strictEqual(r.bebida, undefined);
});

const ZANAHORIA: IngredienteCocina = { itemId: "zanahoria", cantidad: 2, aportes: { vida: 3, comida: 6 }, origen: "vegetal" };
const CARNE: IngredienteCocina = { itemId: "carne_roja", cantidad: 2, aportes: { vida: 6, estamina: 1, comida: 10 }, origen: "animal" };
const TOMATE: IngredienteCocina = { itemId: "tomate", cantidad: 2, aportes: { vida: 2, bebida: 3, comida: 6 }, origen: "vegetal" };

test("cocinarPlato: raciones = unidades totales / UNIDADES_POR_PLATO, redondeo hacia abajo", () => {
  const r = cocinarPlato([{ ...ZANAHORIA, cantidad: 5 }]);
  assert.strictEqual(r.platos, Math.floor(5 / UNIDADES_POR_PLATO));
});

test("cocinarPlato: como mínimo 1 ración si hay algo, aunque sea poco", () => {
  const r = cocinarPlato([{ ...ZANAHORIA, cantidad: 1 }]);
  assert.strictEqual(r.platos, 1);
});

test("cocinarPlato: sin bonus de mezcla, un solo ingrediente = sus propios aportes tal cual", () => {
  const r = cocinarPlato([ZANAHORIA]);
  assert.strictEqual(r.mezclaBonus, false);
  assert.strictEqual(r.vida, 3);
  assert.strictEqual(r.comida, 6);
});

test("cocinarPlato: sin bonus de mezcla, dos vegetales = media simple de cada eje", () => {
  const r = cocinarPlato([ZANAHORIA, TOMATE]);
  assert.strictEqual(r.mezclaBonus, false);
  assert.strictEqual(r.vida, Math.round((3 + 2) / 2));
  assert.strictEqual(r.bebida, Math.round((0 + 3) / 2));
});

test("cocinarPlato: bonus de mezcla SOLO si hay vegetal Y animal a la vez", () => {
  const soloVegetal = cocinarPlato([ZANAHORIA, TOMATE]);
  const conCarne = cocinarPlato([ZANAHORIA, CARNE]);
  assert.strictEqual(soloVegetal.mezclaBonus, false);
  assert.strictEqual(conCarne.mezclaBonus, true);
  assert.strictEqual(conCarne.vida, Math.round(((3 + 6) / 2) * BONUS_MEZCLA));
});

test("cocinarPlato: la cantidad de cada ingrediente NO afecta la calidad del plato, solo las raciones", () => {
  const pocaCantidad = cocinarPlato([{ ...ZANAHORIA, cantidad: 2 }, { ...CARNE, cantidad: 2 }]);
  const muchaCantidad = cocinarPlato([{ ...ZANAHORIA, cantidad: 20 }, { ...CARNE, cantidad: 20 }]);
  assert.strictEqual(pocaCantidad.vida, muchaCantidad.vida);
  assert.strictEqual(pocaCantidad.comida, muchaCantidad.comida);
  assert.ok(muchaCantidad.platos > pocaCantidad.platos);
});

test("cocinarPlato: comida nunca baja de 1", () => {
  const r = cocinarPlato([{ itemId: "algo", cantidad: 2, aportes: { comida: 0 }, origen: "vegetal" }]);
  assert.strictEqual(r.comida, 1);
});

test("clavePlato: mismo conjunto de ingredientes = misma clave, sin importar el orden", () => {
  assert.strictEqual(clavePlato(["carne_roja", "zanahoria"]), clavePlato(["zanahoria", "carne_roja"]));
});

test("clavePlato: ingredientes repetidos no cambian la clave (identidad por tipo, no por cantidad)", () => {
  assert.strictEqual(clavePlato(["zanahoria", "zanahoria", "carne_roja"]), clavePlato(["zanahoria", "carne_roja"]));
});

test("clavePlato: conjuntos distintos dan claves distintas", () => {
  assert.notStrictEqual(clavePlato(["zanahoria"]), clavePlato(["zanahoria", "tomate"]));
});

test("nombrePlato: la vasija decide la palabra (Sopa/Guiso/Estofado)", () => {
  assert.strictEqual(nombrePlato("cuenco", ["zanahoria"]), "Sopa de Zanahoria");
  assert.strictEqual(nombrePlato("cazuela", ["zanahoria"]), "Guiso de Zanahoria");
  assert.strictEqual(nombrePlato("olla", ["zanahoria"]), "Estofado de Zanahoria");
});

test("nombrePlato: dos ingredientes se unen con 'y'", () => {
  assert.strictEqual(nombrePlato("cazuela", ["zanahoria", "carne_roja"]), "Guiso de Zanahoria y Carne Roja");
});

test("nombrePlato: tres o más ingredientes se listan con comas y 'y' antes del último", () => {
  assert.strictEqual(nombrePlato("olla", ["zanahoria", "carne_roja", "tomate"]), "Estofado de Zanahoria, Carne Roja y Tomate");
});
