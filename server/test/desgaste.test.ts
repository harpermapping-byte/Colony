// Tests del sistema de desgaste/durabilidad (server/src/inventario/desgaste.ts).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  tieneDurabilidad,
  aplicarDesgasteInactividad,
  registrarUso,
  aplicarDanoArmadura,
  aplicarPenalizacionMuerte,
  estaRoto,
  factorDurabilidad,
  factorRendimiento,
  FACTOR_ITEM_ROTO,
  TASA_INACTIVIDAD_HORA,
  FACTOR_DESGASTE_ARMADURA,
  PENALIZACION_MUERTE,
} from "../src/inventario/desgaste";
import { EntradaCatalogoItem, ItemInstancia } from "../src/inventario/inventario";

const ESPADA: EntradaCatalogoItem = {
  tipo: "arma",
  huella: [1, 2],
  peso: 3,
  apilable: false,
  variantes: 1,
  colorDebug: "#8a8a90",
  ataqueFisico: 20,
  durabilidadMax: 100,
  desgastePorUso: 1,
};

const RECURSO_SIN_DESGASTE: EntradaCatalogoItem = {
  tipo: "recurso",
  huella: [1, 1],
  peso: 3,
  apilable: true,
  stackMax: 20,
  variantes: 2,
  colorDebug: "#8a8a90",
};

function instanciaDe(entrada: EntradaCatalogoItem): ItemInstancia {
  return {
    id: 1,
    itemId: "x",
    cantidad: 1,
    x: 0,
    y: 0,
    rot: 0,
    ...(entrada.durabilidadMax != null ? { durabilidad: entrada.durabilidadMax } : {}),
  };
}

test("tieneDurabilidad: solo los ítems con durabilidadMax se desgastan", () => {
  assert.strictEqual(tieneDurabilidad(ESPADA), true);
  assert.strictEqual(tieneDurabilidad(RECURSO_SIN_DESGASTE), false);
});

test("aplicarDesgasteInactividad: un recurso sin durabilidadMax nunca se toca", () => {
  const inst = instanciaDe(RECURSO_SIN_DESGASTE);
  aplicarDesgasteInactividad(inst, RECURSO_SIN_DESGASTE, 1_000_000);
  assert.strictEqual(inst.durabilidad, undefined);
  assert.strictEqual(inst.ultimoUso, undefined);
});

test("aplicarDesgasteInactividad: pierde TASA_INACTIVIDAD_HORA * horas * durabilidadMax", () => {
  const inst = instanciaDe(ESPADA);
  inst.ultimoUso = 0;
  const DIEZ_HORAS = 10 * 3_600_000;
  aplicarDesgasteInactividad(inst, ESPADA, DIEZ_HORAS);
  const esperado = 100 - 100 * TASA_INACTIVIDAD_HORA * 10;
  assert.ok(Math.abs(inst.durabilidad! - esperado) < 1e-9);
  assert.strictEqual(inst.ultimoUso, DIEZ_HORAS);
});

test("aplicarDesgasteInactividad: nunca baja de 0 aunque pase muchísimo tiempo", () => {
  const inst = instanciaDe(ESPADA);
  inst.ultimoUso = 0;
  aplicarDesgasteInactividad(inst, ESPADA, 100 * 3_600_000 * 1000); // muchísimas horas
  assert.strictEqual(inst.durabilidad, 0);
});

test("aplicarDesgasteInactividad: instancia recién creada (sin ultimoUso) no pierde nada la primera vez", () => {
  const inst = instanciaDe(ESPADA); // ultimoUso todavía undefined
  aplicarDesgasteInactividad(inst, ESPADA, 5_000_000);
  assert.strictEqual(inst.durabilidad, 100, "sin ultimoUso previo, el 'desde' es el propio ahora — cero horas transcurridas");
  assert.strictEqual(inst.ultimoUso, 5_000_000);
});

test("registrarUso: cierra el hueco de inactividad Y resta desgastePorUso, en ese orden", () => {
  const inst = instanciaDe(ESPADA);
  inst.ultimoUso = 0;
  const UNA_HORA = 3_600_000;
  registrarUso(inst, ESPADA, UNA_HORA, 1);
  const porInactividad = 100 * TASA_INACTIVIDAD_HORA * 1;
  const esperado = 100 - porInactividad - ESPADA.desgastePorUso!;
  assert.ok(Math.abs(inst.durabilidad! - esperado) < 1e-9);
});

test("registrarUso: varios usos de golpe restan desgastePorUso * usos", () => {
  const inst = instanciaDe(ESPADA);
  inst.ultimoUso = 0;
  registrarUso(inst, ESPADA, 0, 5); // mismo instante, sin desgaste por inactividad
  assert.strictEqual(inst.durabilidad, 100 - 5 * ESPADA.desgastePorUso!);
});

test("aplicarDanoArmadura: reparte el daño absorbido a partes iguales entre las piezas equipadas con durabilidad", () => {
  const casco: EntradaCatalogoItem = { ...ESPADA, tipo: "equipable", durabilidadMax: 50, desgastePorUso: 0 };
  const peto: EntradaCatalogoItem = { ...ESPADA, tipo: "equipable", durabilidadMax: 80, desgastePorUso: 0 };
  const iCasco = instanciaDe(casco);
  const iPeto = instanciaDe(peto);
  iCasco.ultimoUso = 0;
  iPeto.ultimoUso = 0;

  aplicarDanoArmadura(
    [
      { instancia: iCasco, entrada: casco },
      { instancia: iPeto, entrada: peto },
    ],
    20, // daño absorbido
    0
  );
  const perdidaPorPieza = (20 * FACTOR_DESGASTE_ARMADURA) / 2;
  assert.ok(Math.abs(iCasco.durabilidad! - (50 - perdidaPorPieza)) < 1e-9);
  assert.ok(Math.abs(iPeto.durabilidad! - (80 - perdidaPorPieza)) < 1e-9);
});

test("aplicarDanoArmadura: piezas sin durabilidadMax (cosméticas) no cuentan ni reciben desgaste", () => {
  const cosmetico: EntradaCatalogoItem = { ...RECURSO_SIN_DESGASTE, tipo: "equipable" };
  const conDurabilidad: EntradaCatalogoItem = { ...ESPADA, tipo: "equipable", durabilidadMax: 50, desgastePorUso: 0 };
  const iCosmetico = instanciaDe(cosmetico);
  const iConDurabilidad = instanciaDe(conDurabilidad);
  iConDurabilidad.ultimoUso = 0;

  aplicarDanoArmadura(
    [
      { instancia: iCosmetico, entrada: cosmetico },
      { instancia: iConDurabilidad, entrada: conDurabilidad },
    ],
    20,
    0
  );
  assert.strictEqual(iCosmetico.durabilidad, undefined);
  // TODO el daño (20) se lo lleva la única pieza con durabilidad, no se divide entre 2
  assert.ok(Math.abs(iConDurabilidad.durabilidad! - (50 - 20 * FACTOR_DESGASTE_ARMADURA)) < 1e-9);
});

test("aplicarDanoArmadura: sin piezas equipadas con durabilidad, no revienta", () => {
  assert.doesNotThrow(() => aplicarDanoArmadura([], 20, 0));
});

test("aplicarPenalizacionMuerte: -20% FLAT de durabilidadMax, no proporcional al daño de la muerte", () => {
  const inst = instanciaDe(ESPADA);
  inst.durabilidad = 60; // ya desgastada antes de morir
  inst.ultimoUso = 0;
  aplicarPenalizacionMuerte([{ instancia: inst, entrada: ESPADA }], 0);
  assert.strictEqual(inst.durabilidad, 60 - ESPADA.durabilidadMax! * PENALIZACION_MUERTE);
});

test("aplicarPenalizacionMuerte: nunca baja de 0", () => {
  const inst = instanciaDe(ESPADA);
  inst.durabilidad = 5;
  inst.ultimoUso = 0;
  aplicarPenalizacionMuerte([{ instancia: inst, entrada: ESPADA }], 0);
  assert.strictEqual(inst.durabilidad, 0);
});

test("estaRoto / factorDurabilidad: comportamiento en los extremos y a medio camino", () => {
  const inst = instanciaDe(ESPADA);
  assert.strictEqual(estaRoto(inst, ESPADA), false);
  assert.strictEqual(factorDurabilidad(inst, ESPADA), 1);

  inst.durabilidad = 50;
  assert.strictEqual(factorDurabilidad(inst, ESPADA), 0.5);
  assert.strictEqual(estaRoto(inst, ESPADA), false);

  inst.durabilidad = 0;
  assert.strictEqual(estaRoto(inst, ESPADA), true);
  assert.strictEqual(factorDurabilidad(inst, ESPADA), 0);

  // un recurso sin durabilidadMax nunca está roto y siempre rinde al 100%
  const instRecurso = instanciaDe(RECURSO_SIN_DESGASTE);
  assert.strictEqual(estaRoto(instRecurso, RECURSO_SIN_DESGASTE), false);
  assert.strictEqual(factorDurabilidad(instRecurso, RECURSO_SIN_DESGASTE), 1);
});

test("factorRendimiento (docs/GDD_Combate.md, 2026-09-03): combina estaRoto/factorDurabilidad — roto = SUELO fijo, NO 0 lineal", () => {
  const inst = instanciaDe(ESPADA);
  assert.strictEqual(factorRendimiento(inst, ESPADA), 1, "a tope, rinde al 100%");

  inst.durabilidad = 30;
  assert.strictEqual(factorRendimiento(inst, ESPADA), 0.3, "sana pero desgastada, decae lineal como factorDurabilidad");

  inst.durabilidad = 0;
  assert.strictEqual(factorRendimiento(inst, ESPADA), FACTOR_ITEM_ROTO, "rota: suelo fijo del 20%, no el 0% que daría factorDurabilidad sola");
  assert.notStrictEqual(FACTOR_ITEM_ROTO, 0, "el suelo fijo nunca es 0 — un arma rota sigue funcionando, con debuff");

  // un recurso sin durabilidadMax siempre rinde al 100%, nunca puede "romperse"
  const instRecurso = instanciaDe(RECURSO_SIN_DESGASTE);
  assert.strictEqual(factorRendimiento(instRecurso, RECURSO_SIN_DESGASTE), 1);
});
