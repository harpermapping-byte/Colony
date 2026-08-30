// Tests de la persistencia de anatomía (docs/GDD_Anatomia.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";
import { anatomiaInicial } from "../src/personaje/anatomia";

test("obtenerOCrearJugador: anatomia arranca en null (nunca se ha tocado)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(jugador.anatomia, null);
  await bd.cerrar();
});

test("actualizarAnatomiaJugador: guarda y se puede releer tal cual (JSON)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const anatomia = anatomiaInicial();
  anatomia.brazoIzq.sangrado = true;
  anatomia.piernaDer.amputado = true;
  await bd.actualizarAnatomiaJugador(jugador.id, JSON.stringify(anatomia));
  const releido = await bd.obtenerOCrearJugador("Ragnar");
  assert.ok(releido.anatomia);
  const parseado = JSON.parse(releido.anatomia!);
  assert.strictEqual(parseado.brazoIzq.sangrado, true);
  assert.strictEqual(parseado.piernaDer.amputado, true);
  assert.strictEqual(parseado.torso.sangrado, false);
  await bd.cerrar();
});
