// Tests de ropa/src/interpretarPrompt.js — texto libre → parámetros REALES
// del generador de ropa (docs/GDD_Ropa_Procedural.md §Sastre legendario).
// Módulo compartido con el cliente (client/src/render3d/interpretarPrompt.ts,
// puerto TS) — se prueba desde server/ porque aquí corren los tests de
// backend con tsx, pero es el mismo require que usa RoomExteriorBase.
import { test } from "node:test";
import * as assert from "node:assert";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  interpretarPromptTejido,
  analizarPalabrasClave,
  elegirPrendaBase,
  normalizar,
  cargarVocabularioLegendario,
  cargarCatalogoPrendas,
} = require("../../ropa/src/interpretarPrompt");

const vocabulario = cargarVocabularioLegendario();
const catalogoPrendas = cargarCatalogoPrendas();

test("normalizar: minúsculas y sin tildes", () => {
  assert.strictEqual(normalizar("Túnica Mística"), "tunica mistica");
  assert.strictEqual(normalizar(""), "");
  assert.strictEqual(normalizar(undefined as any), "");
});

test("interpretarPromptTejido: siempre devuelve un prendaBaseId REAL del catálogo, nunca inventado", () => {
  for (const texto of ["túnica noble de seda azul", "pantalón de cuero", "gorro humilde", "", "asdkjaslkdj sin sentido"]) {
    const r = interpretarPromptTejido(texto);
    assert.ok(r.prendaBaseId in catalogoPrendas, `"${texto}" → prendaBaseId "${r.prendaBaseId}" no existe en prendas.json`);
  }
});

test("interpretarPromptTejido: el materialId resuelto SIEMPRE es compatible con el arquetipo elegido", () => {
  for (const texto of ["camisa de seda", "pantalón de lana con cinturón", "gorro de cuero", "túnica"]) {
    const r = interpretarPromptTejido(texto);
    const base = catalogoPrendas[r.prendaBaseId];
    assert.ok(base.materialesCompatibles.includes(r.materialId), `"${texto}": material "${r.materialId}" no compatible con ${r.prendaBaseId}`);
  }
});

test("interpretarPromptTejido: texto vacío o sin ninguna palabra reconocida cae a un arquetipo por defecto válido, no revienta", () => {
  const r1 = interpretarPromptTejido("");
  const r2 = interpretarPromptTejido("xxzzqqww1234");
  for (const r of [r1, r2]) {
    assert.ok(r.prendaBaseId in catalogoPrendas);
    assert.ok(catalogoPrendas[r.prendaBaseId].materialesCompatibles.includes(r.materialId));
  }
});

test("interpretarPromptTejido: detecta tipoPrenda por palabra clave (camisa/pantalón/gorro)", () => {
  assert.strictEqual(catalogoPrendas[interpretarPromptTejido("una túnica elegante").prendaBaseId].tipoPrenda, "camisa");
  assert.strictEqual(catalogoPrendas[interpretarPromptTejido("unas calzas de guerrero").prendaBaseId].tipoPrenda, "pantalon");
  assert.strictEqual(catalogoPrendas[interpretarPromptTejido("una cofia sencilla").prendaBaseId].tipoPrenda, "gorro");
});

test("interpretarPromptTejido: un color reconocido se refleja en colorHint", () => {
  const r = interpretarPromptTejido("camisa roja de lino");
  assert.ok(r.colorHint, "esperaba un colorHint reconocido para 'roja'");
});

test("interpretarPromptTejido: sin ningún color en el texto, colorHint es null (no inventa uno)", () => {
  const r = interpretarPromptTejido("camisa de lino recta");
  assert.strictEqual(r.colorHint, null);
});

test("interpretarPromptTejido: una palabra de detalle más específica PISA lo que puso el paquete de estilo (\"noble pero de lana\")", () => {
  const r = interpretarPromptTejido("túnica noble pero de lana");
  assert.strictEqual(r.materialId, "lana", "el material explícito ('de lana') debe ganar al material del paquete 'noble' (seda)");
});

test("interpretarPromptTejido: detalle se mezcla SIEMPRE sobre el detalle base del arquetipo (nunca queda a medias)", () => {
  const r = interpretarPromptTejido("gorro con borde vuelto"); // no menciona "forma", debe heredar la del arquetipo base
  const base = catalogoPrendas[r.prendaBaseId];
  assert.strictEqual(r.detalle.borde, "vuelto");
  assert.strictEqual(r.detalle.forma, base.detalle.forma, "el campo no mencionado hereda el del arquetipo base");
});

test("elegirPrendaBase: prefiere un arquetipo que admita el material pedido; si ninguno lo admite, cae al primero de ese tipo", () => {
  const conCuero = elegirPrendaBase("pantalon", "cuero", catalogoPrendas);
  assert.ok(catalogoPrendas[conCuero!].materialesCompatibles.includes("cuero"));
  const materialImposible = elegirPrendaBase("gorro", "material_que_no_existe", catalogoPrendas);
  assert.ok(materialImposible! in catalogoPrendas, "cae a un arquetipo válido aunque el material no exista en ninguno");
});

test("analizarPalabrasClave: un solo paquete de estilo gana, nunca mezcla dos (ej. 'noble' + 'campesino' a la vez)", () => {
  const r = analizarPalabrasClave("una prenda noble pero campesina", vocabulario);
  // el primero que aparece en el vocabulario (orden del JSON) es el que gana — determinista.
  assert.ok(["seda", "lino"].includes(r.materialId!));
});
