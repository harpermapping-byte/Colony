// Tests de mundo/catalogoCombateFauna.ts (docs/GDD_Mecanicas.md §5.4,
// pedido 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as path from "path";
import { cargarCatalogoCombateFauna, estadisticasCombatePorDefecto } from "../src/mundo/catalogoCombateFauna";

const RUTA_ANIMALES = path.resolve(__dirname, "..", "..", "baker", "catalogo", "animales.json");

test("cargarCatalogoCombateFauna: cubre especies adultas, crías Y población infinita", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.ok(catalogo["conejo"], "adulto reproductivo pequeño");
  assert.ok(catalogo["jabato"], "cría (excluida del catálogo de reproducción, pero tiene vida)");
  assert.ok(catalogo["abeja"], "población infinita (insecto)");
});

test("cargarCatalogoCombateFauna: un animal grande y peligroso tiene más vida que uno pequeño no peligroso", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.ok(catalogo["oso_pardo"].vidaMaxima > catalogo["conejo"].vidaMaxima);
  assert.strictEqual(catalogo["conejo"].categoriaVida, "pequeno");
  assert.strictEqual(catalogo["oso_pardo"].categoriaVida, "grande");
});

test("cargarCatalogoCombateFauna: una cría tiene menos vida que su especie adulta", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.ok(catalogo["jabato"].vidaMaxima < catalogo["jabali"].vidaMaxima);
});

test("cargarCatalogoCombateFauna: ignora las claves de nota (_nota, _nota_colision)", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.strictEqual(catalogo["_nota"], undefined);
});

test("estadisticasCombatePorDefecto: relleno seguro para una especie sin catalogar", () => {
  const relleno = estadisticasCombatePorDefecto();
  assert.strictEqual(relleno.categoriaVida, "pequeno");
  assert.ok(relleno.vidaMaxima > 0);
  assert.ok(relleno.ataque > 0);
  assert.strictEqual(relleno.peligroso, false);
});

test("cargarCatalogoCombateFauna: peligroso viaja tal cual del catálogo (docs/GDD_Combate.md §7)", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.strictEqual(catalogo["oso_pardo"].peligroso, true);
  assert.strictEqual(catalogo["conejo"].peligroso, false);
});

test("cargarCatalogoCombateFauna: domesticable viaja tal cual del catálogo (docs/GDD_Mascotas.md) — perro/gato sí, un oso no", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.strictEqual(catalogo["perro"].domesticable, true);
  assert.strictEqual(catalogo["gato"].domesticable, true);
  assert.strictEqual(catalogo["oso_pardo"].domesticable, false);
});

// docs/GDD_Monturas.md (pedido 2026-08-30)
test("cargarCatalogoCombateFauna: dieta viaja tal cual del catálogo, y jabalí/ciervo ya son domesticables", () => {
  const catalogo = cargarCatalogoCombateFauna(RUTA_ANIMALES);
  assert.strictEqual(catalogo["ciervo"].dieta, "herbivoro");
  assert.strictEqual(catalogo["jabali"].dieta, "omnivoro");
  assert.strictEqual(catalogo["lobo"].dieta, "carnivoro");
  assert.strictEqual(catalogo["ciervo"].domesticable, true);
  assert.strictEqual(catalogo["jabali"].domesticable, true);
  assert.strictEqual(catalogo["cerdo"].domesticable, true);
});
