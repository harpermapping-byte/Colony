// Tests de admin/adminAuth.ts (pedido 2026-08-30, sesión de admin).
import { test } from "node:test";
import * as assert from "node:assert";
import { crearSesionAdmin, resolverSesionAdmin, cerrarSesionAdmin } from "../src/admin/adminAuth";

test("crearSesionAdmin + resolverSesionAdmin: la identidad vuelve tal cual", () => {
  const token = crearSesionAdmin({ usuario: "Ragnar", rol: "jarl", mapaId: "principal" });
  const identidad = resolverSesionAdmin(token);
  assert.deepStrictEqual(identidad, { usuario: "Ragnar", rol: "jarl", mapaId: "principal" });
});

test("resolverSesionAdmin: superadmin lleva mapaId null", () => {
  const token = crearSesionAdmin({ usuario: "Super", rol: "superadmin", mapaId: null });
  assert.deepStrictEqual(resolverSesionAdmin(token), { usuario: "Super", rol: "superadmin", mapaId: null });
});

test("resolverSesionAdmin: token desconocido o sin token, null", () => {
  assert.strictEqual(resolverSesionAdmin("esto_no_existe"), null);
  assert.strictEqual(resolverSesionAdmin(undefined), null);
});

test("cerrarSesionAdmin: invalida el token, deja de resolver", () => {
  const token = crearSesionAdmin({ usuario: "Ragnar", rol: "jarl", mapaId: "principal" });
  assert.ok(resolverSesionAdmin(token));
  cerrarSesionAdmin(token);
  assert.strictEqual(resolverSesionAdmin(token), null);
});

test("cada llamada a crearSesionAdmin da un token distinto", () => {
  const a = crearSesionAdmin({ usuario: "A", rol: "jarl", mapaId: "principal" });
  const b = crearSesionAdmin({ usuario: "B", rol: "jarl", mapaId: "principal" });
  assert.notStrictEqual(a, b);
});
