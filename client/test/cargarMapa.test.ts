import { test } from "node:test";
import assert from "node:assert/strict";
import { cargarSector } from "../src/mapa/cargarMapa";

// cargarSector: solo un 404 es "no existe" (null); un fallo transitorio de
// red se reintenta y, si persiste, LANZA (el streaming lo vuelve a pedir
// más tarde) — playtest multijugador 2026-09-10. fetch global stubeado.
// Ejecutar: node --import tsx --test client/test/cargarMapa.test.ts

function conFetch(respuestas: (() => Promise<Response>)[], fn: () => Promise<void>) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => respuestas[Math.min(i++, respuestas.length - 1)]()) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}
const ok = () => Promise.resolve(new Response(JSON.stringify({ chunks: {} }), { status: 200 }));
const notFound = () => Promise.resolve(new Response("", { status: 404 }));
const reset = () => Promise.reject(new TypeError("Failed to fetch"));
const caido = () => Promise.resolve(new Response("", { status: 502 }));

test("404 → null a la primera, sin reintentos", async () => {
  let llamadas = 0;
  await conFetch([() => { llamadas++; return notFound(); }], async () => {
    assert.equal(await cargarSector("/m", 1, 2), null);
  });
  assert.equal(llamadas, 1);
});

test("conexión reseteada una vez → reintenta y devuelve el sector (rellenando sectorX/sectorY)", async () => {
  await conFetch([reset, ok], async () => {
    const s = await cargarSector("/m", 3, 4);
    assert.ok(s);
    assert.equal(s!.sectorX, 3);
    assert.equal(s!.sectorY, 4);
  });
});

test("fallo persistente (502 tres veces) → lanza, nunca devuelve null", async () => {
  let llamadas = 0;
  await conFetch([() => { llamadas++; return caido(); }], async () => {
    await assert.rejects(() => cargarSector("/m", 0, 0), /HTTP 502/);
  });
  assert.equal(llamadas, 3);
});
