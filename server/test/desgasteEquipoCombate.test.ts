// Tests de desgaste de lo EQUIPADO durante combate (docs/GDD_Combate.md,
// pedido 2026-09-03: "conectalo obviamente tambien con armas") —
// server/src/inventario/desgasteEquipoCombate.ts. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { aplicarDesgasteCombate, durabilidadEquipadaDe } from "../src/inventario/desgasteEquipoCombate";
import { CatalogoItems, SlotsEquipo } from "../src/inventario/inventario";

const CATALOGO: CatalogoItems = {
  espada_corta: {
    tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 2], peso: 2, apilable: false,
    variantes: 1, colorDebug: "#000", ataqueFisico: 10, durabilidadMax: 100, desgastePorUso: 3,
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

test("aplicarDesgasteCombate: golpesDados > 0 desgasta SOLO el arma de manoPrincipal (nunca la armadura), arranca a durabilidadMax", () => {
  const equipo: SlotsEquipo = { manoPrincipal: "espada_corta", torso: "pechera_cuero" };
  const ahora = Date.now();
  aplicarDesgasteCombate("guerrero_daga", equipo, CATALOGO, 4, 0, ahora); // 4 golpes * 3 desgastePorUso = 12
  assert.strictEqual(durabilidadEquipadaDe("guerrero_daga", "manoPrincipal"), 100 - 12);
  assert.strictEqual(durabilidadEquipadaDe("guerrero_daga", "torso"), undefined, "sin absorbido, la armadura ni se toca (ni se trackea)");
});

test("aplicarDesgasteCombate: se acumula entre llamadas para el MISMO jugador (no reinicia a full cada combate)", () => {
  const equipo: SlotsEquipo = { manoPrincipal: "espada_corta" };
  const ahora = Date.now();
  // Mismo `ahoraMs` en las dos llamadas: cero desgaste por inactividad de
  // por medio (aplicarDesgasteInactividad, ver desgaste.ts) — así el
  // resultado es exacto, sin margen de error que justificar.
  aplicarDesgasteCombate("guerrero_acumula", equipo, CATALOGO, 2, 0, ahora); // -6
  aplicarDesgasteCombate("guerrero_acumula", equipo, CATALOGO, 3, 0, ahora); // -9 más
  assert.strictEqual(durabilidadEquipadaDe("guerrero_acumula", "manoPrincipal"), 100 - 6 - 9);
});

test("aplicarDesgasteCombate: danoAbsorbido > 0 reparte entre TODA la armadura equipada con durabilidad, ignora manoPrincipal y piezas sin durabilidadMax", () => {
  const equipo: SlotsEquipo = { manoPrincipal: "espada_corta", torso: "pechera_cuero", cabeza: "casco_hierro", anillo: "anillo_cobre" };
  const ahora = Date.now();
  aplicarDesgasteCombate("tanque", equipo, CATALOGO, 0, 20, ahora); // FACTOR_DESGASTE_ARMADURA=0.08 -> 20*0.08=1.6, repartido entre 2 piezas (torso+cabeza) = 0.8 cada una
  assert.strictEqual(durabilidadEquipadaDe("tanque", "torso"), 60 - 0.8);
  assert.strictEqual(durabilidadEquipadaDe("tanque", "cabeza"), 40 - 0.8);
  assert.strictEqual(durabilidadEquipadaDe("tanque", "manoPrincipal"), undefined, "el arma no se desgasta por defender, solo por atacar");
  assert.strictEqual(durabilidadEquipadaDe("tanque", "anillo"), undefined, "sin durabilidadMax, nunca se trackea");
});

test("aplicarDesgasteCombate: no hace nada (no lanza, no trackea) si golpesDados/danoAbsorbido son 0, o si el jugador no tiene equipo", () => {
  assert.doesNotThrow(() => aplicarDesgasteCombate("nadie", {}, CATALOGO, 0, 0, Date.now()));
  assert.doesNotThrow(() => aplicarDesgasteCombate("nadie2", { manoPrincipal: "espada_corta" }, CATALOGO, 0, 0, Date.now()));
  assert.strictEqual(durabilidadEquipadaDe("nadie2", "manoPrincipal"), undefined);
});

test("aplicarDesgasteCombate: itemId desconocido en el catálogo no lanza, esa pieza simplemente se ignora", () => {
  const equipo: SlotsEquipo = { manoPrincipal: "arma_que_no_existe", torso: "pieza_fantasma" };
  assert.doesNotThrow(() => aplicarDesgasteCombate("jugadorFantasma", equipo, CATALOGO, 3, 10, Date.now()));
  assert.strictEqual(durabilidadEquipadaDe("jugadorFantasma", "manoPrincipal"), undefined);
});

test("aplicarDesgasteCombate: nunca deja la durabilidad por debajo de 0, aunque el desgaste acumulado la supere", () => {
  const equipo: SlotsEquipo = { manoPrincipal: "espada_corta" };
  aplicarDesgasteCombate("desgastaTodo", equipo, CATALOGO, 1000, 0, Date.now()); // 1000*3 >> 100
  assert.strictEqual(durabilidadEquipadaDe("desgastaTodo", "manoPrincipal"), 0);
});

test("aplicarDesgasteCombate: reequipar un itemId DISTINTO en el mismo slot arranca ese slot de nuevo a plena durabilidad (no arrastra el desgaste del arma anterior)", () => {
  const catalogoConSegundaArma: CatalogoItems = {
    ...CATALOGO,
    daga: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 0.8, apilable: false, variantes: 1, colorDebug: "#000", ataqueFisico: 6, durabilidadMax: 60, desgastePorUso: 1 },
  };
  const ahora = Date.now();
  aplicarDesgasteCombate("cambiaDeArma", { manoPrincipal: "espada_corta" }, catalogoConSegundaArma, 10, 0, ahora); // -30
  assert.strictEqual(durabilidadEquipadaDe("cambiaDeArma", "manoPrincipal"), 70);
  aplicarDesgasteCombate("cambiaDeArma", { manoPrincipal: "daga" }, catalogoConSegundaArma, 5, 0, ahora); // daga: -5, NO 65
  assert.strictEqual(durabilidadEquipadaDe("cambiaDeArma", "manoPrincipal"), 55, "60 (full de la daga) - 5, no arrastra el 70 de la espada");
});
