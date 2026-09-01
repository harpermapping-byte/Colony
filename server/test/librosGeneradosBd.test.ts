// Tests de la persistencia de libros escritos por jugador (docs/GDD_Libreria.md,
// pedido 2026-09-01) — mismo patrón que mueblesGeneradosBd.test.ts/
// prendasGeneradasBd.test.ts, salvo que un libro SÍ se puede reescribir
// (actualizarLibroGenerado), a diferencia de esos blueprints inmutables.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, LibroGenerado } from "../src/datos/bd";

function libro(autorId: number, overrides: Partial<LibroGenerado> = {}): Omit<LibroGenerado, "id" | "creadoEn"> {
  return {
    autorId,
    titulo: "Diario de un Colono",
    paginas: ["Hoy planté las primeras semillas.", "El invierno viene antes de lo que pensaba."],
    ...overrides,
  };
}

test("crearLibroGenerado + obtenerLibroGenerado: se guarda y recupera tal cual, con id y creadoEn asignados", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("escritor1");
  const base = libro(jugador.id);
  const creado = await bd.crearLibroGenerado(base);
  assert.ok(creado.id > 0);
  assert.ok(creado.creadoEn);
  const encontrado = await bd.obtenerLibroGenerado(creado.id);
  assert.deepStrictEqual(encontrado, creado);
  await bd.cerrar();
});

test("obtenerLibroGenerado: null si ese id nunca existió", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerLibroGenerado(9999), null);
  await bd.cerrar();
});

test("actualizarLibroGenerado: reescribe título y páginas del mismo libro (a diferencia de un blueprint, un libro SÍ se edita)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("escritor1");
  const creado = await bd.crearLibroGenerado(libro(jugador.id));
  await bd.actualizarLibroGenerado(creado.id, "Diario Corregido", ["Nueva primera página."]);
  const actualizado = await bd.obtenerLibroGenerado(creado.id);
  assert.strictEqual(actualizado?.titulo, "Diario Corregido");
  assert.deepStrictEqual(actualizado?.paginas, ["Nueva primera página."]);
  assert.strictEqual(actualizado?.id, creado.id, "sigue siendo el MISMO libro, no uno nuevo");
  await bd.cerrar();
});

test("paginas guarda y devuelve un array real (JSON de ida y vuelta, no una cadena)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("escritor1");
  const creado = await bd.crearLibroGenerado(libro(jugador.id, { paginas: ["Página 1", "Página 2", "Página 3"] }));
  const encontrado = await bd.obtenerLibroGenerado(creado.id);
  assert.ok(Array.isArray(encontrado?.paginas));
  assert.strictEqual(encontrado?.paginas.length, 3);
  await bd.cerrar();
});
