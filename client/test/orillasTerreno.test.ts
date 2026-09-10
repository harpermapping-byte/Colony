import { test } from "node:test";
import assert from "node:assert/strict";
import { construirOrillas } from "../src/render3d/orillasTerreno";

// Orillas verticales tierra↔agua + faldón de borde de mapa (pedido streamer
// 2026-09-10). Función pura: se comprueba la geometría con números, sin canvas.
// Ejecutar: node --import tsx --test client/test/orillasTerreno.test.ts

const SIN_BORDE = { oeste: false, este: false, norte: false, sur: false };

function mapa(filas: string[]): { ancho: number; alto: number; esAgua: Uint8Array; rgb: Uint8Array } {
  const alto = filas.length;
  const ancho = filas[0].length;
  const esAgua = new Uint8Array(ancho * alto);
  const rgb = new Uint8Array(ancho * alto * 3);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      esAgua[i] = filas[y][x] === "~" ? 1 : 0;
      rgb[i * 3] = 100; rgb[i * 3 + 1] = 200; rgb[i * 3 + 2] = 50; // "césped"
    }
  }
  return { ancho, alto, esAgua, rgb };
}

test("sector sin agua ni borde de mapa: cero quads (no se añade nada al render)", () => {
  const m = mapa(["...", "...", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  assert.equal(g.quads, 0);
  assert.equal(g.posiciones.length, 0);
});

test("una casilla de agua rodeada de tierra levanta exactamente 4 paredes (una por vecino de tierra)", () => {
  const m = mapa(["...", ".~.", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  assert.equal(g.quads, 4);
  assert.equal(g.posiciones.length, 4 * 6 * 3);
  assert.equal(g.colores.length, 4 * 6 * 3);
  assert.equal(g.normales.length, 4 * 6 * 3);
});

test("las paredes van del suelo (y=0) al lecho (y=-profundidad), nunca por encima del suelo", () => {
  const m = mapa(["...", ".~.", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  const ys = new Set<number>();
  for (let i = 1; i < g.posiciones.length; i += 3) ys.add(g.posiciones[i]);
  assert.deepEqual([...ys].sort((a, b) => a - b), [-1.5, 0]);
});

test("las paredes caen sobre la arista compartida entre la casilla de tierra y la de agua (x/z enteros del borde real)", () => {
  // agua en (1,1): las 4 paredes deben estar en x=1, x=2, z=1, z=2
  const m = mapa(["...", ".~.", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  const xs = new Set<number>(); const zs = new Set<number>();
  for (let i = 0; i < g.posiciones.length; i += 3) { xs.add(g.posiciones[i]); zs.add(g.posiciones[i + 2]); }
  assert.deepEqual([...xs].sort(), [1, 2]);
  assert.deepEqual([...zs].sort(), [1, 2]);
});

test("el degradado usa el color real de la casilla de tierra: arriba más claro que abajo, nunca el de una casilla de agua", () => {
  const m = mapa(["...", ".~.", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  // primer quad: vértices 0 (arriba), 1 (abajo)
  const arriba = g.colores[1]; // canal verde del vértice de arriba (200/255*factor)
  const abajo = g.colores[4];
  assert.ok(arriba > abajo, `arriba=${arriba} abajo=${abajo}`);
  assert.ok(arriba < 200 / 255 && arriba > 0.5, "el factor de arriba oscurece un poco, no borra el color");
});

test("agua contra el borde del sector (sin vecino conocido) no inventa pared: solo las aristas internas", () => {
  // agua en la columna 0 entera; tierra en la 1 — solo la arista x=1 tiene pared (3 quads), nunca x=0
  const m = mapa(["~.", "~.", "~."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, SIN_BORDE);
  assert.equal(g.quads, 3);
  for (let i = 0; i < g.posiciones.length; i += 3) assert.equal(g.posiciones[i], 1);
});

test("faldón de borde de mapa: una pared por casilla del lado marcado, y en agua arranca desde el lecho (no atraviesa el río)", () => {
  const m = mapa(["~..", "...", "..."]);
  const g = construirOrillas(m.ancho, m.alto, m.esAgua, m.rgb, 1.5, { ...SIN_BORDE, norte: true }, 2.5);
  // sin orillas internas: (0,0) es agua con vecinos tierra (1,0) y (0,1) → 2 quads de orilla + 3 de faldón norte
  assert.equal(g.quads, 5);
  // los 3 últimos quads son el faldón: el primero (casilla de agua) va de -1.5 a -2.5, los otros dos de 0 a -2.5
  const ysQuad = (k: number) => { const s = new Set<number>(); for (let v = 0; v < 6; v++) s.add(g.posiciones[(k * 6 + v) * 3 + 1]); return [...s].sort((a, b) => a - b); };
  assert.deepEqual(ysQuad(2), [-2.5, -1.5]);
  assert.deepEqual(ysQuad(3), [-2.5, 0]);
  assert.deepEqual(ysQuad(4), [-2.5, 0]);
});
