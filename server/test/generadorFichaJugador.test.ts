// Tests del creador de personaje del jugador (docs/GDD_Personaje.md, pedido
// streamer 2026-09-10: "Creador completo elegible por el jugador... adelante")
// — la pieza que valida contra el catálogo real y nunca confía en el tipo/
// forma de lo que mande el cliente (misma lección que el bug crítico de
// GDD_Cuentas.md §5quater: la ruta HTTP que llama a esto es pública).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { generarFichaJugador } from "../src/personaje/generadorFichaJugador";

test("generarFichaJugador: una elección válida se respeta tal cual", () => {
  const r = generarFichaJugador(
    { sexo: "mujer", peloEstilo: "melena_larga", barbaEstilo: "ninguna", peloColorId: "rubio", pielColorId: "morena", ojosColorId: "verde", altura: 1.05, corpulencia: 0.9 },
    "prueba-1",
  );
  assert.strictEqual(r.ficha.sexo, "mujer");
  assert.strictEqual(r.ficha.morfologia.sexo, "mujer");
  assert.strictEqual(r.ficha.morfologia.altura, 1.05);
  assert.strictEqual(r.ficha.morfologia.corpulencia, 0.9);
  assert.strictEqual(r.ficha.rasgos.peloEstilo, "melena_larga");
  assert.strictEqual(r.ficha.rasgos.barbaEstilo, "ninguna");
  assert.strictEqual(r.ficha.rasgos.peloColor.id, "rubio");
  assert.strictEqual(r.ficha.rasgos.peloColor.hex, "#a88a4a");
  assert.strictEqual(r.ficha.rasgos.pielColor.id, "morena");
  assert.strictEqual(r.ficha.rasgos.ojosColor.id, "verde");
  assert.deepStrictEqual(r.ficha.ropa, [], "un jugador nunca trae ropa de civil propia — la real cuelga de lo equipado");
});

test("generarFichaJugador: un peinado real trae vóxeles de pelo, 'calvo' no trae ninguno", () => {
  const conPelo = generarFichaJugador({ peloEstilo: "melena", barbaEstilo: "ninguna" }, "x");
  assert.ok(conPelo.voxelesCabeza.length > 0);
  const calvo = generarFichaJugador({ peloEstilo: "calvo", barbaEstilo: "ninguna" }, "x");
  assert.strictEqual(calvo.voxelesCabeza.length, 0);
});

test("generarFichaJugador: id de peinado/barba/color inexistente cae a un valor por defecto seguro, nunca revienta", () => {
  const r = generarFichaJugador(
    { sexo: "cualquiercosa", peloEstilo: "no_existe", barbaEstilo: "tampoco", peloColorId: "inventado", pielColorId: "inventado", ojosColorId: "inventado" },
    "x",
  );
  assert.strictEqual(r.ficha.sexo, "hombre", "sexo desconocido cae a hombre");
  assert.strictEqual(r.ficha.rasgos.peloEstilo, "corto");
  assert.strictEqual(r.ficha.rasgos.barbaEstilo, "ninguna");
  assert.ok(r.ficha.rasgos.peloColor.hex.startsWith("#"));
  assert.ok(r.ficha.rasgos.pielColor.hex.startsWith("#"));
  assert.ok(r.ficha.rasgos.ojosColor.hex.startsWith("#"));
});

test("generarFichaJugador: nunca confía en el TIPO de lo que llegue — números/objetos/undefined en cada campo no revientan (misma clase de bug que el crítico de 2026-09-10)", () => {
  assert.doesNotThrow(() => {
    // @ts-expect-error — a propósito: simula un cliente malicioso/roto mandando tipos equivocados.
    generarFichaJugador({ sexo: 123, peloEstilo: {}, barbaEstilo: [], peloColorId: null, pielColorId: undefined, ojosColorId: true, altura: "alto", corpulencia: {} }, "x");
  });
  assert.doesNotThrow(() => generarFichaJugador(undefined as any, "x")); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.doesNotThrow(() => generarFichaJugador(null as any, "x")); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("generarFichaJugador: altura/corpulencia se acotan al rango real del rig, nunca se salen aunque se pida un extremo absurdo", () => {
  const extremo = generarFichaJugador({ altura: 999, corpulencia: -999 }, "x");
  assert.ok(extremo.ficha.morfologia.altura <= 1.12 && extremo.ficha.morfologia.altura >= 0.88);
  assert.ok(extremo.ficha.morfologia.corpulencia <= 1.2 && extremo.ficha.morfologia.corpulencia >= 0.85);
});

test("generarFichaJugador: los colores 'hueso'/'ceniciento'/'piedra' de coloresPiel (peso 0, reservados) nunca salen elegidos aunque se pidan explícitamente", () => {
  for (const idReservado of ["hueso", "ceniciento", "piedra"]) {
    const r = generarFichaJugador({ pielColorId: idReservado }, "x");
    assert.notStrictEqual(r.ficha.rasgos.pielColor.id, idReservado, `${idReservado} es una variante reservada, no elegible por un jugador`);
  }
});

test("generarFichaJugador: determinista — misma elección y misma semillaEstable dan el mismo resultado siempre", () => {
  const eleccion = { sexo: "hombre", peloEstilo: "rizado_afro", barbaEstilo: "barba_larga", peloColorId: "negro", pielColorId: "clara", ojosColorId: "azul", altura: 1.0, corpulencia: 1.0 };
  const a = generarFichaJugador(eleccion, "mismo-jugador");
  const b = generarFichaJugador(eleccion, "mismo-jugador");
  assert.deepStrictEqual(a.ficha, b.ficha);
  assert.deepStrictEqual(a.voxelesCabeza, b.voxelesCabeza);
});
