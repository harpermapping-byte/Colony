// Test de "requiereConstruibleAdyacente" (docs/GDD_Cocina.md, olla_grande/
// estructura_palos — validarColocacion en server/src/construccion/construccion.ts)
// — mismo patrón sintético que motrizValidacion.test.ts (cauce adyacente),
// pero mirando CONSTRUCCIONES vecinas en vez de terreno. Ejecutar: npm test desde server/.
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

/** Coloca una construcción viva de 1x1 ya existente en (x,y), con id fijo — para probar adyacencia. */
function plantarVecino(ctx: ContextoConstruccion, x: number, y: number, objeto: string, id = 999) {
  const clave = y * ANCHO + x;
  ctx.ocupacion.set(clave, id);
  ctx.vivas.set(id, {
    id, propiedad: "p_0001", objeto, categoria: "exterior",
    x, y, rot: 0, variante: 0, colision: true, huella: [1, 1],
  } as any);
}

const OLLA_GRANDE: EntradaConstruible = {
  id: "olla_grande", categoria: "exterior", huella: [1, 1], colision: true, variantes: 1,
  requiereConstruibleAdyacente: "estructura_palos",
};

const ESTRUCTURA_PALOS: EntradaConstruible = {
  id: "estructura_palos", categoria: "exterior", huella: [1, 1], colision: true, variantes: 1,
  requiereConstruibleAdyacente: ["hoguera_campamento", "chimenea_cocina"],
};

test("requiereConstruibleAdyacente: sin nada alrededor, rechazado", () => {
  const ctx = crearCtx();
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: OLLA_GRANDE, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "esto necesita estructura_palos junto a su huella");
});

test("requiereConstruibleAdyacente: con estructura_palos pegada, aceptado", () => {
  const ctx = crearCtx();
  plantarVecino(ctx, 7, 6, "estructura_palos");
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: OLLA_GRANDE, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, true);
});

test("requiereConstruibleAdyacente: el tipo vecino tiene que coincidir exacto", () => {
  const ctx = crearCtx();
  plantarVecino(ctx, 7, 6, "hoguera_campamento");
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: OLLA_GRANDE, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
});

test("requiereConstruibleAdyacente: una construcción lejos (no adyacente) no cuenta", () => {
  const ctx = crearCtx();
  plantarVecino(ctx, 12, 12, "estructura_palos");
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: OLLA_GRANDE, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
});

test("requiereConstruibleAdyacente: admite una LISTA de tipos válidos (OR) — cualquiera de los dos vale", () => {
  const ctxConHoguera = crearCtx();
  plantarVecino(ctxConHoguera, 7, 6, "hoguera_campamento");
  assert.strictEqual(validarColocacion(ctxConHoguera, { nombre: "Ragnar", entrada: ESTRUCTURA_PALOS, x: 6, y: 6, rot: 0 }).ok, true);

  const ctxConChimenea = crearCtx();
  plantarVecino(ctxConChimenea, 7, 6, "chimenea_cocina");
  assert.strictEqual(validarColocacion(ctxConChimenea, { nombre: "Ragnar", entrada: ESTRUCTURA_PALOS, x: 6, y: 6, rot: 0 }).ok, true);

  const ctxSinNada = crearCtx();
  const r = validarColocacion(ctxSinNada, { nombre: "Ragnar", entrada: ESTRUCTURA_PALOS, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "esto necesita hoguera_campamento o chimenea_cocina junto a su huella");
});

test("requiereConstruibleAdyacente: una construcción sin este campo no exige nada (comportamiento de hoy, sin cambios)", () => {
  const ctx = crearCtx();
  const SIN_CAMPO: EntradaConstruible = { id: "cuenco_cocina", categoria: "exterior", huella: [1, 1], colision: true, variantes: 1 };
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: SIN_CAMPO, x: 6, y: 6, rot: 0 });
  assert.strictEqual(r.ok, true);
});
