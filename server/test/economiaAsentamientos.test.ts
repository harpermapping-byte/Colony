// Tick de economía de la facción bandida (docs/GDD_Faccion_Bandidos.md §6,
// fase 1). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { Asentamiento, AlmacenDatos } from "../src/datos/bd";
import {
  calcularTick,
  ejecutarTickEconomia,
  asegurarAsentamientoBandido,
  COMIDA_CONSUMO_POR_TROPA,
  MADERA_GENERADA_POR_TROPA,
  COSTE_MURALLA_NIVEL2_MADERA,
  COSTE_EQUIPO_NIVEL2_HIERRO,
  NIVEL_MURALLA_MAX,
} from "../src/mundo/economiaAsentamientos";

function asentamientoBase(overrides: Partial<Asentamiento> = {}): Asentamiento {
  return {
    id: "aldea_bandidos_1", bando: "bandido", nivelMuralla: 1, nivelEquipo: 1,
    comida: 0, madera: 0, piedra: 0, hierro: 0, ...overrides,
  };
}

test("calcularTick: sin tropas vivas, nada cambia (ni consumo ni producción)", () => {
  const a = asentamientoBase({ comida: 10, madera: 5 });
  const siguiente = calcularTick(a, 0);
  assert.deepStrictEqual(siguiente, a);
});

test("calcularTick: consumo de comida y producción de recursos escalan con la población viva", () => {
  const a = asentamientoBase({ comida: 100 });
  const siguiente = calcularTick(a, 4);
  assert.strictEqual(siguiente.comida, 100 - 4 * COMIDA_CONSUMO_POR_TROPA);
  assert.strictEqual(siguiente.madera, 4 * MADERA_GENERADA_POR_TROPA);
});

test("calcularTick: la comida nunca baja de 0 (pasar hambre, no números negativos)", () => {
  const a = asentamientoBase({ comida: 1 });
  const siguiente = calcularTick(a, 5); // consumo = 5*2 = 10, muy por encima de lo que hay
  assert.strictEqual(siguiente.comida, 0);
});

test("calcularTick: sube nivel de muralla al alcanzar el umbral de madera, y descuenta el coste", () => {
  const a = asentamientoBase({ nivelMuralla: 1, madera: COSTE_MURALLA_NIVEL2_MADERA });
  const siguiente = calcularTick(a, 0); // sin tropas: ya había madera suficiente antes de este tick
  assert.strictEqual(siguiente.nivelMuralla, 2);
  assert.strictEqual(siguiente.madera, 0);
});

test("calcularTick: si NO llega al umbral, no sube de nivel y no descuenta nada", () => {
  const a = asentamientoBase({ nivelMuralla: 1, madera: COSTE_MURALLA_NIVEL2_MADERA - 1 });
  const siguiente = calcularTick(a, 0);
  assert.strictEqual(siguiente.nivelMuralla, 1);
  assert.strictEqual(siguiente.madera, COSTE_MURALLA_NIVEL2_MADERA - 1);
});

test("calcularTick: nivel de muralla nunca pasa de NIVEL_MURALLA_MAX aunque sobre madera", () => {
  const a = asentamientoBase({ nivelMuralla: NIVEL_MURALLA_MAX, madera: COSTE_MURALLA_NIVEL2_MADERA * 10 });
  const siguiente = calcularTick(a, 3);
  assert.strictEqual(siguiente.nivelMuralla, NIVEL_MURALLA_MAX);
  // Al estar ya al máximo, la madera generada este tick se queda acumulada, no se gasta
  assert.strictEqual(siguiente.madera, a.madera + 3 * MADERA_GENERADA_POR_TROPA);
});

test("calcularTick: sube nivel de equipo al alcanzar el umbral de hierro", () => {
  const a = asentamientoBase({ nivelEquipo: 1, hierro: COSTE_EQUIPO_NIVEL2_HIERRO });
  const siguiente = calcularTick(a, 0);
  assert.strictEqual(siguiente.nivelEquipo, 2);
  assert.strictEqual(siguiente.hierro, 0);
});

test("calcularTick es determinista: mismo estado + misma población = mismo resultado siempre", () => {
  const a = asentamientoBase({ comida: 50, madera: 100, hierro: 20 });
  const r1 = calcularTick(a, 3);
  const r2 = calcularTick(a, 3);
  assert.deepStrictEqual(r1, r2);
});

test("ejecutarTickEconomia: tick real contra SQLite, con tropas muertas que NO cuentan para la población", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearAsentamiento("aldea_bandidos_1");
  await bd.guardarAsentamiento({ ...a, comida: 100 });
  const t1 = await bd.crearTropa("aldea_bandidos_1", "recluta");
  await bd.crearTropa("aldea_bandidos_1", "guardia");
  await bd.marcarTropaMuerta(t1.id); // solo 1 tropa viva de las 2 creadas

  await ejecutarTickEconomia(bd);

  const [actualizado] = await bd.listarAsentamientos();
  assert.strictEqual(actualizado.comida, 100 - 1 * COMIDA_CONSUMO_POR_TROPA);
  assert.strictEqual(actualizado.madera, 1 * MADERA_GENERADA_POR_TROPA);
  await bd.cerrar();
});

test("asegurarAsentamientoBandido: crea la fila + guarnición inicial la primera vez, es idempotente después", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await asegurarAsentamientoBandido(bd, "aldea_bandidos_1");
  assert.strictEqual(a.bando, "bandido");

  const tropas = await bd.listarTropas("aldea_bandidos_1");
  assert.strictEqual(tropas.length, 7); // 1 lider + 2 guardia + 4 recluta (GUARNICION_INICIAL)
  assert.strictEqual(tropas.filter((t) => t.rango === "lider").length, 1);
  assert.strictEqual(tropas.filter((t) => t.rango === "guardia").length, 2);
  assert.strictEqual(tropas.filter((t) => t.rango === "recluta").length, 4);

  // Segunda llamada (ej. dos jugadores entrando a la misma región, o un
  // reinicio del proceso): NO duplica la guarnición.
  await asegurarAsentamientoBandido(bd, "aldea_bandidos_1");
  assert.strictEqual((await bd.listarTropas("aldea_bandidos_1")).length, 7);
  await bd.cerrar();
});
