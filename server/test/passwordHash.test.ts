// Tests de admin/passwordHash.ts (pedido 2026-08-30, login de admin).
import { test } from "node:test";
import * as assert from "node:assert";
import { hashPassword, verificarPassword } from "../src/admin/passwordHash";

test("hashPassword: nunca guarda la contraseña en claro", () => {
  const hash = hashPassword("miContraseñaSecreta");
  assert.ok(!hash.includes("miContraseñaSecreta"));
  assert.match(hash, /^[0-9a-f]+:[0-9a-f]+$/);
});

test("hashPassword: la misma contraseña da hashes DISTINTOS (salt aleatoria)", () => {
  const a = hashPassword("igual");
  const b = hashPassword("igual");
  assert.notStrictEqual(a, b);
});

test("verificarPassword: acepta la contraseña correcta", () => {
  const hash = hashPassword("correcta123");
  assert.strictEqual(verificarPassword("correcta123", hash), true);
});

test("verificarPassword: rechaza una contraseña incorrecta", () => {
  const hash = hashPassword("correcta123");
  assert.strictEqual(verificarPassword("incorrecta", hash), false);
});

test("verificarPassword: formato inesperado no lanza, devuelve false", () => {
  assert.strictEqual(verificarPassword("cualquiera", "no_es_un_hash_valido"), false);
  assert.strictEqual(verificarPassword("cualquiera", ""), false);
  assert.strictEqual(verificarPassword("cualquiera", "solosalt:"), false);
});
