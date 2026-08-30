// Tests de personaje/enfermedades.ts (docs/GDD_Enfermedades.md, pedido 2026-08-30).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  enfermedadesInicial, rodarInfeccionPorHerida, iniciarCatarroSiCorresponde,
  rodarGripePorFrio, resolverAutocuracionEnfermedades, tomarUnguentoCatarro, tomarJarabeGripe,
  tieneCatarro, tieneGripe, aplicarTopeVidaPorCatarro, multiplicadorVelocidadPorGripe,
  PROB_CATARRO_POR_HERIDA, PROB_GRIPE_POR_FRIO_INVIERNO, UNGUENTOS_PARA_CURAR_CATARRO,
  HORAS_AUTOCURAR_ENFERMEDAD, TOPE_VIDA_CATARRO, MULTIPLICADOR_VELOCIDAD_GRIPE,
} from "../src/personaje/enfermedades";

const rndSiempreSi = () => 0;
const rndSiempreNo = () => 0.999999;

test("enfermedadesInicial: sano, nada corriendo", () => {
  const e = enfermedadesInicial();
  assert.strictEqual(e.catarroDesde, null);
  assert.strictEqual(e.unguentosTomados, 0);
  assert.strictEqual(e.gripeDesde, null);
  assert.strictEqual(e.expuestoFrioPrevio, false);
  assert.strictEqual(tieneCatarro(e), false);
  assert.strictEqual(tieneGripe(e), false);
});

test("probabilidades tal cual pedidas por el streamer", () => {
  assert.strictEqual(PROB_CATARRO_POR_HERIDA, 0.1);
  assert.strictEqual(PROB_GRIPE_POR_FRIO_INVIERNO, 0.1);
  assert.strictEqual(UNGUENTOS_PARA_CURAR_CATARRO, 4);
  assert.strictEqual(TOPE_VIDA_CATARRO, 0.5);
  assert.strictEqual(MULTIPLICADOR_VELOCIDAD_GRIPE, 0.5);
  // 1 semana ingame = 7 días × 30 min reales/día (assets/mundo/tiempo.json) = 210 min = 3.5h.
  assert.strictEqual(HORAS_AUTOCURAR_ENFERMEDAD, 3.5);
});

test("rodarInfeccionPorHerida: respeta el rnd inyectado", () => {
  assert.strictEqual(rodarInfeccionPorHerida(rndSiempreSi), true);
  assert.strictEqual(rodarInfeccionPorHerida(rndSiempreNo), false);
});

test("iniciarCatarroSiCorresponde: arranca el reloj solo la primera vez", () => {
  const e = enfermedadesInicial();
  iniciarCatarroSiCorresponde(e, true, 1000);
  assert.strictEqual(e.catarroDesde, 1000);
  iniciarCatarroSiCorresponde(e, true, 2000); // ya estaba corriendo, no se reinicia
  assert.strictEqual(e.catarroDesde, 1000);
});

test("iniciarCatarroSiCorresponde: sin infección activa no hace nada", () => {
  const e = enfermedadesInicial();
  iniciarCatarroSiCorresponde(e, false, 1000);
  assert.strictEqual(e.catarroDesde, null);
});

test("rodarGripePorFrio: solo tira en el FLANCO no-frío→frío, nunca cada tick mientras se mantiene frío", () => {
  const e = enfermedadesInicial();
  rodarGripePorFrio(e, true, true, 1000, rndSiempreSi);
  assert.strictEqual(e.gripeDesde, 1000);
  const gripeDesdeAntes = e.gripeDesde;
  rodarGripePorFrio(e, true, true, 2000, rndSiempreSi); // sigue en frío, no vuelve a tirar
  assert.strictEqual(e.gripeDesde, gripeDesdeAntes);
});

test("rodarGripePorFrio: nunca fuera de invierno, aunque haga frío y el rnd acierte", () => {
  const e = enfermedadesInicial();
  rodarGripePorFrio(e, true, false, 1000, rndSiempreSi);
  assert.strictEqual(e.gripeDesde, null);
});

test("rodarGripePorFrio: con rnd que nunca acierta, nada pasa", () => {
  const e = enfermedadesInicial();
  rodarGripePorFrio(e, true, true, 1000, rndSiempreNo);
  assert.strictEqual(e.gripeDesde, null);
});

test("rodarGripePorFrio: una vez sale del frío, un nuevo flanco puede volver a tirar", () => {
  const e = enfermedadesInicial();
  rodarGripePorFrio(e, true, true, 1000, rndSiempreNo); // no acierta, pero registra el flanco
  rodarGripePorFrio(e, false, true, 2000, rndSiempreNo); // sale del frío
  rodarGripePorFrio(e, true, true, 3000, rndSiempreSi); // nuevo flanco, ahora sí
  assert.strictEqual(e.gripeDesde, 3000);
});

test("resolverAutocuracionEnfermedades: cura ambas tras 1 semana ingame (3.5h reales), no antes", () => {
  const e = enfermedadesInicial();
  e.catarroDesde = 0;
  e.unguentosTomados = 2;
  e.gripeDesde = 0;
  const limiteMs = HORAS_AUTOCURAR_ENFERMEDAD * 3_600_000;
  let r = resolverAutocuracionEnfermedades(e, limiteMs - 1);
  assert.strictEqual(r.catarroCurado, false);
  assert.strictEqual(r.gripeCurada, false);
  assert.strictEqual(e.catarroDesde, 0);
  r = resolverAutocuracionEnfermedades(e, limiteMs);
  assert.strictEqual(r.catarroCurado, true);
  assert.strictEqual(r.gripeCurada, true);
  assert.strictEqual(e.catarroDesde, null);
  assert.strictEqual(e.unguentosTomados, 0);
  assert.strictEqual(e.gripeDesde, null);
});

test("resolverAutocuracionEnfermedades: sin nada activo, no hace nada", () => {
  const e = enfermedadesInicial();
  const r = resolverAutocuracionEnfermedades(e, 999_999_999);
  assert.strictEqual(r.catarroCurado, false);
  assert.strictEqual(r.gripeCurada, false);
});

test("tomarUnguentoCatarro: hacen falta 4 dosis, no menos ni más", () => {
  const e = enfermedadesInicial();
  e.catarroDesde = 1000;
  assert.strictEqual(tomarUnguentoCatarro(e), false);
  assert.strictEqual(e.unguentosTomados, 1);
  assert.strictEqual(tomarUnguentoCatarro(e), false);
  assert.strictEqual(tomarUnguentoCatarro(e), false);
  assert.strictEqual(e.unguentosTomados, 3);
  assert.strictEqual(tomarUnguentoCatarro(e), true); // el 4º cura
  assert.strictEqual(e.catarroDesde, null);
  assert.strictEqual(e.unguentosTomados, 0);
});

test("tomarUnguentoCatarro: sin catarro activo, false (no gasta ungüento)", () => {
  const e = enfermedadesInicial();
  assert.strictEqual(tomarUnguentoCatarro(e), false);
  assert.strictEqual(e.unguentosTomados, 0);
});

test("tomarJarabeGripe: un solo jarabe cura al instante", () => {
  const e = enfermedadesInicial();
  e.gripeDesde = 1000;
  assert.strictEqual(tomarJarabeGripe(e), true);
  assert.strictEqual(e.gripeDesde, null);
});

test("tomarJarabeGripe: sin gripe activa, false", () => {
  const e = enfermedadesInicial();
  assert.strictEqual(tomarJarabeGripe(e), false);
});

test("aplicarTopeVidaPorCatarro: es un TECHO — baja si excede, nunca sube ni impide bajar más", () => {
  const e = enfermedadesInicial();
  e.catarroDesde = 1000;
  const jugador = { vida: 90, vidaMax: 100 };
  aplicarTopeVidaPorCatarro(e, jugador);
  assert.strictEqual(jugador.vida, 50); // 90 > 50% de 100 → baja al tope

  const jugadorBajo = { vida: 20, vidaMax: 100 };
  aplicarTopeVidaPorCatarro(e, jugadorBajo);
  assert.strictEqual(jugadorBajo.vida, 20); // ya estaba por debajo del tope, no sube
});

test("aplicarTopeVidaPorCatarro: sin catarro activo, no toca la vida", () => {
  const e = enfermedadesInicial();
  const jugador = { vida: 90, vidaMax: 100 };
  aplicarTopeVidaPorCatarro(e, jugador);
  assert.strictEqual(jugador.vida, 90);
});

test("multiplicadorVelocidadPorGripe: -50% con gripe activa, normal sin ella", () => {
  const e = enfermedadesInicial();
  assert.strictEqual(multiplicadorVelocidadPorGripe(e), 1);
  e.gripeDesde = 1000;
  assert.strictEqual(multiplicadorVelocidadPorGripe(e), 0.5);
});
