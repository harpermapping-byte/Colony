// Tests de twitch/titulos.ts (docs/GDD_Twitch.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { resolverRol, tituloDe } from "../src/twitch/titulos";

const SIN_ROL = { esMod: false, esVip: false, esSub: false, tierSub: 0 as const };

test("resolverRol: nadie es nada → 'ninguno' (sin título, pedido literal)", () => {
  assert.strictEqual(resolverRol(SIN_ROL, false, false), "ninguno");
  assert.strictEqual(resolverRol(SIN_ROL, false, undefined), "ninguno");
});

test("resolverRol: seguidor sin ningún otro rol → 'seguidor'", () => {
  assert.strictEqual(resolverRol(SIN_ROL, false, true), "seguidor");
});

test("resolverRol: sub (cualquier tier) → 'sub'", () => {
  assert.strictEqual(resolverRol({ ...SIN_ROL, esSub: true, tierSub: 1 }, false, false), "sub");
  assert.strictEqual(resolverRol({ ...SIN_ROL, esSub: true, tierSub: 3 }, false, false), "sub");
});

test("resolverRol: moderador → 'moderador', por encima de sub", () => {
  assert.strictEqual(resolverRol({ esMod: true, esVip: false, esSub: true, tierSub: 2 }, false, false), "moderador");
});

test("resolverRol: jarl/admin manda por encima de todo lo demás", () => {
  assert.strictEqual(resolverRol({ esMod: true, esVip: false, esSub: true, tierSub: 3 }, true, true), "jarl");
});

test("tituloDe: cada rol da el título esperado, jarl da el nombre del streamer literal", () => {
  assert.strictEqual(tituloDe("ninguno", "Ragnar"), "");
  assert.strictEqual(tituloDe("seguidor", "Ragnar"), "Condellano");
  assert.strictEqual(tituloDe("sub", "Ragnar"), "Cortesano");
  assert.strictEqual(tituloDe("moderador", "Ragnar"), "Arguiñano");
  assert.strictEqual(tituloDe("jarl", "Ragnar"), "Ragnar");
});
