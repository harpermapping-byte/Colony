// Tests de personaje/anatomia.ts (pedido 2026-08-30, adaptado de un spec externo).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  anatomiaInicial, zonaInicial, ZONAS, ZONAS_AMPUTABLES,
  elegirZonaGolpeada, resolverGolpeAnatomico, aplicarGolpe,
  aplicarDrenajeAnatomico, resolverCuracionesEnCurso, estaCritico,
  multiplicadorVelocidadPorFractura, multiplicadorVelocidadPorCuracion, brazoInutilizado,
  usarVenda, usarTablilla, operarCirugia, instalarProtesis,
  PROB_SANGRADO, PROB_AMPUTACION_CORTANTE, PROB_FRACTURA_CONTUNDENTE, PROB_INFECCION_SIN_UNGUENTO,
  HORAS_CURAR_VENDA, HORAS_CURAR_TABLILLA, UMBRAL_CRITICO,
} from "../src/personaje/anatomia";

const rndSiempreSi = () => 0; // < cualquier probabilidad > 0
const rndSiempreNo = () => 0.999999;

test("anatomiaInicial: las 6 zonas, todo limpio", () => {
  const a = anatomiaInicial();
  assert.strictEqual(Object.keys(a).length, 6);
  for (const z of ZONAS) {
    assert.deepStrictEqual(a[z], zonaInicial());
  }
});

test("elegirZonaGolpeada: siempre una de las 6 zonas válidas", () => {
  for (const rnd of [() => 0, () => 0.999999, () => 0.5]) {
    assert.ok(ZONAS.includes(elegirZonaGolpeada(rnd)));
  }
});

test("resolverGolpeAnatomico: cortante puede sangrar Y amputar (tiradas independientes)", () => {
  const r = resolverGolpeAnatomico("cortante", rndSiempreSi);
  assert.strictEqual(r.sangrado, true);
  assert.strictEqual(r.fractura, false);
  // amputación solo si la zona sorteada es amputable
  assert.strictEqual(r.amputacion, ZONAS_AMPUTABLES.includes(r.zona));
});

test("resolverGolpeAnatomico: contundente solo puede fracturar, nunca sangrar ni amputar", () => {
  const r = resolverGolpeAnatomico("contundente", rndSiempreSi);
  assert.strictEqual(r.fractura, true);
  assert.strictEqual(r.sangrado, false);
  assert.strictEqual(r.amputacion, false);
});

test("resolverGolpeAnatomico: perforante sangra como cortante pero nunca amputa", () => {
  const r = resolverGolpeAnatomico("perforante", rndSiempreSi);
  assert.strictEqual(r.sangrado, true);
  assert.strictEqual(r.amputacion, false);
});

test("resolverGolpeAnatomico: mágico/fuego no hacen nada todavía (reservados, sin arma que los use)", () => {
  const r = resolverGolpeAnatomico("magico", rndSiempreSi);
  assert.strictEqual(r.sangrado, false);
  assert.strictEqual(r.fractura, false);
  assert.strictEqual(r.amputacion, false);
});

test("resolverGolpeAnatomico: con rnd que nunca acierta, nada pasa", () => {
  const r = resolverGolpeAnatomico("cortante", rndSiempreNo);
  assert.strictEqual(r.sangrado, false);
  assert.strictEqual(r.amputacion, false);
});

test("probabilidades tal cual pedidas por el streamer", () => {
  assert.strictEqual(PROB_SANGRADO, 0.2);
  assert.strictEqual(PROB_AMPUTACION_CORTANTE, 0.01);
  assert.strictEqual(PROB_FRACTURA_CONTUNDENTE, 0.1);
});

test("aplicarGolpe: sangrado activa la zona y reabre si estaba cicatrizando", () => {
  const z = zonaInicial();
  z.vendadoDesde = 1000;
  aplicarGolpe(z, { zona: "torso", sangrado: true, fractura: false, amputacion: false });
  assert.strictEqual(z.sangrado, true);
  assert.strictEqual(z.vendadoDesde, null, "un golpe nuevo reabre la herida");
});

test("aplicarGolpe: fractura no se aplica si la zona ya está amputada (no hay hueso)", () => {
  const z = zonaInicial();
  z.amputado = true;
  aplicarGolpe(z, { zona: "brazoIzq", sangrado: false, fractura: true, amputacion: false });
  assert.strictEqual(z.fractura, false);
});

test("aplicarGolpe: amputar limpia la fractura y su curación en curso", () => {
  const z = zonaInicial();
  z.fractura = true;
  z.entablilladoDesde = null;
  aplicarGolpe(z, { zona: "piernaDer", sangrado: false, fractura: false, amputacion: true });
  assert.strictEqual(z.amputado, true);
  assert.strictEqual(z.fractura, false);
});

test("aplicarDrenajeAnatomico: sin zonas sangrando/infectadas, no drena nada", () => {
  const a = anatomiaInicial();
  const estado = { vida: 100 };
  aplicarDrenajeAnatomico(a, estado, 5);
  assert.strictEqual(estado.vida, 100);
});

test("aplicarDrenajeAnatomico: dos zonas sangrando drenan el doble que una", () => {
  const unaZona = anatomiaInicial();
  unaZona.torso.sangrado = true;
  const dosZonas = anatomiaInicial();
  dosZonas.torso.sangrado = true;
  dosZonas.brazoIzq.sangrado = true;
  const e1 = { vida: 100 };
  const e2 = { vida: 100 };
  aplicarDrenajeAnatomico(unaZona, e1, 1);
  aplicarDrenajeAnatomico(dosZonas, e2, 1);
  assert.strictEqual(100 - e2.vida, (100 - e1.vida) * 2);
});

test("aplicarDrenajeAnatomico: infección drena también, nunca baja de 0", () => {
  const a = anatomiaInicial();
  a.torso.infectado = true;
  const estado = { vida: 1 };
  aplicarDrenajeAnatomico(a, estado, 10);
  assert.strictEqual(estado.vida, 0);
});

test("aplicarDrenajeAnatomico: horasTranscurridas<=0 no hace nada", () => {
  const a = anatomiaInicial();
  a.torso.sangrado = true;
  const estado = { vida: 100 };
  aplicarDrenajeAnatomico(a, estado, 0);
  assert.strictEqual(estado.vida, 100);
});

test("resolverCuracionesEnCurso: cierra la venda justo al cumplirse HORAS_CURAR_VENDA, no antes", () => {
  const a = anatomiaInicial();
  a.brazoDer.vendadoDesde = 1000;
  resolverCuracionesEnCurso(a, 1000 + HORAS_CURAR_VENDA * 3_600_000 - 1);
  assert.strictEqual(a.brazoDer.vendadoDesde, 1000);
  resolverCuracionesEnCurso(a, 1000 + HORAS_CURAR_VENDA * 3_600_000);
  assert.strictEqual(a.brazoDer.vendadoDesde, null);
});

test("resolverCuracionesEnCurso: la tablilla tarda más que la venda", () => {
  const a = anatomiaInicial();
  a.piernaIzq.entablilladoDesde = 0;
  resolverCuracionesEnCurso(a, HORAS_CURAR_VENDA * 3_600_000); // ya pasó el tiempo de venda, no el de tablilla
  assert.strictEqual(a.piernaIzq.entablilladoDesde, 0, "sigue entablillada, la tablilla tarda más");
  resolverCuracionesEnCurso(a, HORAS_CURAR_TABLILLA * 3_600_000);
  assert.strictEqual(a.piernaIzq.entablilladoDesde, null);
});

test("estaCritico: por debajo de UMBRAL_CRITICO de vidaMax", () => {
  assert.strictEqual(estaCritico(9, 100), true);
  assert.strictEqual(estaCritico(10, 100), false, "el 10% exacto ya no es crítico");
  assert.strictEqual(estaCritico(50, 100), false);
  assert.strictEqual(UMBRAL_CRITICO, 0.1);
});

test("multiplicadorVelocidadPorFractura: pierna fracturada -75%, sin piernas comprometidas sin penalización", () => {
  const sana = anatomiaInicial();
  assert.strictEqual(multiplicadorVelocidadPorFractura(sana), 1);
  const rota = anatomiaInicial();
  rota.piernaIzq.fractura = true;
  assert.strictEqual(multiplicadorVelocidadPorFractura(rota), 0.25);
});

test("multiplicadorVelocidadPorFractura: pierna amputada SIN prótesis penaliza igual que fracturada", () => {
  const a = anatomiaInicial();
  a.piernaDer.amputado = true;
  assert.strictEqual(multiplicadorVelocidadPorFractura(a), 0.25);
  a.piernaDer.protesis = true;
  assert.strictEqual(multiplicadorVelocidadPorFractura(a), 1, "con prótesis, sin penalización");
});

test("multiplicadorVelocidadPorFractura: dos piernas comprometidas no penalizan doble", () => {
  const a = anatomiaInicial();
  a.piernaIzq.fractura = true;
  a.piernaDer.fractura = true;
  assert.strictEqual(multiplicadorVelocidadPorFractura(a), 0.25);
});

test("multiplicadorVelocidadPorCuracion: malus leve mientras cicatriza, ninguno si no hay curación en curso", () => {
  const a = anatomiaInicial();
  assert.strictEqual(multiplicadorVelocidadPorCuracion(a), 1);
  a.torso.vendadoDesde = Date.now();
  assert.ok(multiplicadorVelocidadPorCuracion(a) < 1);
});

test("brazoInutilizado: brazo fracturado bloquea, brazo sano no", () => {
  const sano = anatomiaInicial();
  assert.strictEqual(brazoInutilizado(sano), false);
  const roto = anatomiaInicial();
  roto.brazoDer.fractura = true;
  assert.strictEqual(brazoInutilizado(roto), true);
});

test("brazoInutilizado: brazo amputado sin prótesis bloquea, con prótesis no", () => {
  const a = anatomiaInicial();
  a.brazoIzq.amputado = true;
  assert.strictEqual(brazoInutilizado(a), true);
  a.brazoIzq.protesis = true;
  assert.strictEqual(brazoInutilizado(a), false);
});

test("usarVenda: detiene el sangrado al instante y empieza a cicatrizar", () => {
  const z = zonaInicial();
  z.sangrado = true;
  const ok = usarVenda(z, true, 5000, rndSiempreNo);
  assert.strictEqual(ok, true);
  assert.strictEqual(z.sangrado, false);
  assert.strictEqual(z.vendadoDesde, 5000);
});

test("usarVenda: sin nada que vendar, no hace nada y devuelve false", () => {
  const z = zonaInicial();
  assert.strictEqual(usarVenda(z, true, 5000), false);
  assert.strictEqual(z.vendadoDesde, null);
});

test("usarVenda: sin ungüento arriesga infección, con ungüento nunca", () => {
  const conRiesgo = zonaInicial();
  conRiesgo.sangrado = true;
  usarVenda(conRiesgo, false, 0, rndSiempreSi);
  assert.strictEqual(conRiesgo.infectado, true);

  const sinRiesgo = zonaInicial();
  sinRiesgo.sangrado = true;
  usarVenda(sinRiesgo, true, 0, rndSiempreSi); // aunque la tirada "acertaría", con ungüento ni se tira
  assert.strictEqual(sinRiesgo.infectado, false);
  assert.strictEqual(PROB_INFECCION_SIN_UNGUENTO, 0.25);
});

test("usarTablilla: detiene la fractura al instante y empieza a soldar", () => {
  const z = zonaInicial();
  z.fractura = true;
  assert.strictEqual(usarTablilla(z, 7000), true);
  assert.strictEqual(z.fractura, false);
  assert.strictEqual(z.entablilladoDesde, 7000);
});

test("usarTablilla: sin fractura, no hace nada", () => {
  const z = zonaInicial();
  assert.strictEqual(usarTablilla(z, 7000), false);
});

test("operarCirugia: cura todo al instante en las 6 zonas, sin tocar amputado/protesis", () => {
  const a = anatomiaInicial();
  a.torso.sangrado = true;
  a.brazoIzq.fractura = true;
  a.piernaDer.infectado = true;
  a.piernaIzq.vendadoDesde = 100;
  a.brazoDer.amputado = true;
  operarCirugia(a);
  for (const z of ZONAS) {
    assert.strictEqual(a[z].sangrado, false);
    assert.strictEqual(a[z].fractura, false);
    assert.strictEqual(a[z].infectado, false);
    assert.strictEqual(a[z].vendadoDesde, null);
  }
  assert.strictEqual(a.brazoDer.amputado, true, "la cirugía no revierte una amputación");
});

test("instalarProtesis: solo sobre zona amputada sin prótesis previa", () => {
  const z = zonaInicial();
  assert.strictEqual(instalarProtesis(z), false, "no está amputada");
  z.amputado = true;
  assert.strictEqual(instalarProtesis(z), true);
  assert.strictEqual(z.protesis, true);
  assert.strictEqual(instalarProtesis(z), false, "ya tenía prótesis");
});
