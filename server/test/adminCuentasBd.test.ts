// Tests de la persistencia de cuentas de admin (docs/GDD_Admin.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";

test("crearCuentaAdmin + obtenerCuentaAdminPorUsuario: se puede releer tal cual", async () => {
  const bd = new AlmacenDatos(":memory:");
  const creada = await bd.crearCuentaAdmin({
    usuario: "Ragnar",
    passwordHash: "salt:hash",
    twitchLogin: null,
    rol: "jarl",
    mapaId: "principal",
  });
  assert.strictEqual(creada.usuario, "Ragnar");
  assert.strictEqual(creada.rol, "jarl");
  assert.strictEqual(creada.mapaId, "principal");
  const releida = await bd.obtenerCuentaAdminPorUsuario("Ragnar");
  assert.ok(releida);
  assert.strictEqual(releida!.id, creada.id);
  assert.strictEqual(releida!.passwordHash, "salt:hash");
  assert.strictEqual(releida!.twitchLogin, null);
  await bd.cerrar();
});

test("obtenerCuentaAdminPorUsuario: null si no existe", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerCuentaAdminPorUsuario("nadie"), null);
  await bd.cerrar();
});

test("obtenerCuentaAdminPorTwitchLogin: resuelve por login de Twitch vinculado", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({
    usuario: "Super",
    passwordHash: null,
    twitchLogin: "super_streamer",
    rol: "superadmin",
    mapaId: null,
  });
  const releida = await bd.obtenerCuentaAdminPorTwitchLogin("super_streamer");
  assert.ok(releida);
  assert.strictEqual(releida!.usuario, "Super");
  assert.strictEqual(releida!.rol, "superadmin");
  assert.strictEqual(releida!.mapaId, null);
  assert.strictEqual(await bd.obtenerCuentaAdminPorTwitchLogin("nadie"), null);
  await bd.cerrar();
});

test("listarCuentasAdmin: devuelve todas, en orden de creación", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({ usuario: "A", passwordHash: "x:y", twitchLogin: null, rol: "jarl", mapaId: "principal" });
  await bd.crearCuentaAdmin({ usuario: "B", passwordHash: "x:y", twitchLogin: null, rol: "superadmin", mapaId: null });
  const todas = await bd.listarCuentasAdmin();
  assert.strictEqual(todas.length, 2);
  assert.strictEqual(todas[0].usuario, "A");
  assert.strictEqual(todas[1].usuario, "B");
  await bd.cerrar();
});

test("actualizarPasswordAdmin: cambia el hash guardado", async () => {
  const bd = new AlmacenDatos(":memory:");
  const cuenta = await bd.crearCuentaAdmin({ usuario: "Ragnar", passwordHash: "viejo:hash", twitchLogin: null, rol: "jarl", mapaId: "principal" });
  await bd.actualizarPasswordAdmin(cuenta.id, "nuevo:hash");
  const releida = await bd.obtenerCuentaAdminPorUsuario("Ragnar");
  assert.strictEqual(releida!.passwordHash, "nuevo:hash");
  await bd.cerrar();
});

test("asignarJarlDeMapa: falla si la cuenta no existe", async () => {
  const bd = new AlmacenDatos(":memory:");
  const r = await bd.asignarJarlDeMapa("principal", "nadie");
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivo);
  await bd.cerrar();
});

test("asignarJarlDeMapa: falla si la cuenta es superadmin (no se asigna a un mapa)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({ usuario: "Super", passwordHash: "x:y", twitchLogin: null, rol: "superadmin", mapaId: null });
  const r = await bd.asignarJarlDeMapa("principal", "Super");
  assert.strictEqual(r.ok, false);
  const releida = await bd.obtenerCuentaAdminPorUsuario("Super");
  assert.strictEqual(releida!.mapaId, null);
  await bd.cerrar();
});

test("asignarJarlDeMapa: 1 jarl por mapa — al asignar uno nuevo, el anterior pierde el mapa", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({ usuario: "Ragnar", passwordHash: "x:y", twitchLogin: null, rol: "jarl", mapaId: "principal" });
  await bd.crearCuentaAdmin({ usuario: "Bjorn", passwordHash: "x:y", twitchLogin: null, rol: "jarl", mapaId: null });

  const r = await bd.asignarJarlDeMapa("principal", "Bjorn");
  assert.strictEqual(r.ok, true);

  const bjorn = await bd.obtenerCuentaAdminPorUsuario("Bjorn");
  assert.strictEqual(bjorn!.mapaId, "principal");
  const ragnar = await bd.obtenerCuentaAdminPorUsuario("Ragnar");
  assert.strictEqual(ragnar!.mapaId, null);
  assert.strictEqual(ragnar!.rol, "jarl"); // sigue siendo jarl, solo que sin mapa asignado

  await bd.cerrar();
});

test("asignarJarlDeMapa: reasignar el mismo usuario al mismo mapa no le quita nada a sí mismo", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCuentaAdmin({ usuario: "Ragnar", passwordHash: "x:y", twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const r = await bd.asignarJarlDeMapa("principal", "Ragnar");
  assert.strictEqual(r.ok, true);
  const releida = await bd.obtenerCuentaAdminPorUsuario("Ragnar");
  assert.strictEqual(releida!.mapaId, "principal");
  await bd.cerrar();
});
