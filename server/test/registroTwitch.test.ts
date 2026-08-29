// Tests de twitch/registro.ts (docs/GDD_Twitch.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  registrarRoom, quitarRoom, registrarJugador, quitarJugador,
  buscarConexion, jugadoresConectados, roomsActivas, _resetRegistroParaTests, RoomConectable,
} from "../src/twitch/registro";

function roomFalsa(): RoomConectable {
  return {
    aplicarEventoTwitch: () => {},
    curarCompleto: () => {},
    llenarVital: () => {},
    vaciarCaca: () => {},
    fijarTituloTwitch: () => {},
  };
}

test("registrarJugador + buscarConexion: encuentra por nombre, insensible a mayúsculas", () => {
  _resetRegistroParaTests();
  const room = roomFalsa();
  registrarJugador("Ragnar", room, "sess1");
  assert.strictEqual(buscarConexion("ragnar")?.sessionId, "sess1");
  assert.strictEqual(buscarConexion("RAGNAR")?.room, room);
});

test("quitarJugador: ya no se encuentra tras salir", () => {
  _resetRegistroParaTests();
  registrarJugador("Ragnar", roomFalsa(), "sess1");
  quitarJugador("Ragnar");
  assert.strictEqual(buscarConexion("Ragnar"), undefined);
});

test("jugadoresConectados: lista todos los nombres registrados", () => {
  _resetRegistroParaTests();
  registrarJugador("Ragnar", roomFalsa(), "s1");
  registrarJugador("Lagertha", roomFalsa(), "s2");
  assert.deepStrictEqual(jugadoresConectados().sort(), ["lagertha", "ragnar"]);
});

test("registrarRoom/quitarRoom: roomsActivas refleja el registro", () => {
  _resetRegistroParaTests();
  const room = roomFalsa();
  registrarRoom(room);
  assert.strictEqual(roomsActivas().length, 1);
  quitarRoom(room);
  assert.strictEqual(roomsActivas().length, 0);
});
