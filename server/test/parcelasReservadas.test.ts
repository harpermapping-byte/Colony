// Tests de construccion/parcelas.ts::cargarParcelasDeReservas — construcción-
// en-regiones (docs/GDD_Ciudad_Capital.md §3bis, pedido 2026-08-29: "la
// capital es un sitio como las aldeas y POIs... pero con reglas especiales").
// Convierte los rectángulos ROTADOS que exporta el bake de ciudades/ en el
// mismo IndiceParcelas (runs [y,x0,x1]) que ya usa el Hub, para que
// construccion.ts no necesite saber de dónde viene la parcela.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { cargarParcelasDeReservas, parcelaEn, runsDe, topeDe } from "../src/construccion/parcelas";
import { ParcelaReservada } from "../src/mundo/mapaColision";

test("cargarParcelasDeReservas: [] de reservas da un IndiceParcelas vacío, sin reventar", () => {
  const parcelas = cargarParcelasDeReservas([], "capital_jarl_test", 100, 100, 30);
  assert.strictEqual(parcelas.parcelas.size, 0);
  assert.strictEqual(parcelas.indice.size, 0);
});

test("cargarParcelasDeReservas: rectángulo SIN rotar (rot=0) cubre exactamente su ancho x largo, centrado en x,y", () => {
  const reservas: ParcelaReservada[] = [{ tipo: "normal", x: 20, y: 20, rot: 0, ancho: 8, largo: 6 }];
  const parcelas = cargarParcelasDeReservas(reservas, "capital_jarl_test", 100, 100, 30);
  assert.strictEqual(parcelas.parcelas.size, 1);

  const [id] = parcelas.parcelas.keys();
  const parcela = parcelas.parcelas.get(id)!;
  assert.strictEqual(parcela.casillas, 8 * 6, "área == ancho*largo para un rectángulo axis-aligned");
  assert.strictEqual(parcela.topeProps, 30);
  assert.strictEqual(parcela.asentamiento, "capital_jarl_test");

  // centro en (20,20), semiancho 4, semilargo 3 -> x en [16,23], y en [17,22]
  assert.strictEqual(parcelaEn(parcelas, 16, 17), id);
  assert.strictEqual(parcelaEn(parcelas, 23, 22), id);
  assert.strictEqual(parcelaEn(parcelas, 15, 17), undefined, "una casilla fuera por la izquierda no debe pertenecer");
  assert.strictEqual(parcelaEn(parcelas, 24, 17), undefined, "una casilla fuera por la derecha no debe pertenecer");
});

test("cargarParcelasDeReservas: rotar 90° (Math.PI/2) intercambia ancho/largo en el mundo — el área no cambia", () => {
  const reservas: ParcelaReservada[] = [{ tipo: "especial", x: 50, y: 50, rot: Math.PI / 2, ancho: 10, largo: 4 }];
  const parcelas = cargarParcelasDeReservas(reservas, "capital_jarl_test", 100, 100, 20);
  const [id] = parcelas.parcelas.keys();
  const parcela = parcelas.parcelas.get(id)!;
  // el área rasterizada puede variar +-1 fila/columna por redondeo de píxel en los bordes,
  // pero debe rondar 10*4=40, nunca desviarse mucho
  assert.ok(Math.abs(parcela.casillas - 40) <= 6, `área tras rotar 90° debería rondar 40, salió ${parcela.casillas}`);

  // sin rotar, el rectángulo 10x4 centrado en (50,50) se extendería +-5 en x;
  // rotado 90° esa extensión pasa al eje Y — comprobamos que el ANCHO en X se redujo
  const anchosX = runsDe(parcelas, id).map(([, x0, x1]) => x1 - x0 + 1);
  const anchoMaximoX = Math.max(...anchosX);
  assert.ok(anchoMaximoX <= 5, `rotado 90°, la extensión en X debería ser ~4 (el 'largo' original), salió ${anchoMaximoX}`);
});

test("cargarParcelasDeReservas: varias reservas no se pisan y cada una conserva su tipo en el id", () => {
  const reservas: ParcelaReservada[] = [
    { tipo: "normal", x: 10, y: 10, rot: 0, ancho: 6, largo: 4 },
    { tipo: "normal", x: 30, y: 10, rot: 0, ancho: 6, largo: 4 },
    { tipo: "especial", x: 60, y: 60, rot: 0.3, ancho: 12, largo: 9 },
  ];
  const parcelas = cargarParcelasDeReservas(reservas, "capital_jarl_test", 200, 200, 30);
  assert.strictEqual(parcelas.parcelas.size, 3);

  const ids = [...parcelas.parcelas.keys()];
  assert.ok(ids.some((id) => id.includes("normal_000")));
  assert.ok(ids.some((id) => id.includes("normal_001")));
  assert.ok(ids.some((id) => id.includes("especial_002")));

  // ninguna casilla del índice apunta a más de una parcela a la vez (por construcción
  // del Map ya es imposible que "se pisen" en el índice, pero comprobamos que las 3
  // parcelas realmente aportaron casillas propias, no que una sobreescribió a otra)
  let totalCasillasEsperado = 0;
  for (const p of parcelas.parcelas.values()) totalCasillasEsperado += p.casillas;
  assert.strictEqual(parcelas.indice.size, totalCasillasEsperado);
});

test("cargarParcelasDeReservas: topeDe/runsDe funcionan igual que con parcelas pintadas a mano (mismo IndiceParcelas)", () => {
  const reservas: ParcelaReservada[] = [{ tipo: "normal", x: 15, y: 15, rot: 0, ancho: 4, largo: 4 }];
  const parcelas = cargarParcelasDeReservas(reservas, "capital_jarl_test", 100, 100, 12);
  const [id] = parcelas.parcelas.keys();
  assert.strictEqual(topeDe(parcelas, id), 12);
  assert.ok(runsDe(parcelas, id).length > 0);
  assert.strictEqual(topeDe(parcelas, "no_existe"), 0);
});
