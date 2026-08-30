// Tests de la persistencia de enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";
import { enfermedadesInicial } from "../src/personaje/enfermedades";

test("obtenerOCrearJugador: enfermedades arranca en null (nunca se ha tocado)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(jugador.enfermedades, null);
  await bd.cerrar();
});

test("actualizarEnfermedadesJugador: guarda y se puede releer tal cual (JSON)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const enfermedades = enfermedadesInicial();
  enfermedades.catarroDesde = 12345;
  enfermedades.unguentosTomados = 2;
  enfermedades.gripeDesde = 6789;
  await bd.actualizarEnfermedadesJugador(jugador.id, JSON.stringify(enfermedades));
  const releido = await bd.obtenerOCrearJugador("Ragnar");
  assert.ok(releido.enfermedades);
  const parseado = JSON.parse(releido.enfermedades!);
  assert.strictEqual(parseado.catarroDesde, 12345);
  assert.strictEqual(parseado.unguentosTomados, 2);
  assert.strictEqual(parseado.gripeDesde, 6789);
  await bd.cerrar();
});
