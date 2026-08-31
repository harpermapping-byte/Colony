// Tests de validarColocacionPlantilla (server/src/construccion/construccion.ts,
// docs/GDD_Produccion.md) — mapa SINTÉTICO pequeño, sin depender del demo real.
import { test } from "node:test";
import * as assert from "node:assert";
import { MundoColision, TIPO } from "../src/mundo/colisiones";
import { IndiceParcelas } from "../src/construccion/parcelas";
import { ContextoConstruccion, validarColocacionPlantilla } from "../src/construccion/construccion";
import { EntradaConstruible } from "../src/construccion/catalogo";

const ANCHO = 40, ALTO = 40;
const CAPITAL = { x: 20, y: 20 };
const RADIO = 10;

function mundoVacio(): MundoColision {
  return {
    ancho: ANCHO,
    alto: ALTO,
    casillas: new Uint8Array(ANCHO * ALTO).fill(TIPO.TIERRA),
    velocidad: new Float32Array(ANCHO * ALTO).fill(1),
  };
}

function parcelasVacias(): IndiceParcelas {
  return { anchoMapa: ANCHO, parcelas: new Map(), indice: new Map() };
}

/** Una parcela p_0001 cubriendo x∈[15,19], y∈[15,19] — DENTRO del radio de la capital, para probar el rechazo "hay una parcela ahí" sin confundirlo con el rechazo por radio. */
function parcelasConUnBloque(): IndiceParcelas {
  const indice = new Map<number, string>();
  for (let y = 15; y <= 19; y++) for (let x = 15; x <= 19; x++) indice.set(y * ANCHO + x, "p_0001");
  return {
    anchoMapa: ANCHO,
    parcelas: new Map([["p_0001", { asentamiento: "test", nombre: "x", runs: [[15, 15, 19]], casillas: 25, topeProps: 5 }]]),
    indice,
  };
}

function crearCtx(parcelas: IndiceParcelas): ContextoConstruccion {
  const mapa = mundoVacio();
  return {
    mapa,
    casillasBase: mapa.casillas.slice(),
    parcelas,
    propiedades: new Map(),
    ocupacion: new Map(),
    vivas: new Map(),
    conteoPorPropiedad: new Map(),
    jarls: new Set(["eljarl"]),
  };
}

const ASERRADERO: EntradaConstruible = {
  id: "aserradero", categoria: "edificio", huella: [3, 3], colision: true, variantes: 1, plantillaJarl: true,
};

// Proyecto especial del jarl (docs/GDD_Ciudad_Capital.md §5ter, generalización
// 2026-08-31): a diferencia de una plantilla normal, SÍ puede pisar parcela.
const SALON_JARL: EntradaConstruible = {
  id: "salon_jarl", categoria: "edificio", huella: [3, 3], colision: true, variantes: 1, proyectoJarl: true,
};

test("validarColocacionPlantilla: solo el jarl coloca plantillas", () => {
  const ctx = crearCtx(parcelasVacias());
  const r = validarColocacionPlantilla(ctx, { nombre: "Ragnar", entrada: ASERRADERO, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "solo el jarl coloca plantillas");
});

test("validarColocacionPlantilla: dentro del radio y en tierra libre, el jarl la coloca", () => {
  const ctx = crearCtx(parcelasVacias());
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: ASERRADERO, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, true);
});

test("validarColocacionPlantilla: fuera del radio de la capital, rechazada", () => {
  const ctx = crearCtx(parcelasVacias());
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: ASERRADERO, x: 0, y: 0, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "fuera del radio de plantillas de la capital");
});

test("validarColocacionPlantilla: nunca pisa una parcela ya asignada, aunque esté dentro del radio", () => {
  const ctx = crearCtx(parcelasConUnBloque());
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: ASERRADERO, x: 16, y: 16, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "hay una parcela ahí — las plantillas van fuera de las parcelas");
});

test("validarColocacionPlantilla: rechaza agua/sólido igual que la construcción normal", () => {
  const ctx = crearCtx(parcelasVacias());
  ctx.mapa.casillas[19 * ANCHO + 19] = TIPO.AGUA;
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: ASERRADERO, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "casilla no construible (agua u obstáculo)");
});

test("validarColocacionPlantilla: rechaza si otra construcción ya ocupa la casilla", () => {
  const ctx = crearCtx(parcelasVacias());
  ctx.ocupacion.set(19 * ANCHO + 19, 42);
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: ASERRADERO, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "casilla ocupada por otra construcción");
});

// --- Generalización a proyectos especiales del jarl (docs/GDD_Ciudad_Capital.md §5ter) ---

test("validarColocacionPlantilla: un proyecto especial SÍ puede pisar una parcela existente (\"donde quiera\")", () => {
  const ctx = crearCtx(parcelasConUnBloque());
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: SALON_JARL, x: 16, y: 16, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, true);
});

test("validarColocacionPlantilla: un proyecto especial sigue exigiendo tierra libre (agua/obstáculo)", () => {
  const ctx = crearCtx(parcelasVacias());
  ctx.mapa.casillas[19 * ANCHO + 19] = TIPO.AGUA;
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: SALON_JARL, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "casilla no construible (agua u obstáculo)");
});

test("validarColocacionPlantilla: un proyecto especial sigue exigiendo estar dentro del radio de la capital", () => {
  const ctx = crearCtx(parcelasVacias());
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: SALON_JARL, x: 0, y: 0, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "fuera del radio de plantillas de la capital");
});

test("validarColocacionPlantilla: tope de UNO por asentamiento para el mismo proyecto especial", () => {
  const ctx = crearCtx(parcelasVacias());
  ctx.vivas.set(1, {
    id: 1, propiedad: "pt_test_10_10", objeto: "salon_jarl", categoria: "edificio",
    x: 10, y: 10, rot: 0, variante: 0, colision: true, claves: [],
  });
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: SALON_JARL, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "ya existe un proyecto especial de este tipo en el asentamiento");
});

test("validarColocacionPlantilla: el tope de proyecto especial no afecta a OTRO tipo de proyecto", () => {
  const ctx = crearCtx(parcelasVacias());
  ctx.vivas.set(1, {
    id: 1, propiedad: "pt_test_10_10", objeto: "gran_mercado", categoria: "edificio",
    x: 10, y: 10, rot: 0, variante: 0, colision: true, claves: [],
  });
  const r = validarColocacionPlantilla(ctx, { nombre: "ElJarl", entrada: SALON_JARL, x: 18, y: 18, rot: 0 }, CAPITAL, RADIO);
  assert.strictEqual(r.ok, true);
});
