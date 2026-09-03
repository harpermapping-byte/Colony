// Tests de desgaste de lo EQUIPADO durante combate (docs/GDD_Combate.md,
// pedido 2026-09-03: "conectalo obviamente tambien con armas") —
// server/src/inventario/desgasteEquipoCombate.ts. Desde 2026-09-03 opera
// sobre el InventarioJugador REAL (equipo+equipoDurabilidad), ya no sobre un
// Map de proceso propio — ver el header del módulo para el porqué.
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { aplicarDesgasteCombate } from "../src/inventario/desgasteEquipoCombate";
import { CatalogoItems, InventarioJugador, SlotsEquipo, crearContenedor } from "../src/inventario/inventario";

const CATALOGO: CatalogoItems = {
  espada_corta: {
    tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 2], peso: 2, apilable: false,
    variantes: 1, colorDebug: "#000", ataqueFisico: 10, durabilidadMax: 100, desgastePorUso: 3,
  },
  daga: {
    tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 0.8, apilable: false,
    variantes: 1, colorDebug: "#000", ataqueFisico: 6, durabilidadMax: 60, desgastePorUso: 1,
  },
  pechera_cuero: {
    tipo: "equipable", slotEquipo: "torso", huella: [2, 2], peso: 3, apilable: false,
    variantes: 1, colorDebug: "#000", defensaFisica: 8, durabilidadMax: 60, desgastePorUso: 1,
  },
  casco_hierro: {
    tipo: "equipable", slotEquipo: "cabeza", huella: [1, 1], peso: 1.5, apilable: false,
    variantes: 1, colorDebug: "#000", defensaFisica: 4, durabilidadMax: 40, desgastePorUso: 1,
  },
  anillo_cobre: {
    // sin durabilidadMax — cosmético, nunca se desgasta (mismo criterio que desgaste.test.ts).
    tipo: "equipable", slotEquipo: "anillo", huella: [1, 1], peso: 0.1, apilable: false,
    variantes: 1, colorDebug: "#000",
  },
};

/** InventarioJugador mínimo para estos tests — solo `equipo`/`equipoDurabilidad` importan aquí. */
function invCon(equipo: SlotsEquipo, equipoDurabilidad: Record<string, number> = {}): InventarioJugador {
  return { cuerpo: crearContenedor(1, 1), extras: new Map(), equipo, equipoBlueprintRopa: {}, equipoDurabilidad };
}

test("aplicarDesgasteCombate: golpesDados > 0 desgasta SOLO el arma de manoPrincipal (nunca la armadura), arranca a durabilidadMax", () => {
  const inv = invCon({ manoPrincipal: "espada_corta", torso: "pechera_cuero" });
  const ahora = Date.now();
  aplicarDesgasteCombate(inv, CATALOGO, 4, 0, ahora); // 4 golpes * 3 desgastePorUso = 12
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], 100 - 12);
  assert.strictEqual(inv.equipoDurabilidad["torso"], undefined, "sin absorbido, la armadura ni se toca (ni se trackea)");
});

test("aplicarDesgasteCombate: se acumula entre llamadas para el MISMO inventario (no reinicia a full cada combate)", () => {
  const inv = invCon({ manoPrincipal: "espada_corta" });
  const ahora = Date.now();
  // Mismo `ahoraMs` en las dos llamadas: cero desgaste por inactividad de
  // por medio (aplicarDesgasteInactividad, ver desgaste.ts) — así el
  // resultado es exacto, sin margen de error que justificar.
  aplicarDesgasteCombate(inv, CATALOGO, 2, 0, ahora); // -6
  aplicarDesgasteCombate(inv, CATALOGO, 3, 0, ahora); // -9 más
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], 100 - 6 - 9);
});

test("aplicarDesgasteCombate: danoAbsorbido > 0 reparte entre TODA la armadura equipada con durabilidad, ignora manoPrincipal y piezas sin durabilidadMax", () => {
  const inv = invCon({ manoPrincipal: "espada_corta", torso: "pechera_cuero", cabeza: "casco_hierro", anillo: "anillo_cobre" });
  const ahora = Date.now();
  aplicarDesgasteCombate(inv, CATALOGO, 0, 20, ahora); // FACTOR_DESGASTE_ARMADURA=0.08 -> 20*0.08=1.6, repartido entre 2 piezas (torso+cabeza) = 0.8 cada una
  assert.strictEqual(inv.equipoDurabilidad["torso"], 60 - 0.8);
  assert.strictEqual(inv.equipoDurabilidad["cabeza"], 40 - 0.8);
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], undefined, "el arma no se desgasta por defender, solo por atacar");
  assert.strictEqual(inv.equipoDurabilidad["anillo"], undefined, "sin durabilidadMax, nunca se trackea");
});

test("aplicarDesgasteCombate: no hace nada (no lanza, no trackea) si golpesDados/danoAbsorbido son 0, o si no hay nada equipado", () => {
  assert.doesNotThrow(() => aplicarDesgasteCombate(invCon({}), CATALOGO, 0, 0, Date.now()));
  const inv = invCon({ manoPrincipal: "espada_corta" });
  assert.doesNotThrow(() => aplicarDesgasteCombate(inv, CATALOGO, 0, 0, Date.now()));
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], undefined);
});

test("aplicarDesgasteCombate: itemId desconocido en el catálogo no lanza, esa pieza simplemente se ignora", () => {
  const inv = invCon({ manoPrincipal: "arma_que_no_existe", torso: "pieza_fantasma" });
  assert.doesNotThrow(() => aplicarDesgasteCombate(inv, CATALOGO, 3, 10, Date.now()));
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], undefined);
});

test("aplicarDesgasteCombate: nunca deja la durabilidad por debajo de 0, aunque el desgaste acumulado la supere", () => {
  const inv = invCon({ manoPrincipal: "espada_corta" });
  aplicarDesgasteCombate(inv, CATALOGO, 1000, 0, Date.now()); // 1000*3 >> 100
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], 0);
});

test("aplicarDesgasteCombate: reequipar un itemId DISTINTO en el mismo slot arranca ese slot de nuevo a plena durabilidad (equipoDurabilidad ya se limpió al desequipar, mismo flujo real de equiparItem/desequiparItem)", () => {
  const inv = invCon({ manoPrincipal: "espada_corta" });
  const ahora = Date.now();
  aplicarDesgasteCombate(inv, CATALOGO, 10, 0, ahora); // -30
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], 70);

  // Cambiar de arma en el flujo real pasa por desequiparItem (limpia
  // equipoDurabilidad[slot]) antes de equiparItem (la vuelve a fijar) — se
  // simula aquí borrando la entrada a mano, sin arrastrar el 70 de la espada.
  delete inv.equipoDurabilidad["manoPrincipal"];
  inv.equipo.manoPrincipal = "daga";
  aplicarDesgasteCombate(inv, CATALOGO, 5, 0, ahora); // daga: -5, NO 65
  assert.strictEqual(inv.equipoDurabilidad["manoPrincipal"], 55, "60 (full de la daga) - 5, no arrastra el 70 de la espada");
});
