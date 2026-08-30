// Tests de admin/seedAdmin.ts (docs/GDD_Admin.md, pedido 2026-08-30: cuentas
// de test iniciales, 1 jarl del mapa "principal" + 1 superadmin).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";
import { verificarPassword } from "../src/admin/passwordHash";
import {
  sembrarCuentasAdminIniciales,
  USUARIO_JARL_SEED,
  PASSWORD_JARL_SEED,
  USUARIO_SUPERADMIN_SEED,
  PASSWORD_SUPERADMIN_SEED,
  MAPA_ID_PRINCIPAL,
} from "../src/admin/seedAdmin";

test("sembrarCuentasAdminIniciales: crea el jarl del mapa principal + el superadmin", async () => {
  const bd = new AlmacenDatos(":memory:");
  await sembrarCuentasAdminIniciales(bd);

  const jarl = await bd.obtenerCuentaAdminPorUsuario(USUARIO_JARL_SEED);
  assert.ok(jarl);
  assert.strictEqual(jarl!.rol, "jarl");
  assert.strictEqual(jarl!.mapaId, MAPA_ID_PRINCIPAL);
  assert.ok(verificarPassword(PASSWORD_JARL_SEED, jarl!.passwordHash!));

  const superadmin = await bd.obtenerCuentaAdminPorUsuario(USUARIO_SUPERADMIN_SEED);
  assert.ok(superadmin);
  assert.strictEqual(superadmin!.rol, "superadmin");
  assert.strictEqual(superadmin!.mapaId, null);
  assert.ok(verificarPassword(PASSWORD_SUPERADMIN_SEED, superadmin!.passwordHash!));

  await bd.cerrar();
});

test("sembrarCuentasAdminIniciales: idempotente — si ya hay cuentas, no toca nada", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({ usuario: "YaExistia", passwordHash: null, twitchLogin: "yaexistia_tv", rol: "superadmin", mapaId: null });

  await sembrarCuentasAdminIniciales(bd);

  const todas = await bd.listarCuentasAdmin();
  assert.strictEqual(todas.length, 1, "no debe crear el jarl/superadmin de test si ya había alguna cuenta");
  assert.strictEqual(todas[0].usuario, "YaExistia");
  assert.strictEqual(await bd.obtenerCuentaAdminPorUsuario(USUARIO_JARL_SEED), null);

  await bd.cerrar();
});
