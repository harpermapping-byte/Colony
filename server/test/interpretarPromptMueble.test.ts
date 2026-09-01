// Tests de taller-vox/interpretarPromptMueble.js — texto libre → parámetros
// REALES del generador de muebles (docs/GDD_Ropa_Procedural.md §Carpintero
// legendario). MISMO patrón que interpretarPromptRopa.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  interpretarPromptMueble,
  analizarPalabrasClave,
  normalizar,
  cargarVocabularioMuebles,
  cargarColoresAcento,
  ARQUETIPO_POR_TIPO,
} = require("../../taller-vox/interpretarPromptMueble");

const vocabulario = cargarVocabularioMuebles();
const colores = cargarColoresAcento();

test("normalizar: minúsculas y sin tildes", () => {
  assert.strictEqual(normalizar("Sillón Señorial"), "sillon senorial");
  assert.strictEqual(normalizar(""), "");
});

test("interpretarPromptMueble: siempre devuelve un arquetipoId REAL de los 4 elegibles", () => {
  for (const texto of ["silla de roble noble", "mesa rústica de pino", "cama de haya", "arcón de nogal con herrajes", "", "asdkjaslkdj sin sentido"]) {
    const r = interpretarPromptMueble(texto);
    assert.ok(Object.values(ARQUETIPO_POR_TIPO).includes(r.arquetipoId), `"${texto}" → arquetipoId "${r.arquetipoId}" no es uno de los 4 elegibles`);
  }
});

test("interpretarPromptMueble: texto vacío o sin palabra reconocida cae a silla de roble, no revienta", () => {
  const r1 = interpretarPromptMueble("");
  const r2 = interpretarPromptMueble("xxzzqqww1234");
  for (const r of [r1, r2]) {
    assert.strictEqual(r.tipoMueble, "silla");
    assert.strictEqual(r.maderaId, "roble");
  }
});

test("interpretarPromptMueble: detecta tipoMueble por palabra clave", () => {
  assert.strictEqual(interpretarPromptMueble("un sillón cómodo").tipoMueble, "silla");
  assert.strictEqual(interpretarPromptMueble("una mesa de comedor").tipoMueble, "mesa");
  assert.strictEqual(interpretarPromptMueble("un lecho de matrimonio").tipoMueble, "cama");
  assert.strictEqual(interpretarPromptMueble("un baúl reforzado").tipoMueble, "arcon");
});

test("interpretarPromptMueble: detecta madera y modificadores por palabra clave", () => {
  const r = interpretarPromptMueble("silla de nogal tallada y desgastada con incrustaciones");
  assert.strictEqual(r.maderaId, "nogal");
  assert.strictEqual(r.tallado, true);
  assert.strictEqual(r.desgaste, true);
  assert.strictEqual(r.incrustado, true);
  assert.strictEqual(r.roto, false);
});

test("interpretarPromptMueble: un color reconocido se refleja en colorAcento", () => {
  const r = interpretarPromptMueble("arcón tapizado de color rojo");
  assert.ok(r.colorAcento, "esperaba un colorAcento reconocido para 'rojo'");
});

test("interpretarPromptMueble: sin color en el texto ni estilo con color, colorAcento es null", () => {
  const r = interpretarPromptMueble("mesa de pino recta");
  assert.strictEqual(r.colorAcento, null);
});

test("interpretarPromptMueble: una madera explícita PISA la del paquete de estilo ('noble pero de pino')", () => {
  const r = interpretarPromptMueble("silla noble pero de pino");
  assert.strictEqual(r.maderaId, "pino", "la madera explícita debe ganar a la del paquete 'noble' (roble)");
});

test("analizarPalabrasClave: un solo paquete de estilo gana, nunca mezcla dos", () => {
  const r = analizarPalabrasClave("un mueble noble pero rustico", vocabulario, colores);
  assert.ok(["roble", "pino"].includes(r.maderaId!));
});
