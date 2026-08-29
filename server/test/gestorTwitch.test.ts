// Tests de twitch/gestorTwitch.ts (docs/GDD_Twitch.md, pedido 2026-08-30).
// Solo lo que NO toca BD real (comandos de chat, roles, cooldown/gating de
// canjes "malos" — sin BD de por medio): "lluvia_dinero"/"bendicion_gremio"
// (el pool "bueno") si tocan BD vía obtenerBdCompartida(), que sin BD_RUTA
// configurado abriría el SQLite de desarrollo — se dejan fuera de este
// archivo a propósito, mismo cuidado que ya tomó `combate.e2e.mjs` con
// BD_RUTA=":memory:" para no pisar datos reales. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { GestorTwitch, _resetGestorTwitchParaTests } from "../src/twitch/gestorTwitch";
import { _resetRegistroParaTests, registrarJugador, RoomConectable } from "../src/twitch/registro";

function roomEspia() {
  const llamadas: { metodo: string; args: unknown[] }[] = [];
  const room: RoomConectable = {
    aplicarEventoTwitch: (...args) => llamadas.push({ metodo: "aplicarEventoTwitch", args }),
    curarCompleto: (...args) => llamadas.push({ metodo: "curarCompleto", args }),
    llenarVital: (...args) => llamadas.push({ metodo: "llenarVital", args }),
    vaciarCaca: (...args) => llamadas.push({ metodo: "vaciarCaca", args }),
    fijarTituloTwitch: (...args) => llamadas.push({ metodo: "fijarTituloTwitch", args }),
  };
  return { room, llamadas };
}

function prepararGestorEnDirecto(): GestorTwitch {
  _resetGestorTwitchParaTests();
  const gestor = new GestorTwitch();
  gestor.fijarEnDirecto(true);
  return gestor;
}

test("manejarComandoChat: '!curar' llama a curarCompleto del jugador correcto", () => {
  _resetRegistroParaTests();
  const { room, llamadas } = roomEspia();
  registrarJugador("Ragnar", room, "sess1");
  const gestor = prepararGestorEnDirecto();

  gestor.manejarComandoChat("Ragnar", "!curar");
  assert.deepStrictEqual(llamadas, [{ metodo: "curarCompleto", args: ["sess1"] }]);
});

test("manejarComandoChat: '!comer'/'!beber'/'!cagar' llaman al método correcto", () => {
  _resetRegistroParaTests();
  const { room, llamadas } = roomEspia();
  registrarJugador("Ragnar", room, "sess1");
  const gestor = prepararGestorEnDirecto();

  gestor.manejarComandoChat("Ragnar", "!comer");
  gestor.manejarComandoChat("Ragnar", "!beber");
  gestor.manejarComandoChat("Ragnar", "!cagar");
  assert.deepStrictEqual(llamadas.map((l) => l.metodo), ["llenarVital", "llenarVital", "vaciarCaca"]);
  assert.deepStrictEqual(llamadas[0].args, ["sess1", "comida"]);
  assert.deepStrictEqual(llamadas[1].args, ["sess1", "bebida"]);
});

test("manejarComandoChat: sin partida activa (nombre no registrado) es un no-op silencioso", () => {
  _resetRegistroParaTests();
  const gestor = prepararGestorEnDirecto();
  assert.doesNotThrow(() => gestor.manejarComandoChat("Nadie", "!curar"));
});

test("manejarComandoChat: fuera de directo, ningún comando hace nada (Modo Live)", () => {
  _resetRegistroParaTests();
  const { room, llamadas } = roomEspia();
  registrarJugador("Ragnar", room, "sess1");
  _resetGestorTwitchParaTests();
  const gestor = new GestorTwitch();
  gestor.fijarEnDirecto(false);

  gestor.manejarComandoChat("Ragnar", "!curar");
  assert.deepStrictEqual(llamadas, []);
});

test("manejarComandoChat: un mensaje que no es comando (sin '!') no hace nada", () => {
  _resetRegistroParaTests();
  const { room, llamadas } = roomEspia();
  registrarJugador("Ragnar", room, "sess1");
  const gestor = prepararGestorEnDirecto();
  gestor.manejarComandoChat("Ragnar", "hola a todos");
  assert.deepStrictEqual(llamadas, []);
});

test("actualizarRol: refresca el título vía fijarTituloTwitch según el rol de chat", () => {
  _resetRegistroParaTests();
  const { room, llamadas } = roomEspia();
  registrarJugador("Ragnar", room, "sess1");
  const gestor = prepararGestorEnDirecto();

  gestor.actualizarRol("Ragnar", { esMod: false, esVip: false, esSub: true, tierSub: 1 });
  assert.deepStrictEqual(llamadas, [{ metodo: "fijarTituloTwitch", args: ["sess1", "Cortesano"] }]);
});

test("intentarCanje('malo'): ok, respeta cooldown de 5 min tras el primer canje", () => {
  const gestor = prepararGestorEnDirecto();
  const r1 = gestor.intentarCanje("malo");
  assert.strictEqual(r1.ok, true);
  const r2 = gestor.intentarCanje("malo");
  assert.strictEqual(r2.ok, false);
});

test("intentarCanje: fuera de directo, se rechaza sin tocar cooldown", () => {
  _resetGestorTwitchParaTests();
  const gestor = new GestorTwitch();
  gestor.fijarEnDirecto(false);
  const r = gestor.intentarCanje("malo");
  assert.strictEqual(r.ok, false);
});
