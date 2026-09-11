import { test } from "node:test";
import assert from "node:assert/strict";
import { sectorYPixelDeCasilla, GestorHuellasNieve, type SectorNieveCanvas } from "../src/render3d/huellasNieve";

// Huellas de pisada en nieve (pedido streamer 2026-09-11). `sectorYPixelDeCasilla`
// es pura (testeable sin DOM); `GestorHuellasNieve` se prueba con un canvas
// FALSO (misma interfaz mínima: getContext("2d") -> fillRect/fillStyle).

test("sectorYPixelDeCasilla: casilla dentro del sector 0_0", () => {
  const r = sectorYPixelDeCasilla(5, 7, 10, 32); // tilesSector = 320
  assert.deepEqual(r, { sx: 0, sy: 0, px: 5, py: 7 });
});

test("sectorYPixelDeCasilla: casilla en el sector vecino da coordenadas locales correctas", () => {
  const r = sectorYPixelDeCasilla(325, 40, 10, 32); // tilesSector=320 -> sx=1, px=5
  assert.deepEqual(r, { sx: 1, sy: 0, px: 5, py: 40 });
});

test("sectorYPixelDeCasilla: coordenada exactamente en el borde cae en el sector siguiente, px=0", () => {
  const r = sectorYPixelDeCasilla(320, 320, 10, 32);
  assert.deepEqual(r, { sx: 1, sy: 1, px: 0, py: 0 });
});

// --- Canvas falso mínimo (sin DOM real) ---
function canvasFalso(): { sector: SectorNieveCanvas; pintadas: () => Array<{ x: number; y: number; color: string }> } {
  const pintadas: Array<{ x: number; y: number; color: string }> = [];
  let fillStyle = "";
  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    fillRect(x: number, y: number) { pintadas.push({ x, y, color: fillStyle }); },
  };
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const textura = { needsUpdate: false };
  return { sector: { canvas, textura }, pintadas: () => pintadas };
}

test("registrarPisada pinta la casilla actual y marca la textura sucia", () => {
  const { sector, pintadas } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  const entidad = {};
  sector.textura.needsUpdate = false;
  gestor.registrarPisada(entidad, 5.5, 7.2);
  assert.equal(pintadas().length, 1);
  assert.deepEqual(pintadas()[0], { x: 5, y: 7, color: pintadas()[0].color });
  assert.ok(sector.textura.needsUpdate, "la textura debe marcarse needsUpdate tras pintar");
});

test("quedarse en la MISMA casilla no repinta (una entidad parada, o cruzando la misma casilla varios frames)", () => {
  const { sector, pintadas } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  const entidad = {};
  gestor.registrarPisada(entidad, 5.1, 7.1);
  gestor.registrarPisada(entidad, 5.9, 7.9); // sigue en la casilla (5,7)
  assert.equal(pintadas().length, 1);
});

test("moverse a una casilla nueva SÍ repinta", () => {
  const { sector, pintadas } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  const entidad = {};
  gestor.registrarPisada(entidad, 5.1, 7.1);
  gestor.registrarPisada(entidad, 6.1, 7.1);
  assert.equal(pintadas().length, 2);
});

test("dos entidades distintas en la misma casilla pintan cada una su propia pisada (no comparten estado)", () => {
  const { sector, pintadas } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  gestor.registrarPisada({}, 5.1, 7.1);
  gestor.registrarPisada({}, 5.5, 7.5);
  assert.equal(pintadas().length, 2);
});

test("sin sector materializado ahí (obtenerCanvasSector devuelve null): no revienta, simplemente no pinta nada", () => {
  const gestor = new GestorHuellasNieve(10, 32, () => null);
  assert.doesNotThrow(() => gestor.registrarPisada({}, 1, 1));
});

test("actualizar() restaura al blanco original pasado el tiempo, y solo entonces", () => {
  const { sector, pintadas } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  const t0 = 1_000_000;
  const originalNow = performance.now;
  (performance as any).now = () => t0;
  try {
    gestor.registrarPisada({}, 5, 7);
  } finally {
    (performance as any).now = originalNow;
  }
  assert.equal(pintadas().length, 1, "solo la pisada, sin restaurar todavía");
  gestor.actualizar(t0 + 1000); // muy pronto
  assert.equal(pintadas().length, 1, "no ha pasado el tiempo suficiente, no restaura");
  gestor.actualizar(t0 + 30000); // pasado de sobra
  assert.equal(pintadas().length, 2, "restaura exactamente una vez, al blanco original");
  assert.equal(pintadas()[1].color, "rgb(255,255,255)");
  gestor.actualizar(t0 + 60000);
  assert.equal(pintadas().length, 2, "una huella ya restaurada no se vuelve a tocar");
});

test("clavesActivas expone las huellas activas para depuración/tests", () => {
  const { sector } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, () => sector);
  assert.deepEqual(gestor.clavesActivas(), []);
  gestor.registrarPisada({}, 5, 7);
  assert.deepEqual(gestor.clavesActivas(), ["0_0:5_7"]);
});

test("olvidarSector quita las huellas de ESE sector sin tocar las de otros", () => {
  const { sector: s00 } = canvasFalso();
  const { sector: s10, pintadas: pintadasS10 } = canvasFalso();
  const gestor = new GestorHuellasNieve(10, 32, (sx) => (sx === 0 ? s00 : s10));
  gestor.registrarPisada({}, 5, 7); // sector 0_0
  gestor.registrarPisada({}, 325, 7); // sector 1_0
  gestor.olvidarSector(0, 0);
  gestor.actualizar(performance.now() + 999999);
  // la huella del sector 1_0 (nunca olvidada) SÍ se restaura pasado el tiempo
  assert.equal(pintadasS10().length, 2);
});
