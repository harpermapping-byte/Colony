// Tests de taller-vox/interpretarPromptEdificio.js — texto libre →
// parámetros REALES del generador de edificios (docs/GDD_Ropa_Procedural.md
// §Ingeniero legendario). MISMO patrón que interpretarPromptMueble.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  interpretarPromptEdificio,
  analizarPalabrasClave,
  normalizar,
  cargarVocabularioEdificios,
  cargarColoresAcento,
} = require("../../taller-vox/interpretarPromptEdificio");

const vocabulario = cargarVocabularioEdificios();
const colores = cargarColoresAcento();
const TIPOS_VALIDOS = ["casa_humilde", "casa_noble", "tienda", "taberna"];
const MATERIALES_VALIDOS = ["madera", "piedra", "ladrillo", "adobe", "estuco"];

test("normalizar: minúsculas y sin tildes", () => {
  assert.strictEqual(normalizar("Mansión Señorial"), "mansion senorial");
});

test("interpretarPromptEdificio: siempre devuelve un tipoEdificio y material REALES", () => {
  for (const texto of ["casa noble de piedra", "cabaña de madera", "tienda de ladrillo", "taberna con porche", "", "asdkjaslkdj"]) {
    const r = interpretarPromptEdificio(texto);
    assert.ok(TIPOS_VALIDOS.includes(r.tipoEdificio), `"${texto}" → tipoEdificio "${r.tipoEdificio}" inválido`);
    assert.ok(MATERIALES_VALIDOS.includes(r.materialId), `"${texto}" → materialId "${r.materialId}" inválido`);
  }
});

test("interpretarPromptEdificio: texto vacío cae a casa_humilde de madera, forma rect, techo de paja", () => {
  const r = interpretarPromptEdificio("");
  assert.strictEqual(r.tipoEdificio, "casa_humilde");
  assert.strictEqual(r.materialId, "madera");
  assert.strictEqual(r.forma, "rect");
  assert.strictEqual(r.techoId, "paja");
  assert.strictEqual(r.balcon, false);
  assert.strictEqual(r.porche, false);
});

test("interpretarPromptEdificio: detecta tipoEdificio por palabra clave", () => {
  assert.strictEqual(interpretarPromptEdificio("una cabaña sencilla").tipoEdificio, "casa_humilde");
  assert.strictEqual(interpretarPromptEdificio("una mansión señorial").tipoEdificio, "casa_noble");
  assert.strictEqual(interpretarPromptEdificio("un puesto de mercado").tipoEdificio, "tienda");
  assert.strictEqual(interpretarPromptEdificio("una posada acogedora").tipoEdificio, "taberna");
});

test("interpretarPromptEdificio: detecta material, forma, techo y modificadores", () => {
  const r = interpretarPromptEdificio("casa en forma de L de ladrillo con techo de pizarra, balcón y porche");
  assert.strictEqual(r.materialId, "ladrillo");
  assert.strictEqual(r.forma, "L");
  assert.strictEqual(r.techoId, "pizarra");
  assert.strictEqual(r.balcon, true);
  assert.strictEqual(r.porche, true);
});

test("interpretarPromptEdificio: un color reconocido se refleja en colorAcento", () => {
  const r = interpretarPromptEdificio("casa con ventanas azules");
  assert.ok(r.colorAcento, "esperaba un colorAcento reconocido para 'azul'");
});

test("interpretarPromptEdificio: sin color en el texto, colorAcento es null", () => {
  const r = interpretarPromptEdificio("casa de piedra rectangular");
  assert.strictEqual(r.colorAcento, null);
});

test("analizarPalabrasClave: nunca revienta con texto raro y devuelve la forma esperada", () => {
  const r = analizarPalabrasClave("!!! %%% 12345", vocabulario, colores);
  assert.strictEqual(r.tipoEdificio, null);
  assert.strictEqual(r.balcon, false);
});
