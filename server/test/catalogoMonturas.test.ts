// Tests de mundo/catalogoMonturas.ts (docs/GDD_Monturas.md, pedido
// 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as path from "path";
import { cargarCatalogoMonturas } from "../src/mundo/catalogoMonturas";

const RUTA_RIG = path.resolve(__dirname, "..", "..", "personajes", "catalogo", "animales_rig.json");

test("cargarCatalogoMonturas: solo especies montable:true, con su velocidadMontura", () => {
  const catalogo = cargarCatalogoMonturas(RUTA_RIG);
  for (const id of ["caballo", "caballo_salvaje", "vaca_salvaje", "burro", "jabali", "cerdo", "ciervo"]) {
    assert.ok(catalogo[id], `falta ${id} como montable`);
    assert.strictEqual(catalogo[id].montable, true);
    assert.ok(catalogo[id].velocidadMontura > 0, `${id} necesita velocidadMontura > 0`);
  }
});

test("cargarCatalogoMonturas: una especie no montable (conejo/lobo) no aparece", () => {
  const catalogo = cargarCatalogoMonturas(RUTA_RIG);
  assert.strictEqual(catalogo["conejo"], undefined);
  assert.strictEqual(catalogo["lobo"], undefined);
});

test("cargarCatalogoMonturas: buey es domesticable pero NO montable (animal de tiro, no de monta)", () => {
  const catalogo = cargarCatalogoMonturas(RUTA_RIG);
  assert.strictEqual(catalogo["buey"], undefined);
});

test("cargarCatalogoMonturas: ignora las claves de nota (_nota)", () => {
  const catalogo = cargarCatalogoMonturas(RUTA_RIG);
  assert.strictEqual(catalogo["_nota"], undefined);
});
