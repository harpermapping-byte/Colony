// Tests de la persistencia de platos cocinados (docs/GDD_Cocina.md, pedido
// 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, PlatoCreado } from "../src/datos/bd";

function plato(overrides: Partial<PlatoCreado> = {}): PlatoCreado {
  return {
    clave: "carne_roja|zanahoria",
    itemId: "plato_abc123",
    nombre: "Guiso de Zanahoria y Carne Roja",
    ingredientes: ["carne_roja", "zanahoria"],
    vida: 5,
    estamina: 1,
    comida: 8,
    bebida: 0,
    colorDebug: "#c98a4a",
    creadoEn: new Date().toISOString(),
    ...overrides,
  };
}

test("crearPlatoCreado + buscarPlatoPorClave: se guarda y recupera tal cual", async () => {
  const bd = new AlmacenDatos(":memory:");
  const original = plato();
  await bd.crearPlatoCreado(original);
  const encontrado = await bd.buscarPlatoPorClave("carne_roja|zanahoria");
  assert.deepStrictEqual(encontrado, original);
  await bd.cerrar();
});

test("buscarPlatoPorClave: null si esa combinación nunca se cocinó", async () => {
  const bd = new AlmacenDatos(":memory:");
  const encontrado = await bd.buscarPlatoPorClave("no|existe");
  assert.strictEqual(encontrado, null);
  await bd.cerrar();
});

test("listarPlatosCreados: varios platos, todos presentes", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearPlatoCreado(plato({ clave: "zanahoria", itemId: "plato_1", nombre: "Sopa de Zanahoria", ingredientes: ["zanahoria"] }));
  await bd.crearPlatoCreado(plato({ clave: "fresa|miel", itemId: "plato_2", nombre: "Estofado de Fresa y Miel", ingredientes: ["fresa", "miel"] }));
  const lista = await bd.listarPlatosCreados();
  assert.strictEqual(lista.length, 2);
  assert.ok(lista.some((p) => p.itemId === "plato_2" && p.nombre === "Estofado de Fresa y Miel"));
  await bd.cerrar();
});
