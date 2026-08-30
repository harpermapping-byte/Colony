// Tests de construccion/construccion.ts::esJarlConSesionAdmin (docs/GDD_Admin.md,
// pedido 2026-08-30: "1 jarl por mapa" + superadmin de cualquier mapa).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { esJarlConSesionAdmin } from "../src/construccion/construccion";

test("esJarlConSesionAdmin: sin sesión de admin, se comporta como esJarlGlobal (JARL_NOMBRES)", () => {
  const guardado = process.env.JARL_NOMBRES;
  process.env.JARL_NOMBRES = "Ragnar";
  assert.strictEqual(esJarlConSesionAdmin("Ragnar", null, "principal"), true);
  assert.strictEqual(esJarlConSesionAdmin("ragnar", null, "principal"), true, "insensible a mayúsculas, igual que esJarlGlobal");
  assert.strictEqual(esJarlConSesionAdmin("Bjorn", null, "principal"), false);
  assert.strictEqual(esJarlConSesionAdmin(undefined, null, "principal"), false);
  if (guardado === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = guardado;
});

test("esJarlConSesionAdmin: jarl de sesión admin en SU mapa -> true", () => {
  const guardado = process.env.JARL_NOMBRES;
  delete process.env.JARL_NOMBRES;
  const identidad = { usuario: "Bjorn", rol: "jarl" as const, mapaId: "principal" };
  assert.strictEqual(esJarlConSesionAdmin("Bjorn", identidad, "principal"), true);
  if (guardado === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = guardado;
});

test("esJarlConSesionAdmin: jarl de sesión admin en OTRO mapa -> false (1 jarl por mapa)", () => {
  const guardado = process.env.JARL_NOMBRES;
  delete process.env.JARL_NOMBRES;
  const identidad = { usuario: "Bjorn", rol: "jarl" as const, mapaId: "otro_mapa" };
  assert.strictEqual(esJarlConSesionAdmin("Bjorn", identidad, "principal"), false);
  if (guardado === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = guardado;
});

test("esJarlConSesionAdmin: superadmin -> true en CUALQUIER mapa", () => {
  const guardado = process.env.JARL_NOMBRES;
  delete process.env.JARL_NOMBRES;
  const identidad = { usuario: "Super", rol: "superadmin" as const, mapaId: null };
  assert.strictEqual(esJarlConSesionAdmin("Super", identidad, "principal"), true);
  assert.strictEqual(esJarlConSesionAdmin("Super", identidad, "otro_mapa"), true);
  assert.strictEqual(esJarlConSesionAdmin("Super", identidad, undefined), true);
  if (guardado === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = guardado;
});

test("esJarlConSesionAdmin: nombre de PJ no coincide con el usuario de la cuenta -> igualmente decide por identidadAdmin (no compara nombre vs usuario)", () => {
  const guardado = process.env.JARL_NOMBRES;
  delete process.env.JARL_NOMBRES;
  // El PJ puede llamarse cualquier cosa: lo que importa es la sesión de admin ya resuelta, no el nombre.
  const identidad = { usuario: "Bjorn", rol: "jarl" as const, mapaId: "principal" };
  assert.strictEqual(esJarlConSesionAdmin("NombrePJCualquiera", identidad, "principal"), true);
  if (guardado === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = guardado;
});

test("esJarlConSesionAdmin: sin nombre y sin sesión -> false", () => {
  assert.strictEqual(esJarlConSesionAdmin(undefined, null, "principal"), false);
});
