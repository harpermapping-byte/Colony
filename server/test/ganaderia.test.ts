// Tests de la lógica PURA de ganadería (server/src/mundo/ganaderia.ts,
// docs/GDD_Ganaderia.md). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { estaEncerrado, tiroEscape, TOPE_CASILLAS_VALLADO, TOPE_DIAS_ESCAPE_CHEQUEADOS } from "../src/mundo/ganaderia";
import { MundoColision, TIPO } from "../src/mundo/colisiones";

function mundoAbierto(ancho = 30, alto = 30): MundoColision {
  return { ancho, alto, casillas: new Uint8Array(ancho * alto), velocidad: new Float32Array(ancho * alto).fill(1) };
}

/** Talla un recinto rectangular NxM de valla (TIPO.SOLIDO) con el interior TIERRA, centrado en (cx,cy). */
function tallarRecinto(mundo: MundoColision, cx: number, cy: number, ladoX: number, ladoY: number) {
  const x0 = cx - Math.floor(ladoX / 2), y0 = cy - Math.floor(ladoY / 2);
  for (let y = y0; y <= y0 + ladoY; y++) {
    for (let x = x0; x <= x0 + ladoX; x++) {
      const esBorde = x === x0 || x === x0 + ladoX || y === y0 || y === y0 + ladoY;
      mundo.casillas[y * mundo.ancho + x] = esBorde ? TIPO.SOLIDO : TIPO.TIERRA;
    }
  }
}

test("estaEncerrado: un recinto pequeño vallado (valla=SOLIDO en el borde) SÍ está encerrado", () => {
  const mundo = mundoAbierto();
  tallarRecinto(mundo, 15, 15, 6, 6);
  assert.strictEqual(estaEncerrado(mundo, 15, 15), true);
});

test("estaEncerrado: terreno abierto sin vallar NO está encerrado (el flood-fill se sale del tope)", () => {
  const mundo = mundoAbierto(60, 60); // suficientemente grande para superar el tope sin tocar el borde del mapa
  assert.strictEqual(estaEncerrado(mundo, 30, 30), false);
});

test("estaEncerrado: un hueco en la valla (una casilla sin colisión) rompe el vallado", () => {
  const mundo = mundoAbierto(60, 60);
  tallarRecinto(mundo, 30, 30, 6, 6);
  mundo.casillas[27 * mundo.ancho + 30] = TIPO.TIERRA; // abre un hueco en el borde norte del recinto
  assert.strictEqual(estaEncerrado(mundo, 30, 30), false);
});

test("estaEncerrado: un recinto justo por debajo del tope de casillas cuenta como encerrado", () => {
  const mundo = mundoAbierto(80, 80);
  // recinto interior de 20x20 = 400 casillas, por debajo de TOPE_CASILLAS_VALLADO=500
  tallarRecinto(mundo, 40, 40, 20, 20);
  assert.ok(400 < TOPE_CASILLAS_VALLADO);
  assert.strictEqual(estaEncerrado(mundo, 40, 40), true);
});

test("estaEncerrado: el borde del propio mapa cuenta como sólido (un mapa pequeño encierra por sí solo)", () => {
  const mundo = mundoAbierto(10, 10); // 100 casillas, por debajo del tope, sin ninguna valla
  assert.strictEqual(estaEncerrado(mundo, 5, 5), true);
});

test("tiroEscape: nunca escapa si está encerrado, sean cuantos días sean", () => {
  assert.strictEqual(tiroEscape(9999, true, () => 0), false);
});

test("tiroEscape: sin encerrar, escapa si rnd() < 0.2 en algún día de los transcurridos", () => {
  assert.strictEqual(tiroEscape(1, false, () => 0.1), true, "0.1 < 0.2 el único día que hay");
  assert.strictEqual(tiroEscape(1, false, () => 0.5), false, "0.5 >= 0.2, no escapa ese día");
});

test("tiroEscape: varios días transcurridos son varias tiradas independientes", () => {
  let llamada = 0;
  const rnd = () => (llamada++ === 2 ? 0.05 : 0.9); // solo la 3ª tirada (índice 2) escapa
  assert.strictEqual(tiroEscape(5, false, rnd), true);
});

test("tiroEscape: 0 días transcurridos nunca escapa (nada que resolver todavía)", () => {
  assert.strictEqual(tiroEscape(0, false, () => 0), false);
});

test("tiroEscape: el tope de días chequeados acota el número de tiradas para ausencias largas", () => {
  let tiradas = 0;
  const rnd = () => { tiradas++; return 0.99; }; // nunca escapa, solo contamos tiradas
  tiroEscape(9999, false, rnd);
  assert.strictEqual(tiradas, TOPE_DIAS_ESCAPE_CHEQUEADOS);
});
