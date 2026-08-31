// Tests de la persistencia de compañeros (docs/GDD_Companeros.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, PREFIJO_NPC_COMPANERO, saldoInicialPara } from "../src/datos/bd";

test("saldoInicialPara: un compañero arranca sin Farycoins (no compra/vende)", () => {
  assert.strictEqual(saldoInicialPara(`${PREFIJO_NPC_COMPANERO}slot_1`), 0);
});

test("crearCompanero: la fila sintética en jugadores reusa inventario/equipo/vida GRATIS", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const companeroJugador = await bd.obtenerOCrearJugador(`${PREFIJO_NPC_COMPANERO}slot_1`, 0);
  assert.strictEqual(companeroJugador.farycoins, 0);
  const c = await bd.crearCompanero(jugador.id, companeroJugador.id, "slot_1", "Bjorn");
  assert.strictEqual(c.jugadorId, jugador.id);
  assert.strictEqual(c.companeroJugadorId, companeroJugador.id);
  assert.strictEqual(c.nombre, "Bjorn");
  assert.strictEqual(c.ubicacion, "siguiendo");
  assert.strictEqual(c.xp, 0);
  await bd.cerrar();
});

test("listarCompaneros: solo devuelve los del jugador dueño", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Astrid");
  const b = await bd.obtenerOCrearJugador("Bjorn");
  const cjA = await bd.obtenerOCrearJugador(`${PREFIJO_NPC_COMPANERO}slotA`, 0);
  const cjB = await bd.obtenerOCrearJugador(`${PREFIJO_NPC_COMPANERO}slotB`, 0);
  await bd.crearCompanero(a.id, cjA.id, "slotA", "Egil");
  await bd.crearCompanero(b.id, cjB.id, "slotB", "Ivar");
  const deA = await bd.listarCompaneros(a.id);
  assert.strictEqual(deA.length, 1);
  assert.strictEqual(deA[0].nombre, "Egil");
  await bd.cerrar();
});

test("actualizarXpCompanero: todo o nada — solo cambia si el id pertenece de verdad al jugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const otro = await bd.obtenerOCrearJugador("Otro");
  const companeroJugador = await bd.obtenerOCrearJugador(`${PREFIJO_NPC_COMPANERO}slot_1`, 0);
  const c = await bd.crearCompanero(jugador.id, companeroJugador.id, "slot_1", "Bjorn");

  const okAjeno = await bd.actualizarXpCompanero(c.id, otro.id, 999);
  assert.strictEqual(okAjeno, false);

  const ok = await bd.actualizarXpCompanero(c.id, jugador.id, 250);
  assert.strictEqual(ok, true);
  const lista = await bd.listarCompaneros(jugador.id);
  assert.strictEqual(lista[0].xp, 250);
  await bd.cerrar();
});

test("actualizarUbicacionCompanero: dejar en propiedad y volver a siguiendo", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const companeroJugador = await bd.obtenerOCrearJugador(`${PREFIJO_NPC_COMPANERO}slot_1`, 0);
  const c = await bd.crearCompanero(jugador.id, companeroJugador.id, "slot_1", "Bjorn");

  await bd.actualizarUbicacionCompanero(c.id, jugador.id, "propiedad", "casa_1");
  let lista = await bd.listarCompaneros(jugador.id);
  assert.strictEqual(lista[0].ubicacion, "propiedad");
  assert.strictEqual(lista[0].propiedadId, "casa_1");

  await bd.actualizarUbicacionCompanero(c.id, jugador.id, "siguiendo", null);
  lista = await bd.listarCompaneros(jugador.id);
  assert.strictEqual(lista[0].ubicacion, "siguiendo");
  assert.strictEqual(lista[0].propiedadId, null);
  await bd.cerrar();
});
