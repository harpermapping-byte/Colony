// Motor de reglas de ajedrez (docs/GDD_Mesas_Minijuego.md) — PURO (sin
// Colyseus/BD), envoltorio sobre chess.js. Todos los escenarios se
// verificaron primero a mano contra chess.js real antes de fijarlos aquí
// (Fool's mate, la posición de ahogado, la promoción) para no depender de
// una intuición de ajedrez que resulte errónea.
import { test } from "node:test";
import * as assert from "node:assert";
import { aplicarMovimientoAjedrez, FEN_INICIAL_AJEDREZ } from "../src/construccion/ajedrez";

test("aplicarMovimientoAjedrez: movimiento legal desde la posición inicial cambia el FEN y pasa el turno a negras", () => {
  const r = aplicarMovimientoAjedrez(FEN_INICIAL_AJEDREZ, "e2", "e4");
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.terminado, false);
  assert.strictEqual(r.ganador, null);
  assert.strictEqual(r.turno, "negras");
  assert.notStrictEqual(r.fen, FEN_INICIAL_AJEDREZ);
  assert.match(r.fen, / b /); // el campo de turno del FEN pasa a "b" (negras)
});

test("aplicarMovimientoAjedrez: movimiento ilegal se rechaza con motivo, sin tocar el FEN de origen", () => {
  const r = aplicarMovimientoAjedrez(FEN_INICIAL_AJEDREZ, "e2", "e5"); // un peón no salta 3 casillas
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(typeof r.motivo, "string");
  assert.ok(r.motivo.length > 0);
});

test("aplicarMovimientoAjedrez: mover la pieza de un bando fuera de su turno se rechaza (no hace falta un chequeo de turno aparte, chess.js ya lo valida)", () => {
  // en la posición inicial le toca a blancas: intentar mover un peón negro es ilegal
  const r = aplicarMovimientoAjedrez(FEN_INICIAL_AJEDREZ, "e7", "e5");
  assert.strictEqual(r.ok, false);
});

test("aplicarMovimientoAjedrez: FEN de entrada corrupto se rechaza en vez de reventar", () => {
  const r = aplicarMovimientoAjedrez("esto no es un fen", "e2", "e4");
  assert.strictEqual(r.ok, false);
});

test("aplicarMovimientoAjedrez: Fool's mate (jaque mate más rápido, 4 medios-movimientos) — termina la partida y ganan negras", () => {
  let fen = FEN_INICIAL_AJEDREZ;
  const jugadas: [string, string][] = [
    ["f2", "f3"], // blancas
    ["e7", "e5"], // negras
    ["g2", "g4"], // blancas
    ["d8", "h4"], // negras: Qh4# — jaque mate
  ];
  let ultimo;
  for (const [desde, hasta] of jugadas) {
    ultimo = aplicarMovimientoAjedrez(fen, desde, hasta);
    assert.strictEqual(ultimo.ok, true, `jugada ${desde}-${hasta} debería ser legal`);
    if (!ultimo.ok) return;
    fen = ultimo.fen;
  }
  assert.strictEqual(ultimo!.ok, true);
  if (!ultimo!.ok) return;
  assert.strictEqual(ultimo!.terminado, true);
  assert.strictEqual(ultimo!.ganador, "negras"); // negras dieron jaque mate, blancas se quedan sin movimientos
});

test("aplicarMovimientoAjedrez: ahogado (sin jaque, sin movimientos legales) termina la partida en tablas", () => {
  // posición de manual: blancas Rey g6 + Dama f2, negras Rey h8 (turno blancas)
  // — Df2-f7 deja a negras sin un solo movimiento legal y SIN estar en jaque.
  const fenAntesDeAhogar = "7k/8/6K1/8/8/8/5Q2/8 w - - 0 1";
  const r = aplicarMovimientoAjedrez(fenAntesDeAhogar, "f2", "f7");
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.terminado, true);
  assert.strictEqual(r.ganador, "tablas");
});

test("aplicarMovimientoAjedrez: promoción de peón — sin indicar pieza, corona a dama por defecto", () => {
  const fenAntesDePromocionar = "8/1P6/8/8/4k3/8/8/K7 w - - 0 1"; // peón blanco en b7, reyes lejos de la línea de jaque
  const r = aplicarMovimientoAjedrez(fenAntesDePromocionar, "b7", "b8");
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.terminado, false);
  assert.match(r.fen, /^1Q6\//); // dama blanca (mayúscula = blancas) en b8, resto de la fila 8 vacía
});

test("aplicarMovimientoAjedrez: promoción explícita a torre respeta la pieza pedida", () => {
  const fenAntesDePromocionar = "8/1P6/8/8/4k3/8/8/K7 w - - 0 1";
  const r = aplicarMovimientoAjedrez(fenAntesDePromocionar, "b7", "b8", "r");
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.match(r.fen, /^1R6\//); // torre, no dama
});
