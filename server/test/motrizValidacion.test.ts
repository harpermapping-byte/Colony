// Test de la validación de colocación "fuente:agua" (docs/GDD_Motriz.md,
// validarColocacion en server/src/construccion/construccion.ts) — mapa
// SINTÉTICO pequeño, sin depender del demo real. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MundoColision, TIPO } from "../src/mundo/colisiones";
import { IndiceParcelas } from "../src/construccion/parcelas";
import { ContextoConstruccion, validarColocacion } from "../src/construccion/construccion";
import { EntradaConstruible } from "../src/construccion/catalogo";

const ANCHO = 20, ALTO = 20;

function mundoVacio(): MundoColision {
  return {
    ancho: ANCHO,
    alto: ALTO,
    casillas: new Uint8Array(ANCHO * ALTO).fill(TIPO.TIERRA),
    velocidad: new Float32Array(ANCHO * ALTO).fill(1),
  };
}

/** Una parcela p_0001 que cubre x∈[5,14], y∈[5,14] — de sobra para una huella 3x3. */
function parcelaGrande(): IndiceParcelas {
  const indice = new Map<number, string>();
  for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) indice.set(y * ANCHO + x, "p_0001");
  return {
    anchoMapa: ANCHO,
    parcelas: new Map([["p_0001", { asentamiento: "test", nombre: "Ragnar", runs: [[5, 5, 14]], casillas: 100, topeProps: 50 }]]),
    indice,
  };
}

function crearCtx(): ContextoConstruccion {
  const mapa = mundoVacio();
  return {
    mapa,
    casillasBase: mapa.casillas.slice(),
    parcelas: parcelaGrande(),
    propiedades: new Map([["p_0001", { dueno: "Ragnar" }]]),
    ocupacion: new Map(),
    vivas: new Map(),
    conteoPorPropiedad: new Map(),
    jarls: new Set(),
  };
}

const MOLINO_AGUA: EntradaConstruible = {
  id: "molino_agua", categoria: "edificio", huella: [3, 3], colision: true, variantes: 1,
  energia: { produce: 100, fuente: "agua" },
};

const MOLINO_VIENTO: EntradaConstruible = {
  id: "molino_viento", categoria: "edificio", huella: [3, 3], colision: true, variantes: 1,
  energia: { produce: 80, fuente: "viento" },
};

test("validarColocacion: molino de agua SIN cauce adyacente, rechazado", () => {
  const ctx = crearCtx();
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: MOLINO_AGUA, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "el molino de agua necesita un cauce junto a su huella");
});

test("validarColocacion: molino de agua CON cauce justo pegado a la huella, aceptado", () => {
  const ctx = crearCtx();
  // huella 3x3 en (6,6)..(8,8); casilla de agua justo debajo de la huella (fuera de ella)
  ctx.mapa.casillas[9 * ANCHO + 7] = TIPO.AGUA;
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: MOLINO_AGUA, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, true);
});

test("validarColocacion: agua profunda también cuenta como cauce adyacente", () => {
  const ctx = crearCtx();
  ctx.mapa.casillas[9 * ANCHO + 7] = TIPO.AGUA_PROFUNDA;
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: MOLINO_AGUA, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, true);
});

test("validarColocacion: agua LEJOS de la huella (no adyacente) no cuenta", () => {
  const ctx = crearCtx();
  ctx.mapa.casillas[12 * ANCHO + 12] = TIPO.AGUA; // muy lejos de la huella en (6,6)-(8,8)
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: MOLINO_AGUA, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "el molino de agua necesita un cauce junto a su huella");
});

test("validarColocacion: una construcción sin fuente:agua no exige cauce (comportamiento de hoy, sin cambios)", () => {
  const ctx = crearCtx();
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: MOLINO_VIENTO, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, true);
});
