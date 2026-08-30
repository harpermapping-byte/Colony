// Tests de cocina/cocina.ts (docs/GDD_Cocina.md, pedido 2026-08-30, ampliado "cocina v2" el mismo día).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  cocinarSimple, cocinarPlato, clavePlato, nombrePlato, estaHirviendo, segundosParaHervir,
  UNIDADES_POR_PLATO, BONUS_MEZCLA, BOOST_COCINA_SIMPLE, TIEMPO_HERVIR_MS, type IngredienteCocina,
  familiaDePlato, prefijoDe, aceptaEnVasija, aptoParaEnsalada, aportesDesdeRestaura,
} from "../src/cocina/cocina";

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
  assert.strictEqual(clavePlato("sopa", ["carne_roja", "zanahoria"]), clavePlato("sopa", ["zanahoria", "carne_roja"]));
});

test("clavePlato: ingredientes repetidos no cambian la clave (identidad por tipo, no por cantidad)", () => {
  assert.strictEqual(clavePlato("sopa", ["zanahoria", "zanahoria", "carne_roja"]), clavePlato("sopa", ["zanahoria", "carne_roja"]));
});

test("clavePlato: conjuntos distintos dan claves distintas", () => {
  assert.notStrictEqual(clavePlato("sopa", ["zanahoria"]), clavePlato("sopa", ["zanahoria", "tomate"]));
});

test("clavePlato: misma combinación de ingredientes en familias distintas da claves distintas (corrección 2026-08-30)", () => {
  assert.notStrictEqual(clavePlato("sopa", ["carne_roja"]), clavePlato("frito", ["carne_roja"]));
});

test("nombrePlato: usa el prefijo tal cual, ya resuelto por el llamador", () => {
  assert.strictEqual(nombrePlato("Sopa", ["zanahoria"]), "Sopa de Zanahoria");
  assert.strictEqual(nombrePlato("Guiso", ["zanahoria"]), "Guiso de Zanahoria");
  assert.strictEqual(nombrePlato("Frito", ["zanahoria"]), "Frito de Zanahoria");
});

test("nombrePlato: dos ingredientes se unen con 'y'", () => {
  assert.strictEqual(nombrePlato("Guiso", ["zanahoria", "carne_roja"]), "Guiso de Zanahoria y Carne Roja");
});

test("nombrePlato: tres o más ingredientes se listan con comas y 'y' antes del último", () => {
  assert.strictEqual(nombrePlato("Estofado", ["zanahoria", "carne_roja", "tomate"]), "Estofado de Zanahoria, Carne Roja y Tomate");
});

test("prefijoDe: una palabra por familia", () => {
  assert.strictEqual(prefijoDe("sopa"), "Sopa");
  assert.strictEqual(prefijoDe("guiso"), "Guiso");
  assert.strictEqual(prefijoDe("estofado"), "Estofado");
  assert.strictEqual(prefijoDe("frito"), "Frito");
  assert.strictEqual(prefijoDe("batido"), "Batido");
  assert.strictEqual(prefijoDe("ensalada"), "Ensalada");
  assert.strictEqual(prefijoDe("bocadillo"), "Bocadillo");
});

test("familiaDePlato: vasijas fijas (cuenco/cazuela/olla/olla_grande/tinaja) siempre dan la misma familia", () => {
  assert.strictEqual(familiaDePlato("cuenco", []), "sopa");
  assert.strictEqual(familiaDePlato("cazuela", []), "guiso");
  assert.strictEqual(familiaDePlato("olla", []), "sopa");
  assert.strictEqual(familiaDePlato("olla_grande", []), "sopa");
  assert.strictEqual(familiaDePlato("tinaja", []), "batido");
});

test("familiaDePlato: cuenco_grande (sartén) da Frito solo si TODO es de origen animal, si no Estofado", () => {
  assert.strictEqual(familiaDePlato("cuenco_grande", [{ origen: "animal" }]), "frito");
  assert.strictEqual(familiaDePlato("cuenco_grande", [{ origen: "animal" }, { origen: "animal" }]), "frito");
  assert.strictEqual(familiaDePlato("cuenco_grande", [{ origen: "vegetal" }]), "estofado");
  assert.strictEqual(familiaDePlato("cuenco_grande", [{ origen: "animal" }, { origen: "vegetal" }]), "estofado");
  assert.strictEqual(familiaDePlato("cuenco_grande", []), "estofado");
});

test("cocinarPlato: capacidadMax topa las raciones de una tanda grande, sin afectar tandas pequeñas", () => {
  const topada = cocinarPlato([{ ...ZANAHORIA, cantidad: 40 }], 6);
  assert.strictEqual(topada.platos, 6);
  const sinTope = cocinarPlato([{ ...ZANAHORIA, cantidad: 40 }]);
  assert.ok(sinTope.platos > 6);
  const pequena = cocinarPlato([{ ...ZANAHORIA, cantidad: 4 }], 6);
  assert.strictEqual(pequena.platos, 2, "por debajo del tope, el tope no afecta");
});

test("aceptaEnVasija: la tinaja de batidos solo admite leche y fruta/baya, cualquier otra vasija admite todo", () => {
  assert.strictEqual(aceptaEnVasija("tinaja", "leche", undefined), true);
  assert.strictEqual(aceptaEnVasija("tinaja", "fruta", "fruta"), true);
  assert.strictEqual(aceptaEnVasija("tinaja", "baya", "baya"), true);
  assert.strictEqual(aceptaEnVasija("tinaja", "tomate", "fruta_cultivada"), true);
  assert.strictEqual(aceptaEnVasija("tinaja", "carne_roja", undefined), false);
  assert.strictEqual(aceptaEnVasija("tinaja", "zanahoria", "hortaliza"), false);
  assert.strictEqual(aceptaEnVasija("olla", "carne_roja", undefined), true, "fuera de la tinaja no hay filtro");
});

test("aptoParaEnsalada: hortaliza/baya/fruta sí, cualquier otra categoría (o ninguna) no", () => {
  assert.strictEqual(aptoParaEnsalada("hortaliza"), true);
  assert.strictEqual(aptoParaEnsalada("baya"), true);
  assert.strictEqual(aptoParaEnsalada("fruta"), true);
  assert.strictEqual(aptoParaEnsalada("fruta_cultivada"), true);
  assert.strictEqual(aptoParaEnsalada("cereal"), false);
  assert.strictEqual(aptoParaEnsalada(undefined), false);
});

test("aportesDesdeRestaura: comida undefined pasa a 0, el resto se copia tal cual", () => {
  assert.deepStrictEqual(aportesDesdeRestaura({ vida: 5 }), { vida: 5, estamina: undefined, comida: 0, bebida: undefined });
  assert.deepStrictEqual(aportesDesdeRestaura({ vida: 2, estamina: 3, comida: 8, bebida: 1 }), { vida: 2, estamina: 3, comida: 8, bebida: 1 });
});

// --- Llenar de agua y esperar a que hierva (pedido 2026-08-30) ---

test("estaHirviendo: false si nunca se llenó de agua", () => {
  assert.strictEqual(estaHirviendo({ ingredientes: [] }, Date.now()), false);
});

test("estaHirviendo: false justo al llenar, true cuando pasa TIEMPO_HERVIR_MS", () => {
  const estado = { ingredientes: [], conAgua: true, calentandoDesde: 1000 };
  assert.strictEqual(estaHirviendo(estado, 1000), false);
  assert.strictEqual(estaHirviendo(estado, 1000 + TIEMPO_HERVIR_MS - 1), false);
  assert.strictEqual(estaHirviendo(estado, 1000 + TIEMPO_HERVIR_MS), true);
  assert.strictEqual(estaHirviendo(estado, 1000 + TIEMPO_HERVIR_MS + 5000), true);
});

test("segundosParaHervir: TIEMPO_HERVIR_MS/1000 justo al llenar, 0 sin agua o ya hirviendo", () => {
  assert.strictEqual(segundosParaHervir({ ingredientes: [] }, Date.now()), 0);
  const estado = { ingredientes: [], conAgua: true, calentandoDesde: 0 };
  assert.strictEqual(segundosParaHervir(estado, 0), TIEMPO_HERVIR_MS / 1000);
  assert.strictEqual(segundosParaHervir(estado, TIEMPO_HERVIR_MS), 0);
  assert.strictEqual(segundosParaHervir(estado, TIEMPO_HERVIR_MS + 9999), 0);
});
