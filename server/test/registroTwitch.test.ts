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
  quitarJugador("Ragnar", "sess1");
  assert.strictEqual(buscarConexion("Ragnar"), undefined);
});

test("quitarJugador: nombres duplicados — la sesión que se desconecta NO se lleva por delante al que se queda (bug real encontrado en revisión multi-jugador)", () => {
  _resetRegistroParaTests();
  const roomA = roomFalsa();
  const roomB = roomFalsa();
  registrarJugador("Ragnar", roomA, "sessA"); // jugador A entra primero
  registrarJugador("Ragnar", roomB, "sessB"); // jugador B entra con el MISMO nombre — B "gana" el registro
  quitarJugador("Ragnar", "sessA"); // A se desconecta — su quitarJugador NO debe tocar el registro de B
  assert.strictEqual(buscarConexion("Ragnar")?.sessionId, "sessB", "B sigue registrado, A ya no estaba registrado de todas formas");
  assert.strictEqual(buscarConexion("Ragnar")?.room, roomB);
});

test("quitarJugador: la sesión que SÍ tiene el registro actual se quita con normalidad", () => {
  _resetRegistroParaTests();
  const roomA = roomFalsa();
  const roomB = roomFalsa();
  registrarJugador("Ragnar", roomA, "sessA");
  registrarJugador("Ragnar", roomB, "sessB");
  quitarJugador("Ragnar", "sessB"); // B (el registro actual) se desconecta
  assert.strictEqual(buscarConexion("Ragnar"), undefined);
});

test("registrarJugador: con login de Twitch, la clave es el LOGIN real, no el nombre del PJ (docs/GDD_Twitch.md §7)", () => {
  _resetRegistroParaTests();
  const room = roomFalsa();
  registrarJugador("ElJarlDelPueblo", room, "sess1", "ragnarok_tv"); // PJ con un nombre, cuenta de Twitch con otro
  assert.strictEqual(buscarConexion("ragnarok_tv")?.sessionId, "sess1", "se encuentra por el LOGIN de Twitch");
  assert.strictEqual(buscarConexion("ElJarlDelPueblo"), undefined, "NO por el nombre del PJ — esa es la clave sin login");
});

test("registrarJugador + quitarJugador: dos PJ con el MISMO nombre pero login de Twitch distinto no se pisan (el problema que login real resuelve de raíz)", () => {
  _resetRegistroParaTests();
  const roomA = roomFalsa();
  const roomB = roomFalsa();
  registrarJugador("Guerrero", roomA, "sessA", "usuarioA");
  registrarJugador("Guerrero", roomB, "sessB", "usuarioB"); // mismo nombre de PJ, login de Twitch distinto
  assert.strictEqual(buscarConexion("usuarioA")?.sessionId, "sessA");
  assert.strictEqual(buscarConexion("usuarioB")?.sessionId, "sessB");
  quitarJugador("Guerrero", "sessA", "usuarioA");
  assert.strictEqual(buscarConexion("usuarioA"), undefined);
  assert.strictEqual(buscarConexion("usuarioB")?.sessionId, "sessB", "B no se ve afectado por la salida de A");
});

test("quitarJugador: sin twitchLogin en ninguna de las dos llamadas, sigue por nombre de PJ (compatibilidad con jugadores sin login)", () => {
  _resetRegistroParaTests();
  registrarJugador("Ragnar", roomFalsa(), "sess1"); // sin login
  quitarJugador("Ragnar", "sess1"); // sin login
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
