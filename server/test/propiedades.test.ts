// Tests de la lógica PURA de propiedades comerciales (server/src/propiedades/propiedades.ts).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  cargarPreciosPropiedad,
  ventaJugadorPermitida,
  salasAlquilablesPermitidas,
  precioInmueble,
  precioHabitacion,
} from "../src/propiedades/propiedades";

test("cargarPreciosPropiedad: catálogo con las 3 riquezas y las 2 habitaciones", () => {
  const precios = cargarPreciosPropiedad();
  for (const riqueza of ["humilde", "modesta", "noble"]) {
    assert.ok(precios.porRiqueza[riqueza], `falta riqueza ${riqueza}`);
    assert.ok(precios.porRiqueza[riqueza].compra! > 0);
    assert.ok(precios.porRiqueza[riqueza].alquilerPeriodo > 0);
  }
  assert.ok(precios.habitacion.dormitorio_individual);
  assert.ok(precios.habitacion.dormitorio_comunal);
  assert.strictEqual(precios.habitacion.dormitorio_comunal.compra, null, "el dormitorio comunal no se compra, solo se alquila");
});

test("ventaJugadorPermitida: solo los tipos marcados en el catálogo", () => {
  for (const tipo of ["casa_humilde", "choza_pescador", "tienda", "casa_noble", "taberna"]) {
    assert.strictEqual(ventaJugadorPermitida(tipo), true, `${tipo} debería ser vendible`);
  }
  assert.strictEqual(ventaJugadorPermitida("castillo"), false, "un edificio sin ventaJugador no es vendible");
  assert.strictEqual(ventaJugadorPermitida("tipo_inventado"), false, "un tipo desconocido nunca es vendible");
});

test("salasAlquilablesPermitidas: solo taberna y posada", () => {
  assert.strictEqual(salasAlquilablesPermitidas("taberna"), true);
  assert.strictEqual(salasAlquilablesPermitidas("posada"), true);
  assert.strictEqual(salasAlquilablesPermitidas("casa_humilde"), false, "una vivienda privada no alquila habitaciones sueltas");
});

test("precioInmueble: compra y alquiler dependen de la riqueza del tipo de edificio", () => {
  const humilde = precioInmueble("casa_humilde", "compra"); // riqueza humilde
  const noble = precioInmueble("casa_noble", "compra"); // riqueza noble
  assert.ok(humilde && noble);
  assert.ok(noble!.precio > humilde!.precio, "una casa noble debe costar más que una humilde");

  const alquiler = precioInmueble("tienda", "alquiler");
  assert.ok(alquiler);
  assert.ok(alquiler!.periodoHoras! > 0);
});

test("precioInmueble: tipo de edificio desconocido cae en riqueza 'modesta' por defecto", () => {
  const desconocido = precioInmueble("tipo_inventado", "compra");
  const modesta = precioInmueble("tienda", "compra"); // tienda es riqueza modesta
  assert.deepStrictEqual(desconocido, modesta);
});

test("precioHabitacion: dormitorio_comunal solo alquiler, dormitorio_individual compra o alquiler", () => {
  assert.strictEqual(precioHabitacion("dormitorio_comunal", "compra"), null);
  assert.ok(precioHabitacion("dormitorio_comunal", "alquiler"));
  assert.ok(precioHabitacion("dormitorio_individual", "compra"));
  assert.ok(precioHabitacion("dormitorio_individual", "alquiler"));
});
