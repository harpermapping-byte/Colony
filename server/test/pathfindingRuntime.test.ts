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

// Bug real encontrado 2026-08-31 depurando transporte→cofre: origen/destino
// de un contrato suelen ser la PROPIA casilla ocupada de una construcción
// (colisión=true endurece su huella) — pasada tal cual a aEstrella, esa
// casilla es sólida (coste Infinity) e inalcanzable, y el A* exploraba el
// mapa VIVO entero antes de rendirse (un cuelgue práctico en 3200x3200, aquí
// reproducido en un mapa de test pequeño para que sea instantáneo).
test("calcularCaminoRuntime: destino sobre su propia casilla sólida (huella de una construcción) — encuentra camino igualmente", () => {
  const mundo = mundoVacio();
  mundo.casillas[2 * ANCHO + 10] = TIPO.SOLIDO; // "arcón" plantado en (10,2), rodeado de tierra
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 10, y: 2 });
  assert.ok(camino, "debe encontrar camino aunque el propio destino sea sólido");
  assert.strictEqual(camino![camino!.length - 1].x, 10, "la punta del camino sigue siendo la casilla original del destino");
  assert.strictEqual(camino![camino!.length - 1].y, 2);
});

test("calcularCaminoRuntime: origen sobre su propia casilla sólida — encuentra camino igualmente", () => {
  const mundo = mundoVacio();
  mundo.casillas[2 * ANCHO + 2] = TIPO.SOLIDO; // "colmena" plantada en (2,2)
  const camino = calcularCaminoRuntime(mundo, { x: 2, y: 2 }, { x: 10, y: 2 });
  assert.ok(camino, "debe encontrar camino aunque el propio origen sea sólido");
  assert.strictEqual(camino![0].x, 2, "la punta del camino sigue siendo la casilla original del origen");
  assert.strictEqual(camino![0].y, 2);
});

test("calcularCaminoRuntime: origen Y destino ambos sobre su propia casilla sólida, uno junto al otro (caso real del cofre)", () => {
  const mundo = mundoVacio();
  mundo.casillas[2 * ANCHO + 5] = TIPO.SOLIDO; // colmena
  mundo.casillas[2 * ANCHO + 7] = TIPO.SOLIDO; // arcón, 2 casillas más allá
  const camino = calcularCaminoRuntime(mundo, { x: 5, y: 2 }, { x: 7, y: 2 });
  assert.ok(camino, "camino corto entre dos construcciones vecinas, ambas sólidas en su propia casilla");
  assert.strictEqual(camino![0].x, 5);
  assert.strictEqual(camino![camino!.length - 1].x, 7);
});
