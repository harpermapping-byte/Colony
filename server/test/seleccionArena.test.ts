import { test } from "node:test";
import * as assert from "node:assert";
import { elegirArena, EntradaArena } from "../src/combate/seleccionArena";

const TIERRA: EntradaArena[] = [
  { id: "pradera_01", terreno: "tierra" },
  { id: "bosque_01", terreno: "tierra" },
];
const MIXTO: EntradaArena[] = [...TIERRA, { id: "mar_01", terreno: "agua" }];

test("elegirArena: determinista — mismo combateId, misma arena", () => {
  assert.strictEqual(elegirArena("combate:x:1", MIXTO), elegirArena("combate:x:1", MIXTO));
});

test("elegirArena: siempre devuelve una arena real del catálogo", () => {
  for (const id of ["combate:1", "combate:2", "combate:3", "combate:4", "combate:5"]) {
    assert.ok(TIERRA.some((a) => a.id === elegirArena(id, TIERRA)));
  }
});

test("elegirArena: catálogo vacío lanza (nunca elige de la nada)", () => {
  assert.throws(() => elegirArena("x", []));
});

// docs/GDD_Barcos.md (pedido 2026-08-30) — combate acuático
test("elegirArena: terreno='agua' elige SOLO entre las de agua", () => {
  for (const id of ["combate:1", "combate:2", "combate:3", "combate:4", "combate:5"]) {
    assert.strictEqual(elegirArena(id, MIXTO, "agua"), "mar_01");
  }
});

test("elegirArena: terreno='tierra' nunca elige la de agua", () => {
  for (const id of ["combate:1", "combate:2", "combate:3", "combate:4", "combate:5"]) {
    assert.notStrictEqual(elegirArena(id, MIXTO, "tierra"), "mar_01");
  }
});

test("elegirArena: pedir un terreno sin ninguna arena todavía cae al catálogo completo (no rompe el combate)", () => {
  const soloTierra: EntradaArena[] = TIERRA;
  const elegida = elegirArena("combate:x", soloTierra, "agua");
  assert.ok(soloTierra.some((a) => a.id === elegida));
});
