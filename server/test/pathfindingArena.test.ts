// Tests de combate/pathfindingArena.ts (docs/GDD_Combate.md §1-2, ✅
// confirmado 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { Arena, casillasAlcanzables, costeCasilla, distanciaChebyshev, esObstaculo, pasoHacia } from "../src/combate/pathfindingArena";

function arenaAbierta(ancho = 8, alto = 8): Arena {
  return { ancho, alto, obstaculos: new Uint8Array(ancho * alto) };
}

test("esObstaculo: fuera de la rejilla cuenta como obstáculo", () => {
  const arena = arenaAbierta();
  assert.strictEqual(esObstaculo(arena, -1, 0), true);
  assert.strictEqual(esObstaculo(arena, 8, 0), true);
  assert.strictEqual(esObstaculo(arena, 0, 0), false);
});

test("distanciaChebyshev: diagonal cuenta 1, no 1.41", () => {
  assert.strictEqual(distanciaChebyshev({ gx: 0, gy: 0 }, { gx: 3, gy: 3 }), 3);
  assert.strictEqual(distanciaChebyshev({ gx: 0, gy: 0 }, { gx: 3, gy: 0 }), 3);
});

test("casillasAlcanzables: con pa=2 en rejilla abierta llega a las 24 casillas del anillo de radio 2", () => {
  const arena = arenaAbierta();
  const alcanzables = casillasAlcanzables(arena, { gx: 4, gy: 4 }, 2);
  // radio 2 en Chebyshev = (2*2+1)^2 - 1 (sin contar el origen) = 24
  assert.strictEqual(alcanzables.size, 24);
  assert.ok(alcanzables.has("5,4")); // vecino inmediato
  assert.ok(alcanzables.has("6,6")); // esquina del anillo, dentro de radio 2
  assert.ok(!alcanzables.has("7,7")); // fuera del radio 2
});

test("casillasAlcanzables: pa=0 no alcanza nada", () => {
  const arena = arenaAbierta();
  assert.strictEqual(casillasAlcanzables(arena, { gx: 0, gy: 0 }, 0).size, 0);
});

test("casillasAlcanzables: un obstáculo bloquea el paso por esa casilla", () => {
  const arena = arenaAbierta(5, 5);
  arena.obstaculos[2 * 5 + 1] = 1; // (1,2)
  const alcanzables = casillasAlcanzables(arena, { gx: 0, gy: 2 }, 1);
  assert.ok(!alcanzables.has("1,2"));
});

test("casillasAlcanzables: una casilla ocupada por otra unidad no es alcanzable", () => {
  const arena = arenaAbierta();
  const ocupadas = new Set(["1,0"]);
  const alcanzables = casillasAlcanzables(arena, { gx: 0, gy: 0 }, 1, ocupadas);
  assert.ok(!alcanzables.has("1,0"));
  assert.ok(alcanzables.has("0,1"));
});

test("costeCasilla: distancia real en pasos (diagonal cuenta 1), null si no alcanza con el pa dado", () => {
  const arena = arenaAbierta();
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 0, gy: 0 }, 5), 0);
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 3, gy: 3 }, 5), 3);
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 3, gy: 3 }, 2), null);
});

test("costeCasilla: una casilla ocupada nunca es un destino válido, aunque esté dentro del pa", () => {
  const arena = arenaAbierta();
  const ocupadas = new Set(["1,1"]);
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 1, gy: 1 }, 3, ocupadas), null);
});

test("pasoHacia: avanza en diagonal directa hacia el objetivo cuando no hay obstáculo", () => {
  const arena = arenaAbierta();
  const siguiente = pasoHacia(arena, { gx: 0, gy: 0 }, { gx: 5, gy: 5 });
  assert.deepStrictEqual(siguiente, { gx: 1, gy: 1 });
});

test("pasoHacia: ya en el objetivo, no se mueve", () => {
  const arena = arenaAbierta();
  const siguiente = pasoHacia(arena, { gx: 3, gy: 3 }, { gx: 3, gy: 3 });
  assert.deepStrictEqual(siguiente, { gx: 3, gy: 3 });
});

test("pasoHacia: si la diagonal está bloqueada, prueba los pasos rectos antes de rendirse", () => {
  const arena = arenaAbierta(5, 5);
  arena.obstaculos[1 * 5 + 1] = 1; // bloquea la diagonal directa (1,1) desde (0,0) hacia (3,3)
  const siguiente = pasoHacia(arena, { gx: 0, gy: 0 }, { gx: 3, gy: 3 });
  assert.ok(siguiente.gx === 1 || siguiente.gy === 1);
  assert.notDeepStrictEqual(siguiente, { gx: 1, gy: 1 });
});

// --- coste de terreno (pedido streamer: "2 PA si la casilla es terreno difícil/agua") ---

test("costeCasilla: sin `costes` en la arena, todo sigue costando 1 (compatibilidad)", () => {
  const arena = arenaAbierta();
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 2, gy: 0 }, 5), 2);
});

test("costeCasilla: una casilla de coste 2 en línea recta se refleja en el total", () => {
  // pasillo de 1 sola fila: sin sitio para un rodeo diagonal más barato, el
  // camino recto es el único posible de verdad.
  const arena = arenaAbierta(5, 1);
  arena.costes = new Uint8Array(5); // todo 0 -> costeDeEntrar cae a 1 por defecto
  arena.costes[1] = 2; // (1,0) cuesta 2
  // (0,0) -> (1,0) [coste 2] -> (2,0) [coste 1] = 3 en total
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 2, gy: 0 }, 5), 3);
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 0 }, { gx: 2, gy: 0 }, 2), null); // no llega con solo 2 PA
});

test("costeCasilla: prefiere un rodeo de más pasos pero más barato que cruzar una casilla carísima en línea recta", () => {
  const arena = arenaAbierta(5, 5);
  arena.costes = new Uint8Array(25); // resto del mapa cuesta 1
  arena.costes[2 * 5 + 2] = 10; // (2,2) es un "pozo" carísimo, justo en medio de la línea recta
  // recto por la fila y=2: (0,2)->(1,2)->(2,2)[10]->(3,2)->(4,2) = 1+10+1+1 = 13
  // rodeo por la fila y=1 (Chebyshev: la diagonal no añade pasos): (0,2)->(1,1)->(2,1)->(3,1)->(4,2) = 1+1+1+1 = 4
  assert.strictEqual(costeCasilla(arena, { gx: 0, gy: 2 }, { gx: 4, gy: 2 }, 12), 4);
});

test("casillasAlcanzables: una franja de coste 2 reduce el alcance real, no solo el número de pasos", () => {
  const arena = arenaAbierta(5, 5);
  arena.costes = new Uint8Array(25).fill(2); // todo el mapa es "difícil"
  const alcanzables = casillasAlcanzables(arena, { gx: 2, gy: 2 }, 2); // con pa=2 y coste 2/casilla, solo 1 paso posible
  assert.ok(alcanzables.has("3,2")); // 1 paso, coste 2 == pa
  assert.ok(!alcanzables.has("4,2")); // 2 pasos costaría 4, más que el pa disponible
});
