// Tests de la persistencia del carpintero legendario (docs/GDD_Ropa_Procedural.md
// §Carpintero legendario) — MISMO patrón exacto que prendasGeneradasBd.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, MuebleGenerado } from "../src/datos/bd";

function mueble(creadorId: number, overrides: Partial<MuebleGenerado> = {}): Omit<MuebleGenerado, "id" | "creadoEn"> {
  return {
    creadorId,
    arquetipoId: "silla",
    parametros: { tipoMueble: "silla", maderaId: "roble", tallado: true },
    nombre: "Silla del Carpintero",
    promptTexto: "silla de roble tallada",
    ...overrides,
  };
}

test("crearMuebleGenerado + obtenerMuebleGenerado: se guarda y recupera tal cual, con id y creadoEn asignados", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("carpintero1");
  const base = mueble(jugador.id);
  const creado = await bd.crearMuebleGenerado(base);
  assert.ok(creado.id > 0);
  assert.ok(creado.creadoEn);
  const encontrado = await bd.obtenerMuebleGenerado(creado.id);
  assert.deepStrictEqual(encontrado, creado);
  await bd.cerrar();
});

test("obtenerMuebleGenerado: null si ese id nunca existió", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerMuebleGenerado(9999), null);
  await bd.cerrar();
});

test("listarMueblesGeneradosDeCreador: solo los del creador pedido, ninguno de otro jugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("carpintero1");
  const j2 = await bd.obtenerOCrearJugador("carpintero2");
  await bd.crearMuebleGenerado(mueble(j1.id, { nombre: "Silla de J1 A" }));
  await bd.crearMuebleGenerado(mueble(j1.id, { nombre: "Silla de J1 B" }));
  await bd.crearMuebleGenerado(mueble(j2.id, { nombre: "Silla de J2" }));
  const deJ1 = await bd.listarMueblesGeneradosDeCreador(j1.id);
  assert.strictEqual(deJ1.length, 2);
  assert.ok(deJ1.every((m) => m.creadorId === j1.id));
  await bd.cerrar();
});

test("resolverCooldownCarpinteriaLegendaria: la primera vez siempre permite y consume el cooldown", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("carpintero1");
  const permitido = await bd.resolverCooldownCarpinteriaLegendaria(jugador.id, 1_000_000, 24 * 3_600_000);
  assert.strictEqual(permitido, true);
  await bd.cerrar();
});

test("resolverCooldownCarpinteriaLegendaria: dentro de las 24h reales, NO permite", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("carpintero1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(jugador.id, 1_000_000 + 1000, ventana), false);
  await bd.cerrar();
});

test("resolverCooldownCarpinteriaLegendaria: pasadas >=24h reales, vuelve a permitir", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("carpintero1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(jugador.id, 1_000_000 + ventana, ventana), true);
  await bd.cerrar();
});

test("resolverCooldownCarpinteriaLegendaria: cada jugador tiene su propio cooldown independiente", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("carpintero1");
  const j2 = await bd.obtenerOCrearJugador("carpintero2");
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(j1.id, 1_000_000, 24 * 3_600_000), true);
  assert.strictEqual(await bd.resolverCooldownCarpinteriaLegendaria(j2.id, 1_000_000, 24 * 3_600_000), true);
  await bd.cerrar();
});
