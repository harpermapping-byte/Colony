import { test } from "node:test";
import assert from "node:assert/strict";
import { esAccionOcupada, fraseCharla, mostrandoCharla } from "../src/npc/actividadAmbientalNpc";

// Pedido streamer 2026-09-13: "los NPC que hacen acciones de trabajo etc
// deberían tener animación... deben estar animados si conversan entre
// ellos etc, y las conversaciones se ven encima de sus cabezas". Suite de
// las funciones PURAS que deciden pose ("trabajando") y contenido de la
// burbuja de charla — sin THREE/DOM, mismo criterio que rigHumanoide.test.ts.
// Ejecutar: node --import tsx --test client/test/actividadAmbientalNpc.test.ts

test("esAccionOcupada: acciones de trabajo/venta/culto real cuentan como ocupado", () => {
  assert.equal(esAccionOcupada("trabajar"), true);
  assert.equal(esAccionOcupada("vender"), true);
  assert.equal(esAccionOcupada("entrenar"), true);
  assert.equal(esAccionOcupada("orar"), true);
  assert.equal(esAccionOcupada("cotillear"), true);
  assert.equal(esAccionOcupada("craftear"), false); // solo se usaba antes; ya no hace falta declararlo aparte aquí (no es una accion real de rutina)
});

test("esAccionOcupada: deja intactas las poses/quietudes intencionadas", () => {
  assert.equal(esAccionOcupada("pasear"), false); // ya anima con la marcha real
  assert.equal(esAccionOcupada("dormir"), false); // pose de dormir aparte
  assert.equal(esAccionOcupada("estatua"), false); // DEBE quedarse inmóvil a propósito
  assert.equal(esAccionOcupada("tambalear"), false);
  assert.equal(esAccionOcupada("vigilar"), false);
});

test("esAccionOcupada: undefined/null/vacío nunca revienta", () => {
  assert.equal(esAccionOcupada(undefined), false);
  assert.equal(esAccionOcupada(null), false);
  assert.equal(esAccionOcupada(""), false);
});

test("fraseCharla: null para una acción que no conversa", () => {
  assert.equal(fraseCharla("trabajar", "npc_1", 0), null);
  assert.equal(fraseCharla(undefined, "npc_1", 0), null);
});

test("fraseCharla: siempre una frase real del catálogo para las acciones de charla", () => {
  for (const accion of ["socializar", "cotillear", "contar_historias", "profetizar"]) {
    const frase = fraseCharla(accion, "npc_42", 100);
    assert.equal(typeof frase, "string");
    assert.ok(frase && frase.length > 0);
  }
});

test("fraseCharla: determinista — mismo NPC y mismo instante siempre da la misma frase", () => {
  const a = fraseCharla("socializar", "npc_abc", 37);
  const b = fraseCharla("socializar", "npc_abc", 37);
  assert.equal(a, b);
});

test("fraseCharla: dos NPCs distintos en el mismo instante pueden decir cosas distintas", () => {
  const frases = new Set<string | null>();
  for (let i = 0; i < 12; i++) frases.add(fraseCharla("socializar", `npc_${i}`, 0));
  assert.ok(frases.size > 1, "todos los NPCs dijeron exactamente la misma frase a la vez");
});

test("fraseCharla: el mismo NPC cambia de frase entre ciclos distintos", () => {
  const frasesEnElTiempo = new Set<string | null>();
  for (let ciclo = 0; ciclo < 8; ciclo++) frasesEnElTiempo.add(fraseCharla("cotillear", "npc_fijo", ciclo * 16));
  assert.ok(frasesEnElTiempo.size > 1, "el NPC repitió la misma frase en todos los ciclos");
});

test("mostrandoCharla: alterna entre mostrar y ocultar a lo largo del ciclo (nunca todo el rato)", () => {
  let mostrando = 0;
  let ocultando = 0;
  for (let t = 0; t < 16; t++) {
    if (mostrandoCharla("npc_x", t)) mostrando++;
    else ocultando++;
  }
  assert.ok(mostrando > 0 && ocultando > 0);
});
