// Tests de la persistencia de barcos (docs/GDD_Barcos.md, pedido
// 2026-08-30: "los barcos son objetos que también se bakearán como
// muebles... se colocan junto al agua"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";

test("crearBarco: ancla en el mapa/posición pedidos", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const barco = await bd.crearBarco(jugador.id, "barco_2", "principal", 12.5, 30.5);
  assert.strictEqual(barco.jugadorId, jugador.id);
  assert.strictEqual(barco.tipoId, "barco_2");
  assert.strictEqual(barco.mapaId, "principal");
  assert.strictEqual(barco.x, 12.5);
  assert.strictEqual(barco.y, 30.5);
  await bd.cerrar();
});

test("listarBarcosDe: solo los del mapa pedido", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  await bd.crearBarco(jugador.id, "barco_1", "principal", 1, 1);
  await bd.crearBarco(jugador.id, "barco_3", "test_mar_a", 2, 2);
  const dePrincipal = await bd.listarBarcosDe("principal");
  assert.strictEqual(dePrincipal.length, 1);
  assert.strictEqual(dePrincipal[0].tipoId, "barco_1");
  const deOtroMapa = await bd.listarBarcosDe("mapa_inexistente");
  assert.strictEqual(deOtroMapa.length, 0);
  await bd.cerrar();
});

test("actualizarPosicionBarco: cambia mapaId+x+y (usado al desembarcar y al cruzar de mapa)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const barco = await bd.crearBarco(jugador.id, "barco_1", "test_mar_a", 15, 8);
  await bd.actualizarPosicionBarco(barco.id, "test_mar_b", 1, 8);
  const enOrigen = await bd.listarBarcosDe("test_mar_a");
  assert.strictEqual(enOrigen.length, 0, "ya no debe estar en el mapa de origen");
  const enDestino = await bd.listarBarcosDe("test_mar_b");
  assert.strictEqual(enDestino.length, 1);
  assert.strictEqual(enDestino[0].x, 1);
  assert.strictEqual(enDestino[0].y, 8);
  await bd.cerrar();
});
