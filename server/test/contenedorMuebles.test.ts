// Tests de inventario/contenedorMuebles.ts (docs/GDD_Carros.md §8.3, propuesta
// 2026-09-04 — inventario por capacidad de muebles, no rejilla).
import { test } from "node:test";
import * as assert from "node:assert";
import { crearContenedorMuebles, capacidadUsada, cabeMueble, meterMueble, sacarMueble } from "../src/inventario/contenedorMuebles";

test("crearContenedorMuebles: nace vacío con la capacidad pedida", () => {
  const c = crearContenedorMuebles(30);
  assert.strictEqual(c.capacidadMax, 30);
  assert.strictEqual(capacidadUsada(c), 0);
  assert.strictEqual(cabeMueble(c, 30), true);
  assert.strictEqual(cabeMueble(c, 31), false);
});

test("meterMueble: acumula capacidadUsada correctamente por tamaño real, no por unidad", () => {
  const c = crearContenedorMuebles(10);
  assert.strictEqual(meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: 1 }).ok, true);
  assert.strictEqual(meterMueble(c, { instanciaId: 2, itemId: "mesa_comedor", tamano: 3 }).ok, true);
  assert.strictEqual(capacidadUsada(c), 4);
  assert.strictEqual(cabeMueble(c, 6), true);
  assert.strictEqual(cabeMueble(c, 7), false);
});

test("meterMueble: rechaza cuando no cabe, sin modificar el contenedor (todo o nada)", () => {
  const c = crearContenedorMuebles(5);
  assert.strictEqual(meterMueble(c, { instanciaId: 1, itemId: "cama_individual", tamano: 3 }).ok, true);
  const r = meterMueble(c, { instanciaId: 2, itemId: "cama_individual", tamano: 3 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_capacidad");
  assert.strictEqual(capacidadUsada(c), 3); // el segundo mueble NO entró
  assert.strictEqual(c.muebles.length, 1);
});

test("meterMueble: rechaza tamaño no positivo y una misma instancia dos veces", () => {
  const c = crearContenedorMuebles(30);
  assert.strictEqual(meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: 0 }).motivo, "tamano_invalido");
  assert.strictEqual(meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: -1 }).motivo, "tamano_invalido");
  assert.strictEqual(meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: 1 }).ok, true);
  const r = meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "ya_dentro");
});

test("sacarMueble: libera capacidad real y permite volver a meter otro más grande", () => {
  const c = crearContenedorMuebles(3);
  meterMueble(c, { instanciaId: 1, itemId: "arcon", tamano: 2 });
  assert.strictEqual(cabeMueble(c, 2), false); // solo queda 1 libre
  assert.strictEqual(sacarMueble(c, 1).ok, true);
  assert.strictEqual(capacidadUsada(c), 0);
  assert.strictEqual(meterMueble(c, { instanciaId: 2, itemId: "mesa_comedor", tamano: 3 }).ok, true);
});

test("sacarMueble: instancia inexistente se rechaza sin tocar nada", () => {
  const c = crearContenedorMuebles(10);
  meterMueble(c, { instanciaId: 1, itemId: "silla", tamano: 1 });
  const r = sacarMueble(c, 999);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "no_encontrado");
  assert.strictEqual(c.muebles.length, 1);
});

test("30 muebles pequeños de tamaño 1 caben en capacidad 30, el 31 no (pedido literal: '20 o 30 dependiendo tamaño')", () => {
  const c = crearContenedorMuebles(30);
  for (let i = 0; i < 30; i++) assert.strictEqual(meterMueble(c, { instanciaId: i, itemId: "silla", tamano: 1 }).ok, true);
  assert.strictEqual(meterMueble(c, { instanciaId: 30, itemId: "silla", tamano: 1 }).ok, false);
});
