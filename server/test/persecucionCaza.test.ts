// Persecución automática de caza del servidor (docs/GDD_Caza.md §4ter):
// función pura `direccionPersecucion` — rumbo directo, parada pegado a la
// presa, y esquiva de obstáculos por "ticks sin avanzar".
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISTANCIA_PARADA, RADIO_PERDIDA_CAZA, direccionPersecucion, nuevoEstadoPersecucion } from "../src/mundo/persecucionCaza";

const PASO = 3.75 / 30; // VEL_ANDAR * dt a 30hz

test("apunta directo a la presa (vector unitario) mientras nada lo bloquea", () => {
  const estado = nuevoEstadoPersecucion(0, 0);
  const d = direccionPersecucion(estado, { x: 0, y: 0 }, { x: 10, y: 0 }, PASO);
  assert.ok(Math.abs(d.x - 1) < 1e-9 && Math.abs(d.y) < 1e-9);
  const d2 = direccionPersecucion(estado, { x: PASO, y: 0 }, { x: 10, y: 10 }, PASO); // avanzó lo esperado
  assert.ok(Math.abs(Math.hypot(d2.x, d2.y) - 1) < 1e-9, "siempre unitario");
  assert.ok(d2.x > 0 && d2.y > 0);
  assert.strictEqual(estado.ticksAtascado, 0);
});

test("pegado a la presa (<= DISTANCIA_PARADA) deja de empujar — el tick de fauna resuelve la captura", () => {
  const estado = nuevoEstadoPersecucion(0, 0);
  assert.deepStrictEqual(direccionPersecucion(estado, { x: 0, y: 0 }, { x: DISTANCIA_PARADA * 0.5, y: 0 }, PASO), { x: 0, y: 0 });
});

test("atascado contra un obstáculo: tras unos ticks sin avanzar desvía el rumbo, y vuelve a apuntar directo cuando el desvío caduca", () => {
  const estado = nuevoEstadoPersecucion(0, 0);
  // El cazador NO se mueve (pared delante) tick tras tick.
  let d = direccionPersecucion(estado, { x: 0, y: 0 }, { x: 10, y: 0 }, PASO);
  let ticksDirectos = 0;
  for (let i = 0; i < 12; i++) {
    d = direccionPersecucion(estado, { x: 0, y: 0 }, { x: 10, y: 0 }, PASO);
    if (Math.abs(d.y) < 1e-9) ticksDirectos++;
  }
  assert.ok(ticksDirectos < 12, "en algún momento tiene que dejar de apuntar recto");
  assert.ok(Math.abs(d.y) > 0.5, `tras atascarse desvía claramente (dy=${d.y.toFixed(2)})`);
  const desvioInicial = Math.sign(d.y);
  // Simula que el desvío SÍ le deja avanzar: cada tick se mueve el paso completo en la dirección pedida.
  let pos = { x: 0, y: 0 };
  let volvioRecto = false;
  for (let i = 0; i < 40; i++) {
    pos = { x: pos.x + d.x * PASO, y: pos.y + d.y * PASO };
    d = direccionPersecucion(estado, pos, { x: 10, y: 0 }, PASO);
    // "Recto" = hacia la presa desde donde esté ahora (ya no en el eje x puro, porque se desplazó en y).
    const angDirecto = Math.atan2(0 - pos.y, 10 - pos.x);
    if (Math.abs(Math.atan2(d.y, d.x) - angDirecto) < 1e-6) { volvioRecto = true; break; }
  }
  assert.ok(volvioRecto, "cuando el desvío caduca vuelve a apuntar directo a la presa");
  assert.ok(desvioInicial !== 0);
});

test("si un desvío tampoco le deja avanzar, prueba el siguiente ángulo (ciclo de esquivas, nunca se queda con el mismo)", () => {
  const estado = nuevoEstadoPersecucion(0, 0);
  const angulos = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const d = direccionPersecucion(estado, { x: 0, y: 0 }, { x: 10, y: 0 }, PASO); // nunca avanza
    angulos.add(Math.round(Math.atan2(d.y, d.x) * 100) / 100);
  }
  assert.ok(angulos.size >= 4, `debería haber probado varios rumbos distintos (${angulos.size})`);
});

test("RADIO_PERDIDA_CAZA queda por debajo del radio de interés del cliente (70) — la presa sigue visible cuando se pierde", () => {
  assert.ok(RADIO_PERDIDA_CAZA < 70 && RADIO_PERDIDA_CAZA > 20);
});
