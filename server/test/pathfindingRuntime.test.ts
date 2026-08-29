// Test de calcularCaminoRuntime (server/src/mundo/pathfindingRuntime.ts,
// docs/GDD_Produccion.md) — confirma que el A* offline de ciudades/ (agnóstico
// de la rejilla) encaja sin fricción contra MundoColision del servidor.
import { test } from "node:test";
import * as assert from "node:assert";
import { TIPO } from "../src/mundo/colisiones";
import { calcularCaminoRuntime } from "../src/mundo/pathfindingRuntime";

const ANCHO = 20, ALTO = 20;

function mundoVacio() {
  return {
    ancho: ANCHO,
    alto: ALTO,
    casillas: new Uint8Array(ANCHO * ALTO).fill(TIPO.TIERRA),
    velocidad: new Float32Array(ANCHO * ALTO).fill(1),
  };
}

test("calcularCaminoRuntime: encuentra un camino recto en terreno abierto", () => {
  const mundo = mundoVacio();
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 10, y: 2 });
  assert.ok(camino, "debería encontrar camino en terreno abierto");
  assert.strictEqual(camino![0].x, 2);
  assert.strictEqual(camino![0].y, 2);
  assert.strictEqual(camino![camino!.length - 1].x, 10);
  assert.strictEqual(camino![camino!.length - 1].y, 2);
});

test("calcularCaminoRuntime: rodea un muro sólido en vez de atravesarlo", () => {
  const mundo = mundoVacio();
  // muro vertical completo en x=10, de y=0 a y=15 (deja un hueco en y=16..19)
  for (let y = 0; y < 16; y++) mundo.casillas[y * ANCHO + 10] = TIPO.SOLIDO;
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 18, y: 2 });
  assert.ok(camino, "debería rodear el muro por el hueco");
  assert.ok(camino!.every((p) => mundo.casillas[p.y * ANCHO + p.x] !== TIPO.SOLIDO), "el camino nunca atraviesa una casilla sólida");
});

test("calcularCaminoRuntime: null si el destino está completamente aislado", () => {
  const mundo = mundoVacio();
  // caja sólida cerrada alrededor de (15,15)
  for (let dx = -1; dx <= 1; dx++) {
    mundo.casillas[(15 - 1) * ANCHO + (15 + dx)] = TIPO.SOLIDO;
    mundo.casillas[(15 + 1) * ANCHO + (15 + dx)] = TIPO.SOLIDO;
  }
  mundo.casillas[15 * ANCHO + (15 - 1)] = TIPO.SOLIDO;
  mundo.casillas[15 * ANCHO + (15 + 1)] = TIPO.SOLIDO;
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 15, y: 15 });
  assert.strictEqual(camino, null);
});

test("calcularCaminoRuntime: prefiere rodear agua en vez de cruzarla en línea recta (coste alto, no infinito)", () => {
  const mundo = mundoVacio();
  // franja de agua ancha bloqueando el paso directo, con un camino de tierra alrededor
  for (let y = 0; y < ANCHO; y++) mundo.casillas[y * ANCHO + 10] = TIPO.AGUA;
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 18, y: 2 });
  assert.ok(camino, "el agua es cara pero NO infranqueable — debe encontrar algo");
});

test("calcularCaminoRuntime: fuera de los límites del mapa devuelve null en vez de reventar", () => {
  const mundo = mundoVacio();
  assert.strictEqual(calcularCaminoRuntime(mundo, { x: -1, y: 2 }, { x: 5, y: 5 }), null);
  assert.strictEqual(calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 999, y: 5 }), null);
});
