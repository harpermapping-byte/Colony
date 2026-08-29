// Tests de la lógica PURA de gremios/clanes (server/src/gremios/gremios.ts).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  cargarCatalogoEmblemas,
  cargarPaletaColores,
  colorGremioValido,
  colorPorDefecto,
  emblemaGremioValido,
  nombreGremioValido,
  EMBLEMA_POR_DEFECTO,
} from "../src/gremios/gremios";

test("cargarCatalogoEmblemas: filtra claves _nota* y trae el emblema por defecto", () => {
  const catalogo = cargarCatalogoEmblemas();
  const ids = Object.keys(catalogo);
  assert.ok(!ids.some((id) => id.startsWith("_")), "alguna clave _nota* se coló");
  assert.ok(ids.length >= 10, "catálogo demasiado corto para un catálogo cerrado real");
  assert.ok(catalogo[EMBLEMA_POR_DEFECTO], "falta el emblema por defecto");
  for (const [id, e] of Object.entries(catalogo)) {
    assert.ok(typeof e.uso === "string" && e.uso.length > 0, `${id}: sin 'uso'`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(e.colorDebug), `${id}: colorDebug inválido`);
  }
});

test("cargarPaletaColores: paleta cerrada, todo hex válido, sin duplicados", () => {
  const paleta = cargarPaletaColores();
  assert.ok(paleta.length >= 10);
  for (const c of paleta) assert.ok(/^#[0-9a-f]{6}$/i.test(c), `color inválido: ${c}`);
  assert.strictEqual(new Set(paleta.map((c) => c.toLowerCase())).size, paleta.length, "hay colores duplicados en la paleta");
});

test("nombreGremioValido: 3-24 caracteres tras trim", () => {
  assert.strictEqual(nombreGremioValido("Ab").ok, false, "2 caracteres, demasiado corto");
  assert.strictEqual(nombreGremioValido("Abc").ok, true, "3 caracteres, justo el mínimo");
  assert.strictEqual(nombreGremioValido("A".repeat(24)).ok, true, "24 caracteres, justo el máximo");
  assert.strictEqual(nombreGremioValido("A".repeat(25)).ok, false, "25 caracteres, demasiado largo");
  assert.strictEqual(nombreGremioValido("  Abc  ").ok, true, "los espacios de trim no cuentan");
  assert.strictEqual(nombreGremioValido("  A  ").ok, false, "tras trim se queda en 1 caracter");
});

test("colorGremioValido: solo colores de la paleta cerrada, case-insensitive", () => {
  const [primero] = cargarPaletaColores();
  assert.strictEqual(colorGremioValido(primero), true);
  assert.strictEqual(colorGremioValido(primero.toUpperCase()), true, "case-insensitive");
  assert.strictEqual(colorGremioValido("#123456"), false, "color fuera de la paleta");
  assert.strictEqual(colorGremioValido("no-es-un-color"), false);
});

test("emblemaGremioValido: solo ids del catálogo cerrado", () => {
  assert.strictEqual(emblemaGremioValido(EMBLEMA_POR_DEFECTO), true);
  assert.strictEqual(emblemaGremioValido("emblema_inventado"), false);
});

test("colorPorDefecto: determinista, siempre el primero de la paleta (nunca azar)", () => {
  const a = colorPorDefecto();
  const b = colorPorDefecto();
  assert.strictEqual(a, b);
  assert.strictEqual(a, cargarPaletaColores()[0]);
  assert.strictEqual(colorGremioValido(a), true, "el color por defecto debe ser válido según su propia paleta");
});
