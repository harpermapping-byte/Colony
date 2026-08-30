// Tests de mundo/catalogoBarcos.ts (docs/GDD_Barcos.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as path from "path";
import { cargarCatalogoBarcos } from "../src/mundo/catalogoBarcos";

const RUTA_ITEMS = path.resolve(__dirname, "..", "..", "items", "catalogo", "items.json");

test("cargarCatalogoBarcos: los 4 barcos iniciales, con plazas y velocidadBarco crecientes", () => {
  const catalogo = cargarCatalogoBarcos(RUTA_ITEMS);
  let plazasAnterior = 0;
  let velAnterior = 0;
  for (const id of ["barco_1", "barco_2", "barco_3", "barco_4"]) {
    assert.ok(catalogo[id], `falta ${id}`);
    assert.ok(catalogo[id].plazas > plazasAnterior, `${id} debería tener más plazas que el anterior`);
    assert.ok(catalogo[id].velocidadBarco > velAnterior, `${id} debería ser al menos igual de rápido que el anterior`);
    plazasAnterior = catalogo[id].plazas;
    velAnterior = catalogo[id].velocidadBarco;
  }
  assert.strictEqual(catalogo["barco_1"].plazas, 1);
  assert.strictEqual(catalogo["barco_4"].plazas, 4);
});

test("cargarCatalogoBarcos: un ítem normal (no esBarco) no aparece", () => {
  const catalogo = cargarCatalogoBarcos(RUTA_ITEMS);
  assert.strictEqual(catalogo["silla_montar"], undefined);
  assert.strictEqual(catalogo["madera_dura"], undefined);
});

test("cargarCatalogoBarcos: ignora las claves de nota (_nota, _camposConsumidores)", () => {
  const catalogo = cargarCatalogoBarcos(RUTA_ITEMS);
  assert.strictEqual(catalogo["_nota"], undefined);
  assert.strictEqual(catalogo["_camposConsumidores"], undefined);
});
