import { test } from "node:test";
import assert from "node:assert/strict";
import { salaEnPosicion, salasVisibles, paredOculta } from "../src/render3d/conoVision";
import type { SalaRect, PuertaConexion } from "../src/render3d/conoVision";

// Suite del cono de visión (docs/Backlog_Mecanicas_Futuras.md) — lógica pura
// de qué salas hay que "abrir" (paredes este/sur ocultas) según en qué sala
// está el jugador y qué puertas norte/oeste hay entre salas.
// Ejecutar: node --import tsx --test client/test/conoVision.test.ts

// Dos salas en fila, A al sur y B al norte de A, con la puerta de conexión
// (hueco de 1 casilla) entre ambas — mismo layout que genera edificio.js.
const A: SalaRect = { offsetX: 0, offsetY: 5, ancho: 4, largo: 4 }; // filas 5..8
const B: SalaRect = { offsetX: 0, offsetY: 0, ancho: 4, largo: 4 }; // filas 0..3, hueco en fila 4
const salasNorteSur: SalaRect[] = [A, B];
const puertaNorteSur: PuertaConexion[] = [{ x: 1, y: 4 }]; // fila del hueco entre B (offsetY+largo=4) y A (offsetY-1=4)

// Dos salas en columna, C al este y D al oeste de C, con la puerta entre ambas.
const C: SalaRect = { offsetX: 5, offsetY: 0, ancho: 4, largo: 4 };
const D: SalaRect = { offsetX: 0, offsetY: 0, ancho: 4, largo: 4 }; // hueco en columna 4
const salasEsteOeste: SalaRect[] = [C, D];
const puertaEsteOeste: PuertaConexion[] = [{ x: 4, y: 2 }];

test("salaEnPosicion: encuentra la sala que contiene la casilla, -1 si ninguna", () => {
  assert.strictEqual(salaEnPosicion(salasNorteSur, 1, 6), 0); // dentro de A
  assert.strictEqual(salaEnPosicion(salasNorteSur, 1, 1), 1); // dentro de B
  assert.strictEqual(salaEnPosicion(salasNorteSur, 1, 4), -1); // el hueco de la puerta, ninguna sala
  assert.strictEqual(salaEnPosicion(salasNorteSur, 99, 99), -1);
});

test("salasVisibles: puerta en la pared NORTE del jugador revela la sala de al lado", () => {
  // jugador en A (índice 0); su pared norte tiene la puerta hacia B (índice 1)
  const visibles = salasVisibles(salasNorteSur, puertaNorteSur, 0);
  assert.deepStrictEqual([...visibles].sort(), [0, 1]);
});

test("salasVisibles: sin puerta que conecte, solo la propia sala es visible", () => {
  const visibles = salasVisibles(salasNorteSur, [], 0);
  assert.deepStrictEqual([...visibles], [0]);
});

test("salasVisibles: puerta en la pared OESTE del jugador revela la sala de al lado", () => {
  // jugador en C (índice 0, al este); su pared oeste tiene la puerta hacia D (índice 1)
  const visibles = salasVisibles(salasEsteOeste, puertaEsteOeste, 0);
  assert.deepStrictEqual([...visibles].sort(), [0, 1]);
});

test("salasVisibles: el jugador en la sala SIN salida (D, al oeste) no revela nada extra por esa puerta — D no tiene pared oeste/norte con hueco hacia C", () => {
  // D está al oeste de C: la puerta está en la pared ESTE de D (no norte/oeste),
  // así que desde D no hay cascada hacia C con esta v1 (esa pared ya está
  // siempre abierta, no hace falta cálculo).
  const visibles = salasVisibles(salasEsteOeste, puertaEsteOeste, 1);
  assert.deepStrictEqual([...visibles], [1]);
});

test("salasVisibles: cascada de dos saltos (pasillo de habitaciones en fila)", () => {
  // tres salas en fila hacia el norte: A(sur) -> B(medio) -> E(norte), cada
  // una conectada a la siguiente por su pared norte
  const E: SalaRect = { offsetX: 0, offsetY: -5, ancho: 4, largo: 4 }; // filas -5..-2, hueco en fila -1
  const salas = [A, B, E];
  const puertas: PuertaConexion[] = [{ x: 1, y: 4 }, { x: 1, y: -1 }];
  const visibles = salasVisibles(salas, puertas, 0); // jugador en A
  assert.deepStrictEqual([...visibles].sort(), [0, 1, 2]);
});

test("paredOculta: solo este/sur se ocultan, y solo si la sala está en el set de visibles", () => {
  const visibles = new Set([0]);
  assert.strictEqual(paredOculta(0, "este", visibles), true);
  assert.strictEqual(paredOculta(0, "sur", visibles), true);
  assert.strictEqual(paredOculta(0, "norte", visibles), false); // norte/oeste NUNCA se ocultan
  assert.strictEqual(paredOculta(0, "oeste", visibles), false);
  assert.strictEqual(paredOculta(1, "este", visibles), false); // sala 1 no está en el set
});
