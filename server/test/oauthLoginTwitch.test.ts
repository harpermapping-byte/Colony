// Tests de twitch/oauthLogin.ts (docs/GDD_Twitch.md §7, pedido 2026-08-30:
// "que el jugador se conecte con su cuenta de Twitch aunque su PJ tenga
// otro nombre"). Solo lo que no llama de verdad a la API de Twitch
// (generarUrlAutorizacion/estadoValido/crearSesionTwitch/resolverSesionTwitch,
// puras aparte de crypto.randomBytes) — intercambiarCodigoPorIdentidad
// necesita credenciales reales, sin cubrir aquí. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  credencialesConfiguradas,
  crearSesionTwitch,
  estadoValido,
  generarUrlAutorizacion,
  resolverSesionTwitch,
} from "../src/twitch/oauthLogin";

test("credencialesConfiguradas: false si falta cualquiera de las 3 variables de entorno", () => {
  const guardado = { id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET, redirect: process.env.TWITCH_REDIRECT_URI };
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  delete process.env.TWITCH_REDIRECT_URI;
  assert.strictEqual(credencialesConfiguradas(), false);

  process.env.TWITCH_CLIENT_ID = "id";
  process.env.TWITCH_CLIENT_SECRET = "secret";
  assert.strictEqual(credencialesConfiguradas(), false, "falta TWITCH_REDIRECT_URI");

  process.env.TWITCH_REDIRECT_URI = "https://ejemplo.test/auth/twitch/callback";
  assert.strictEqual(credencialesConfiguradas(), true);

  // restaurar el entorno tal cual estaba
  if (guardado.id === undefined) delete process.env.TWITCH_CLIENT_ID; else process.env.TWITCH_CLIENT_ID = guardado.id;
  if (guardado.secret === undefined) delete process.env.TWITCH_CLIENT_SECRET; else process.env.TWITCH_CLIENT_SECRET = guardado.secret;
  if (guardado.redirect === undefined) delete process.env.TWITCH_REDIRECT_URI; else process.env.TWITCH_REDIRECT_URI = guardado.redirect;
});

test("generarUrlAutorizacion: apunta a Twitch con client_id/redirect_uri/state", () => {
  process.env.TWITCH_CLIENT_ID = "mi_client_id";
  process.env.TWITCH_REDIRECT_URI = "https://ejemplo.test/auth/twitch/callback";
  const url = new URL(generarUrlAutorizacion());
  assert.strictEqual(url.hostname, "id.twitch.tv");
  assert.strictEqual(url.searchParams.get("client_id"), "mi_client_id");
  assert.strictEqual(url.searchParams.get("redirect_uri"), "https://ejemplo.test/auth/twitch/callback");
  assert.strictEqual(url.searchParams.get("response_type"), "code");
  assert.ok(url.searchParams.get("state"), "trae un state");
});

test("estadoValido: el state que generó generarUrlAutorizacion es válido UNA vez, y solo una", () => {
  process.env.TWITCH_CLIENT_ID = "x";
  process.env.TWITCH_REDIRECT_URI = "https://ejemplo.test/cb";
  const url = new URL(generarUrlAutorizacion());
  const state = url.searchParams.get("state")!;
  assert.strictEqual(estadoValido(state), true);
  assert.strictEqual(estadoValido(state), false, "un state ya consumido no vale una segunda vez");
});

test("estadoValido: null o inventado siempre es inválido", () => {
  assert.strictEqual(estadoValido(null), false);
  assert.strictEqual(estadoValido("un_state_que_nunca_se_generó"), false);
});

test("crearSesionTwitch + resolverSesionTwitch: la identidad viaja entera, y el token se puede reusar (cruzar un portal es una conexión Colyseus nueva)", () => {
  const token = crearSesionTwitch({ twitchUserId: "12345", twitchLogin: "ragnarok_tv" });
  const identidad = resolverSesionTwitch(token);
  assert.deepStrictEqual(identidad, { twitchUserId: "12345", twitchLogin: "ragnarok_tv" });
  // segunda resolución (p.ej. al cruzar un portal a otra room) — el MISMO token sigue sirviendo
  assert.deepStrictEqual(resolverSesionTwitch(token), { twitchUserId: "12345", twitchLogin: "ragnarok_tv" });
});

test("resolverSesionTwitch: token inventado devuelve null (no rompe)", () => {
  assert.strictEqual(resolverSesionTwitch("token_que_nunca_existió"), null);
});
