// Tests del bakeador de arenas de combate (docs/GDD_Combate.md §9.4).
// Ejecutar: node --test mazmorras/test/arena.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generarObstaculosArena, exportarArena } = require("../src/generarArena");

test("generarObstaculosArena: determinista — misma semilla, mismo resultado", () => {
  const a = generarObstaculosArena({ ancho: 8, alto: 8, semilla: "prueba-1" });
  const b = generarObstaculosArena({ ancho: 8, alto: 8, semilla: "prueba-1" });
  assert.deepStrictEqual([...a], [...b]);
});

test("generarObstaculosArena: semillas distintas dan resultados distintos", () => {
  const a = generarObstaculosArena({ ancho: 8, alto: 8, semilla: "prueba-1" });
  const b = generarObstaculosArena({ ancho: 8, alto: 8, semilla: "prueba-2" });
  assert.notDeepStrictEqual([...a], [...b]);
});

test("generarObstaculosArena: las columnas de aparición (izq/der, fila central) SIEMPRE quedan libres", () => {
  for (const semilla of ["a", "b", "c", "d", "e"]) {
    const ancho = 8, alto = 8;
    const obstaculos = generarObstaculosArena({ ancho, alto, semilla, densidad: 0.3 });
    const filaCentral = Math.floor(alto / 2);
    assert.strictEqual(obstaculos[filaCentral * ancho + 1], 0, `semilla ${semilla}: spawn izq bloqueado`);
    assert.strictEqual(obstaculos[filaCentral * ancho + (ancho - 2)], 0, `semilla ${semilla}: spawn der bloqueado`);
  }
});

test("generarObstaculosArena: 10x10 también determinista y con spawns libres", () => {
  const a = generarObstaculosArena({ ancho: 10, alto: 10, semilla: "boss-1" });
  const b = generarObstaculosArena({ ancho: 10, alto: 10, semilla: "boss-1" });
  assert.deepStrictEqual([...a], [...b]);
  assert.strictEqual(a[5 * 10 + 1], 0);
  assert.strictEqual(a[5 * 10 + 8], 0);
});

test("exportarArena: escribe indice.json + sector_000_000.json con el formato que carga mapaColision.ts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-test-"));
  const resultado = exportarArena({ id: "prueba", ancho: 8, alto: 8, semilla: "x", rutaSalida: tmp });
  assert.ok(resultado.obstaculos >= 0);

  const indice = JSON.parse(fs.readFileSync(path.join(tmp, "indice.json"), "utf8"));
  assert.strictEqual(indice.nombre, "prueba");
  assert.strictEqual(indice.anchoChunks, 1);
  assert.strictEqual(indice.altoChunks, 1);
  assert.strictEqual(indice.tamanoChunk, 8);
  assert.deepStrictEqual(indice.leyendaTerreno, ["cesped"]);

  const sector = JSON.parse(fs.readFileSync(path.join(tmp, "sector_000_000.json"), "utf8"));
  assert.ok(sector.chunks["0_0"]);
  assert.strictEqual(sector.chunks["0_0"].terreno.length, 64);
  assert.ok(sector.chunks["0_0"].objetos.every((o) => o.i === "granito" && o.t === "r"));

  fs.rmSync(tmp, { recursive: true, force: true });
});
