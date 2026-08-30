// Tests de la lógica PURA de encurtido de pieles (server/src/construccion/curtido.ts,
// docs/GDD_Caza.md). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  EstadoCurtidor,
  estadoCurtidorInicial,
  aceptaEntradaCurtidor,
  huecoMaterialCurtidor,
  iniciarLoteCurtidor,
  curtidorListo,
  recolectarLoteCurtidor,
} from "../src/construccion/curtido";
import { EntradaCurtidor } from "../src/construccion/catalogo";
import { CatalogoItems } from "../src/inventario/inventario";

const CUBO_SAL: EntradaCurtidor = {
  materialCarga: "sal", materialPorUnidad: 2, capacidadMaxMaterial: 20,
  entradaFamilia: "cuero", entradaTier: 0, salida: "piel_salada", horas: 4,
};
const BARRIL_CURTIDO: EntradaCurtidor = {
  materialCarga: "curtiente", materialPorUnidad: 2, capacidadMaxMaterial: 20,
  entradaItemId: "piel_raspada", salida: "cuero_curtido", horas: 6,
};

const CATALOGO: CatalogoItems = {
  piel_fina: { tipo: "recurso", huella: [1, 1], peso: 1.2, apilable: true, variantes: 1, colorDebug: "#000", familiaMaterial: "cuero", tier: 0 },
  cuero_curtido: { tipo: "recurso", huella: [1, 1], peso: 1, apilable: true, variantes: 1, colorDebug: "#000", familiaMaterial: "cuero", tier: 1 },
  piel_raspada: { tipo: "recurso", huella: [1, 1], peso: 0.9, apilable: true, variantes: 1, colorDebug: "#000" },
  sal: { tipo: "recurso", huella: [1, 1], peso: 0.6, apilable: true, variantes: 1, colorDebug: "#000" },
};

test("estadoCurtidorInicial: mueble vacío, sin lote", () => {
  assert.deepStrictEqual(estadoCurtidorInicial(), { stock: 0 });
});

test("aceptaEntradaCurtidor: por familiaMaterial+tier (cubo_sal acepta cualquier piel cruda)", () => {
  assert.strictEqual(aceptaEntradaCurtidor(CUBO_SAL, "piel_fina", CATALOGO), true);
  assert.strictEqual(aceptaEntradaCurtidor(CUBO_SAL, "cuero_curtido", CATALOGO), false, "tier 1, no tier 0");
  assert.strictEqual(aceptaEntradaCurtidor(CUBO_SAL, "sal", CATALOGO), false, "sin familiaMaterial cuero");
  assert.strictEqual(aceptaEntradaCurtidor(CUBO_SAL, "desconocido", CATALOGO), false);
});

test("aceptaEntradaCurtidor: por itemId exacto (barril_curtido solo acepta piel_raspada)", () => {
  assert.strictEqual(aceptaEntradaCurtidor(BARRIL_CURTIDO, "piel_raspada", CATALOGO), true);
  assert.strictEqual(aceptaEntradaCurtidor(BARRIL_CURTIDO, "piel_fina", CATALOGO), false, "sin raspar todavía");
});

test("huecoMaterialCurtidor: capacidadMax menos el stock actual, nunca negativo", () => {
  assert.strictEqual(huecoMaterialCurtidor({ stock: 0 }, CUBO_SAL), 20);
  assert.strictEqual(huecoMaterialCurtidor({ stock: 15 }, CUBO_SAL), 5);
  assert.strictEqual(huecoMaterialCurtidor({ stock: 25 }, CUBO_SAL), 0, "sobrecargado en algún punto anterior, igual no baja de 0");
});

test("iniciarLoteCurtidor: consume stock proporcional y arranca el reloj", () => {
  const estado: EstadoCurtidor = { stock: 10 };
  const nuevo = iniciarLoteCurtidor(estado, CUBO_SAL, 3, 1_000);
  assert.ok(nuevo);
  assert.strictEqual(nuevo!.stock, 4, "10 - 3*2 = 4");
  assert.deepStrictEqual(nuevo!.lote, { cantidad: 3, iniciadoEn: 1_000 });
  assert.strictEqual(estado.stock, 10, "no muta el original");
});

test("iniciarLoteCurtidor: null si no hay stock suficiente", () => {
  const estado: EstadoCurtidor = { stock: 3 };
  assert.strictEqual(iniciarLoteCurtidor(estado, CUBO_SAL, 3, 1_000), null); // hacen falta 6
});

test("iniciarLoteCurtidor: null si ya hay un lote en curso (un mueble, un lote a la vez)", () => {
  const estado: EstadoCurtidor = { stock: 20, lote: { cantidad: 1, iniciadoEn: 0 } };
  assert.strictEqual(iniciarLoteCurtidor(estado, CUBO_SAL, 1, 1_000), null);
});

test("iniciarLoteCurtidor: null con cantidad <= 0", () => {
  assert.strictEqual(iniciarLoteCurtidor({ stock: 20 }, CUBO_SAL, 0, 1_000), null);
});

test("curtidorListo: false antes de que pasen las horas, true justo al cumplirse y después", () => {
  const estado: EstadoCurtidor = { stock: 0, lote: { cantidad: 1, iniciadoEn: 0 } };
  assert.strictEqual(curtidorListo(estado, CUBO_SAL, 3 * 3_600_000), false); // faltan 4h
  assert.strictEqual(curtidorListo(estado, CUBO_SAL, 4 * 3_600_000), true);
  assert.strictEqual(curtidorListo(estado, CUBO_SAL, 100 * 3_600_000), true);
});

test("curtidorListo: false si no hay ningún lote", () => {
  assert.strictEqual(curtidorListo({ stock: 5 }, CUBO_SAL, 999_999_999), false);
});

test("recolectarLoteCurtidor: null si no está listo o no hay lote", () => {
  assert.strictEqual(recolectarLoteCurtidor({ stock: 0 }, CUBO_SAL, 0), null, "sin lote");
  const enCurso: EstadoCurtidor = { stock: 0, lote: { cantidad: 2, iniciadoEn: 0 } };
  assert.strictEqual(recolectarLoteCurtidor(enCurso, CUBO_SAL, 1 * 3_600_000), null, "todavía no");
});

test("recolectarLoteCurtidor: entrega la cantidad del lote y deja el mueble vacío de lote, con el stock intacto", () => {
  const listo: EstadoCurtidor = { stock: 6, lote: { cantidad: 3, iniciadoEn: 0 } };
  const resultado = recolectarLoteCurtidor(listo, CUBO_SAL, 4 * 3_600_000);
  assert.ok(resultado);
  assert.strictEqual(resultado!.cantidad, 3);
  assert.deepStrictEqual(resultado!.estado, { stock: 6 });
});

test("pipeline completo simulado: piel_fina -> (cubo_sal) -> piel_salada -> raspar -> piel_raspada -> (barril_curtido) -> cuero_curtido", () => {
  // cubo_sal: cargar 6 sal, meter 3 piel_fina
  let sal: EstadoCurtidor = { stock: 0 };
  sal = { stock: sal.stock + 6 };
  assert.ok(aceptaEntradaCurtidor(CUBO_SAL, "piel_fina", CATALOGO));
  const conLote = iniciarLoteCurtidor(sal, CUBO_SAL, 3, 0)!;
  assert.ok(conLote);
  assert.ok(!curtidorListo(conLote, CUBO_SAL, 1 * 3_600_000));
  const recogidoSal = recolectarLoteCurtidor(conLote, CUBO_SAL, 4 * 3_600_000)!;
  assert.strictEqual(recogidoSal.cantidad, 3, "3 piel_salada");

  // raspar (fuera de este módulo, acción de inventario instantánea) — piel_salada -> piel_raspada, misma cantidad, sin estado a probar aquí.

  // barril_curtido: cargar 6 curtiente, meter 3 piel_raspada
  let curtiente: EstadoCurtidor = { stock: 6 };
  assert.ok(aceptaEntradaCurtidor(BARRIL_CURTIDO, "piel_raspada", CATALOGO));
  const loteFinal = iniciarLoteCurtidor(curtiente, BARRIL_CURTIDO, 3, 0)!;
  assert.ok(loteFinal);
  const recogidoFinal = recolectarLoteCurtidor(loteFinal, BARRIL_CURTIDO, 6 * 3_600_000)!;
  assert.strictEqual(recogidoFinal.cantidad, 3, "3 cuero_curtido");
});
