import { test } from "node:test";
import * as assert from "node:assert";
import { elegirArena } from "../src/combate/seleccionArena";

test("elegirArena: determinista — mismo combateId, misma arena", () => {
  const arenas = ["a", "b", "c"];
  assert.strictEqual(elegirArena("combate:x:1", arenas), elegirArena("combate:x:1", arenas));
});

test("elegirArena: siempre devuelve una arena real del catálogo", () => {
  const arenas = ["pradera_01", "bosque_01"];
  for (const id of ["combate:1", "combate:2", "combate:3", "combate:4", "combate:5"]) {
    assert.ok(arenas.includes(elegirArena(id, arenas)));
  }
});

test("elegirArena: catálogo vacío lanza (nunca elige de la nada)", () => {
  assert.throws(() => elegirArena("x", []));
});
