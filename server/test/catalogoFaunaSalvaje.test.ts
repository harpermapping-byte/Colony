// Test de mundo/catalogoFaunaSalvaje.ts contra el catálogo REAL del
// bakeador — confirma que baker/catalogo/animales.json (187 especies,
// ver docs/GDD_Agentes_Moviles.md) se reduce correctamente a lo que
// necesita el sistema de reproducción. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as path from "node:path";
import { cargarCatalogoFaunaSalvaje } from "../src/mundo/catalogoFaunaSalvaje";

const RUTA = path.resolve(__dirname, "..", "..", "baker", "catalogo", "animales.json");

test("carga el catálogo real: mamíferos reproductores, insectos infinitos y crías quedan como se espera", () => {
  const catalogo = cargarCatalogoFaunaSalvaje(RUTA);

  const lobo = catalogo["lobo"];
  assert.ok(lobo, "lobo debería estar catalogado");
  assert.strictEqual(lobo.tamanoReproduccion, "grande");
  assert.strictEqual(lobo.poneHuevos, false);
  assert.strictEqual(lobo.poblacionInfinita, undefined);

  const gallinaSalvaje = catalogo["gallina_salvaje"];
  assert.strictEqual(gallinaSalvaje.poneHuevos, true);
  assert.strictEqual(gallinaSalvaje.criaId, "pollito");

  const jabali = catalogo["jabali"];
  assert.strictEqual(jabali.criaId, "jabato");

  const ratonDeCampo = catalogo["raton_de_campo"];
  assert.strictEqual(ratonDeCampo.criasPorCamada, 2);

  const abeja = catalogo["abeja"];
  assert.strictEqual(abeja.poblacionInfinita, true);

  // las crías no reproducen: no deberían aparecer en el catálogo reducido
  assert.strictEqual(catalogo["cachorro"], undefined);
  assert.strictEqual(catalogo["jabato"], undefined);
});

test("todas las entradas devueltas tienen tamanoReproduccion válido o poblacionInfinita", () => {
  const catalogo = cargarCatalogoFaunaSalvaje(RUTA);
  const total = Object.keys(catalogo).length;
  assert.ok(total > 100, `se esperaban >100 especies reproductoras/infinitas, salieron ${total}`);
  for (const [id, especie] of Object.entries(catalogo)) {
    const valido = especie.poblacionInfinita === true || ["pequeno", "mediano", "grande"].includes(especie.tamanoReproduccion);
    assert.ok(valido, `${id}: tamanoReproduccion inválido (${especie.tamanoReproduccion})`);
  }
});
