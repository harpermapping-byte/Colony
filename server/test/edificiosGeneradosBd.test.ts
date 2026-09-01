// Tests de la persistencia del ingeniero legendario (docs/GDD_Ropa_Procedural.md
// §Ingeniero legendario) — MISMO patrón exacto que mueblesGeneradosBd.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, EdificioGenerado } from "../src/datos/bd";

function edificio(creadorId: number, overrides: Partial<EdificioGenerado> = {}): Omit<EdificioGenerado, "id" | "creadoEn"> {
  return {
    creadorId,
    tipoEdificio: "casa_noble",
    parametros: { materialId: "piedra", forma: "L", balcon: true },
    nombre: "Villa del Ingeniero",
    promptTexto: "casa noble de piedra en forma de L con balcón",
    ...overrides,
  };
}

test("crearEdificioGenerado + obtenerEdificioGenerado: se guarda y recupera tal cual, con id y creadoEn asignados", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("ingeniero1");
  const base = edificio(jugador.id);
  const creado = await bd.crearEdificioGenerado(base);
  assert.ok(creado.id > 0);
  assert.ok(creado.creadoEn);
  const encontrado = await bd.obtenerEdificioGenerado(creado.id);
  assert.deepStrictEqual(encontrado, creado);
  await bd.cerrar();
});

test("obtenerEdificioGenerado: null si ese id nunca existió", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerEdificioGenerado(9999), null);
  await bd.cerrar();
});

test("listarEdificiosGeneradosDeCreador: solo los del creador pedido, ninguno de otro jugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("ingeniero1");
  const j2 = await bd.obtenerOCrearJugador("ingeniero2");
  await bd.crearEdificioGenerado(edificio(j1.id, { nombre: "Villa de J1 A" }));
  await bd.crearEdificioGenerado(edificio(j1.id, { nombre: "Villa de J1 B" }));
  await bd.crearEdificioGenerado(edificio(j2.id, { nombre: "Villa de J2" }));
  const deJ1 = await bd.listarEdificiosGeneradosDeCreador(j1.id);
  assert.strictEqual(deJ1.length, 2);
  assert.ok(deJ1.every((e) => e.creadorId === j1.id));
  await bd.cerrar();
});

test("resolverCooldownIngenieriaLegendaria: la primera vez siempre permite y consume el cooldown", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("ingeniero1");
  const permitido = await bd.resolverCooldownIngenieriaLegendaria(jugador.id, 1_000_000, 24 * 3_600_000);
  assert.strictEqual(permitido, true);
  await bd.cerrar();
});

test("resolverCooldownIngenieriaLegendaria: dentro de las 24h reales, NO permite", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("ingeniero1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(jugador.id, 1_000_000 + 1000, ventana), false);
  await bd.cerrar();
});

test("resolverCooldownIngenieriaLegendaria: pasadas >=24h reales, vuelve a permitir", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("ingeniero1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(jugador.id, 1_000_000 + ventana, ventana), true);
  await bd.cerrar();
});

test("resolverCooldownIngenieriaLegendaria: cada jugador tiene su propio cooldown independiente", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("ingeniero1");
  const j2 = await bd.obtenerOCrearJugador("ingeniero2");
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(j1.id, 1_000_000, 24 * 3_600_000), true);
  assert.strictEqual(await bd.resolverCooldownIngenieriaLegendaria(j2.id, 1_000_000, 24 * 3_600_000), true);
  await bd.cerrar();
});
