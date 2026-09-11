import { test } from "node:test";
import assert from "node:assert/strict";
import { construirMuroNieve } from "../src/render3d/orillasTerreno";

// Pared vertical de nieve en cada orilla interna del sector (pedido streamer
// 2026-09-11: "la nieve... se ve como transparente, no tiene la capa
// vertical en bordes" — la caja de nieve solo tenía lados sólidos en el
// borde del SECTOR entero, un río/lago dentro del sector se quedaba sin
// ningún muro). Función pura, mismo criterio de test que orillasTerreno.test.ts.
// Ejecutar: node --import tsx --test client/test/muroNieve.test.ts

function esAguaDe(filas: string[]): { ancho: number; alto: number; esAgua: Uint8Array } {
  const alto = filas.length;
  const ancho = filas[0].length;
  const esAgua = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) esAgua[y * ancho + x] = filas[y][x] === "~" ? 1 : 0;
  return { ancho, alto, esAgua };
}

test("sector sin agua: cero quads", () => {
  const m = esAguaDe(["...", "...", "..."]);
  const g = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  assert.equal(g.quads, 0);
});

test("una casilla de agua rodeada de nieve levanta 4 paredes, una por vecino", () => {
  const m = esAguaDe(["...", ".~.", "..."]);
  const g = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  assert.equal(g.quads, 4);
  assert.equal(g.posiciones.length, 4 * 6 * 3);
});

test("las paredes van de y=0 (suelo) a y=1 (unidad, se reescala después), nunca por debajo del suelo", () => {
  const m = esAguaDe(["...", ".~.", "..."]);
  const g = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  const ys = new Set<number>();
  for (let i = 1; i < g.posiciones.length; i += 3) ys.add(g.posiciones[i]);
  assert.deepEqual([...ys].sort((a, b) => a - b), [0, 1]);
});

test("el color es blanco fijo (no depende de la casilla), más oscuro abajo que arriba", () => {
  const m = esAguaDe(["...", ".~.", "..."]);
  const g = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  // primer quad: vértice 0 = arriba, vértice 1 = abajo
  const claroArriba = g.colores[1];
  const claroAbajo = g.colores[4];
  assert.ok(claroArriba > claroAbajo, `arriba=${claroArriba} abajo=${claroAbajo}`);
  assert.ok(claroArriba <= 1 && claroArriba > 0.9, "arriba debe leerse blanco de verdad");
});

test("agua contra el borde del sector (sin vecino conocido) no inventa pared", () => {
  const m = esAguaDe(["~.", "~.", "~."]);
  const g = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  assert.equal(g.quads, 3); // solo la arista interior x=1, nunca x=0 (borde del sector)
  for (let i = 0; i < g.posiciones.length; i += 3) assert.equal(g.posiciones[i], 1);
});

test("misma detección de arista que construirOrillas: un lago 2x2 da el mismo número de paredes en ambas", async () => {
  const { construirOrillas } = await import("../src/render3d/orillasTerreno");
  const filas = ["....", ".~~.", ".~~.", "...."];
  const m = esAguaDe(filas);
  const rgb = new Uint8Array(m.ancho * m.alto * 3);
  const gMuro = construirMuroNieve(m.ancho, m.alto, m.esAgua);
  const gOrillas = construirOrillas(m.ancho, m.alto, m.esAgua, rgb, 1.5, { oeste: false, este: false, norte: false, sur: false });
  assert.equal(gMuro.quads, gOrillas.quads);
});
