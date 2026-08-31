// Tests de mundo/exploracion.ts (docs/GDD_Mapa_Mundo.md, pedido 2026-08-31).
import { test } from "node:test";
import * as assert from "node:assert";
import { empaquetarSector, desempaquetarSector, sectorDePosicion, sectoresARevelar, nuevasClavesReveladas, RADIO_REVELADO_SECTORES } from "../src/mundo/exploracion";

test("empaquetarSector/desempaquetarSector: ida y vuelta exacta", () => {
  for (const [sx, sy] of [[0, 0], [3, 7], [99, 42], [15000, 2]] as [number, number][]) {
    const clave = empaquetarSector(sx, sy);
    assert.deepStrictEqual(desempaquetarSector(clave), { sx, sy });
  }
});

test("sectorDePosicion: divide por tilesPorSector, sin redondeo hacia arriba", () => {
  assert.deepStrictEqual(sectorDePosicion(0, 0, 320), { sx: 0, sy: 0 });
  assert.deepStrictEqual(sectorDePosicion(319.9, 0, 320), { sx: 0, sy: 0 });
  assert.deepStrictEqual(sectorDePosicion(320, 0, 320), { sx: 1, sy: 0 });
  assert.deepStrictEqual(sectorDePosicion(1600.5, 1600.5, 320), { sx: 5, sy: 5 });
});

test("sectoresARevelar: (2*radio+1)^2 claves en el centro del mapa", () => {
  const claves = sectoresARevelar(10, 10, 2);
  assert.strictEqual(claves.length, 25); // 5x5
  assert.ok(claves.includes(empaquetarSector(10, 10)));
  assert.ok(claves.includes(empaquetarSector(8, 8)));
  assert.ok(claves.includes(empaquetarSector(12, 12)));
});

test("sectoresARevelar: recorta el borde del mapa (sx/sy negativos se descartan)", () => {
  const claves = sectoresARevelar(0, 0, 2);
  assert.strictEqual(claves.length, 9); // 3x3 (solo 0,1,2 en cada eje)
  for (const c of claves) {
    const { sx, sy } = desempaquetarSector(c);
    assert.ok(sx >= 0 && sy >= 0);
  }
});

test("RADIO_REVELADO_SECTORES: es el radio por defecto usado si no se pasa explícito", () => {
  assert.deepStrictEqual(sectoresARevelar(5, 5), sectoresARevelar(5, 5, RADIO_REVELADO_SECTORES));
});

test("nuevasClavesReveladas: [] si ya estaba todo revelado (caso común, la mayoría de ticks)", () => {
  const previo = new Set(sectoresARevelar(5, 5, 2));
  assert.deepStrictEqual(nuevasClavesReveladas(previo, 5 * 320 + 10, 5 * 320 + 10, 320, 2), []);
});

test("nuevasClavesReveladas: devuelve solo lo que faltaba tras moverse a otro sector", () => {
  const previo = new Set(sectoresARevelar(0, 0, 1)); // 3x3 alrededor de (0,0)
  const nuevas = nuevasClavesReveladas(previo, 5 * 320 + 10, 5 * 320 + 10, 320, 1); // salta a sector (5,5)
  assert.ok(nuevas.length > 0);
  for (const c of nuevas) assert.ok(!previo.has(c));
});
