// Tests de la persistencia del sastre legendario (docs/GDD_Ropa_Procedural.md
// §Sastre legendario, pedido 2026-08-31): cooldown de 24h reales por
// jugador + blueprints permanentes. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, PrendaGenerada } from "../src/datos/bd";

function prenda(creadorId: number, overrides: Partial<PrendaGenerada> = {}): Omit<PrendaGenerada, "id" | "creadoEn"> {
  return {
    creadorId,
    prendaBaseId: "camisa_seda_noble",
    materialId: "seda",
    detalle: { cuello: "alto", mangas: "largas", bajo: "recto" },
    tintes: { cuerpo: "#7a4a9a" },
    nombre: "Túnica Mística de Neón",
    promptTexto: "túnica noble de seda púrpura",
    ...overrides,
  };
}

test("crearPrendaGenerada + obtenerPrendaGenerada: se guarda y recupera tal cual, con id y creadoEn asignados", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("sastre1");
  const base = prenda(jugador.id);
  const creada = await bd.crearPrendaGenerada(base);
  assert.ok(creada.id > 0);
  assert.ok(creada.creadoEn);
  const encontrada = await bd.obtenerPrendaGenerada(creada.id);
  assert.deepStrictEqual(encontrada, creada);
  await bd.cerrar();
});

test("obtenerPrendaGenerada: null si ese id nunca existió", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerPrendaGenerada(9999), null);
  await bd.cerrar();
});

test("listarPrendasGeneradasDeCreador: solo las del creador pedido, ninguna de otro jugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("sastre1");
  const j2 = await bd.obtenerOCrearJugador("sastre2");
  await bd.crearPrendaGenerada(prenda(j1.id, { nombre: "Túnica de J1 A" }));
  await bd.crearPrendaGenerada(prenda(j1.id, { nombre: "Túnica de J1 B" }));
  await bd.crearPrendaGenerada(prenda(j2.id, { nombre: "Túnica de J2" }));
  const deJ1 = await bd.listarPrendasGeneradasDeCreador(j1.id);
  assert.strictEqual(deJ1.length, 2);
  assert.ok(deJ1.every((p) => p.creadorId === j1.id));
  await bd.cerrar();
});

test("resolverCooldownTejidoLegendario: la primera vez (nunca tejió) siempre permite y consume el cooldown", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("sastre1");
  const permitido = await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000, 24 * 3_600_000);
  assert.strictEqual(permitido, true);
  await bd.cerrar();
});

test("resolverCooldownTejidoLegendario: dentro de las 24h reales tras la última vez, NO permite (y no lo vuelve a consumir)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("sastre1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000 + 1000, ventana), false, "1 segundo después, sigue en cooldown");
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000 + ventana - 1, ventana), false, "1ms antes de cumplirse 24h, sigue en cooldown");
  await bd.cerrar();
});

test("resolverCooldownTejidoLegendario: pasadas >=24h reales, vuelve a permitir", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("sastre1");
  const ventana = 24 * 3_600_000;
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000, ventana), true);
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(jugador.id, 1_000_000 + ventana, ventana), true, "exactamente 24h después: toca");
  await bd.cerrar();
});

test("resolverCooldownTejidoLegendario: cada jugador tiene su propio cooldown independiente", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j1 = await bd.obtenerOCrearJugador("sastre1");
  const j2 = await bd.obtenerOCrearJugador("sastre2");
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(j1.id, 1_000_000, 24 * 3_600_000), true);
  assert.strictEqual(await bd.resolverCooldownTejidoLegendario(j2.id, 1_000_000, 24 * 3_600_000), true, "el cooldown de j1 no afecta a j2");
  await bd.cerrar();
});
