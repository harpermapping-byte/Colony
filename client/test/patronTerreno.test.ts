import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generarParcheTerreno, obtenerParcheTerreno, obtenerParcheSolido, copiarParcheEnBuffer, hashCasilla,
} from "../src/render3d/patronTerreno";

// Patrón de suelo horneado (pedido streamer 2026-09-11, "la prueba B es lo
// que hay que hacer" tras comparar visualmente 3 técnicas). Función pura
// sobre Uint8ClampedArray, sin canvas — se puede testear en Node.

test("un parche tam x tam produce exactamente tam*tam*4 bytes, todos opacos (alfa=255)", () => {
  const p = generarParcheTerreno("cesped", [90, 156, 76], 8, 123);
  assert.equal(p.length, 8 * 8 * 4);
  for (let i = 3; i < p.length; i += 4) assert.equal(p[i], 255);
});

test("determinista: misma familia+color+semilla siempre da el mismo parche byte a byte", () => {
  const a = generarParcheTerreno("roca", [138, 138, 138], 8, 999);
  const b = generarParcheTerreno("roca", [138, 138, 138], 8, 999);
  assert.deepEqual([...a], [...b]);
});

test("semillas distintas dan parches distintos (no es un color plano disfrazado)", () => {
  const a = generarParcheTerreno("cesped", [90, 156, 76], 8, 1);
  const b = generarParcheTerreno("cesped", [90, 156, 76], 8, 2);
  assert.notDeepEqual([...a], [...b]);
});

test("el color medio del parche se mantiene cerca del color base (no lo desnaturaliza)", () => {
  const base: [number, number, number] = [90, 156, 76];
  const p = generarParcheTerreno("cesped", base, 16, 42);
  let sr = 0, sg = 0, sb = 0;
  const n = p.length / 4;
  for (let i = 0; i < p.length; i += 4) { sr += p[i]; sg += p[i + 1]; sb += p[i + 2]; }
  assert.ok(Math.abs(sr / n - base[0]) < 40, `rojo medio ${sr / n} lejos de ${base[0]}`);
  assert.ok(Math.abs(sg / n - base[1]) < 40, `verde medio ${sg / n} lejos de ${base[1]}`);
  assert.ok(Math.abs(sb / n - base[2]) < 40, `azul medio ${sb / n} lejos de ${base[2]}`);
});

test("las 6 familias generan sin lanzar excepción a varios tamaños", () => {
  const familias = ["cesped", "tierra", "camino", "roca", "arena", "nieve"] as const;
  for (const f of familias) for (const tam of [1, 4, 8, 16]) {
    const p = generarParcheTerreno(f, [128, 128, 128], tam, 7);
    assert.equal(p.length, tam * tam * 4);
  }
});

test("obtenerParcheTerreno cachea: dos llamadas con la misma clave devuelven la MISMA referencia", () => {
  const a = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 3);
  const b = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 3);
  assert.equal(a, b);
});

test("obtenerParcheTerreno con variantes distintas da parches distintos", () => {
  const a = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 0);
  const b = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 1);
  assert.notDeepEqual([...a], [...b]);
});

test("obtenerParcheSolido: color uniforme exacto en todos los píxeles, cacheado por clave", () => {
  const p = obtenerParcheSolido(10, 20, 30, 200, 4);
  assert.equal(p.length, 4 * 4 * 4);
  for (let i = 0; i < p.length; i += 4) assert.deepEqual([p[i], p[i + 1], p[i + 2], p[i + 3]], [10, 20, 30, 200]);
  assert.equal(obtenerParcheSolido(10, 20, 30, 200, 4), p);
});

test("copiarParcheEnBuffer coloca el parche en la casilla correcta de un buffer más grande, sin tocar el resto", () => {
  const tam = 2;
  const parche = obtenerParcheSolido(255, 0, 0, 255, tam); // rojo puro
  const anchoTiles = 3, altoTiles = 2;
  const destino = new Uint8ClampedArray(anchoTiles * tam * altoTiles * tam * 4); // arranca todo en 0 (negro transparente)
  copiarParcheEnBuffer(destino, anchoTiles * tam, 1, 0, parche, tam); // casilla (1,0) de 3x2
  // los 2x2 píxeles de la casilla (1,0) deben ser rojo puro
  for (let dy = 0; dy < tam; dy++) for (let dx = 0; dx < tam; dx++) {
    const px = 1 * tam + dx, py = 0 * tam + dy;
    const i = (py * anchoTiles * tam + px) * 4;
    assert.deepEqual([destino[i], destino[i + 1], destino[i + 2], destino[i + 3]], [255, 0, 0, 255]);
  }
  // una casilla vecina (0,0) debe seguir en cero (no se ha escrito ahí)
  const i0 = (0 * anchoTiles * tam + 0) * 4;
  assert.deepEqual([destino[i0], destino[i0 + 1], destino[i0 + 2], destino[i0 + 3]], [0, 0, 0, 0]);
});

test("hashCasilla es determinista por posición: misma (gx,gy,sal) siempre el mismo valor", () => {
  assert.equal(hashCasilla(10, 20, 1), hashCasilla(10, 20, 1));
  assert.notEqual(hashCasilla(10, 20, 1), hashCasilla(11, 20, 1));
});
