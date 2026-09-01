// Tests de la preparación de pociones (docs/GDD_Pociones.md, pedido
// 2026-09-01) — el motor puro de alquimia.ts. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  prepararPocion,
  crearBuffsPocion,
  aplicarBuffsPocion,
  CONFIG_ALQUIMIA_DEFECTO,
  POOL_STATS_ALQUIMIA,
  IngredienteAlquimia,
  iniciarSesionAlquimia,
  avivarAlquimia,
  enfriarAlquimia,
  colarPocion,
  CONFIG_ESTACION_ALQUIMIA,
  FACTOR_PUREZA_MINIMO,
  REFERENCIA_STAT_ALQUIMIA,
} from "../src/construccion/alquimia";

const rndSecuencia = (valores: number[]) => {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)];
};
const rndFijo = (v: number) => () => v;

const neutro = (itemId: string): IngredienteAlquimia => ({ itemId });
const corruptivo = (itemId: string): IngredienteAlquimia => ({ itemId, corruptivo: true });
const catalizador = (itemId: string): IngredienteAlquimia => ({ itemId, catalizador: true });

test("prepararPocion: solo ingredientes neutros — sin catalizadores nunca hay positivo, riesgo = base (10%)", () => {
  const ingredientes = [neutro("hierba_aromatica"), neutro("hongo_medicinal")];
  const r1 = prepararPocion(ingredientes, rndFijo(0.05)); // < 0.10 -> negativo dispara
  assert.strictEqual(r1.efectos.filter((e) => e.magnitudPct < 0).length, 1);
  assert.strictEqual(r1.efectos.filter((e) => e.magnitudPct > 0).length, 0, "sin catalizador nunca hay bono positivo");

  const r2 = prepararPocion(ingredientes, rndFijo(0.5)); // > 0.10 -> sin negativo
  assert.strictEqual(r2.efectos.length, 0);
  assert.strictEqual(r2.corruptivosUnicos, 0);
  assert.strictEqual(r2.catalizadoresUnicos, 0);
});

test("prepararPocion: probabilidad de negativo sube +25% acumulativo por cada corruptivo ÚNICO distinto", () => {
  const r0 = prepararPocion([neutro("a")], rndFijo(0));
  assert.strictEqual(r0.corruptivosUnicos, 0);

  const r1 = prepararPocion([corruptivo("hierba_venenosa")], rndFijo(0));
  assert.strictEqual(r1.corruptivosUnicos, 1); // prob = 0.10 + 0.25 = 0.35

  const r2 = prepararPocion([corruptivo("hierba_venenosa"), corruptivo("seta_toxica")], rndFijo(0));
  assert.strictEqual(r2.corruptivosUnicos, 2); // prob = 0.60

  // rnd()=0.5 dispara "rnd() < probNegativo" solo si la prob supera 0.5:
  // con 1 corruptivo (prob=0.35) NO dispara, con 2 (prob=0.60) SÍ dispara.
  const conUno = prepararPocion([corruptivo("hierba_venenosa")], rndFijo(0.5));
  assert.strictEqual(conUno.efectos.filter((e) => e.magnitudPct < 0).length, 0, "prob 0.35 < 0.5, no dispara");
  const conDos = prepararPocion([corruptivo("hierba_venenosa"), corruptivo("seta_toxica")], rndFijo(0.5));
  assert.strictEqual(conDos.efectos.filter((e) => e.magnitudPct < 0).length, 1, "prob 0.60 > 0.5, sí dispara");
});

test("prepararPocion: el MISMO itemId corruptivo repetido no cuenta dos veces (únicos, no copias)", () => {
  const r = prepararPocion([corruptivo("hierba_venenosa"), corruptivo("hierba_venenosa"), corruptivo("hierba_venenosa")], rndFijo(0));
  assert.strictEqual(r.corruptivosUnicos, 1);
});

test("prepararPocion: magnitud del efecto negativo cae en [1,5)% (con signo negativo)", () => {
  // secuencia: [disparo negativo, elección de stat, magnitud] — el resto de
  // llamadas (barajar de positivos) reutilizan el último valor, sin efecto
  // en este assert porque catalizadoresUnicos=0 -> nunca hay positivos.
  for (const azarMagnitud of [0, 0.25, 0.5, 0.75, 0.999]) {
    const r = prepararPocion([corruptivo("hierba_venenosa")], rndSecuencia([0, 0, azarMagnitud]));
    const negativo = r.efectos.find((e) => e.magnitudPct < 0);
    assert.ok(negativo, "debería haber disparado con rnd()=0 en la tirada de probabilidad");
    assert.ok(negativo!.magnitudPct <= -1 && negativo!.magnitudPct > -5, `magnitud fuera de rango: ${negativo!.magnitudPct}`);
  }
});

test("prepararPocion: sin catalizador forzado, el nº de intentos = catalizadores únicos, cada intento más difícil (armónico)", () => {
  // 1 catalizador: prob de forzado = 0.25. rnd de la tirada "forzado" > 0.25 -> cae al camino de intentos.
  // intento 1: probExito = 0.7/1 = 0.7 -> rnd < 0.7 cuenta como éxito.
  const rEspera = prepararPocion(
    [neutro("relleno"), catalizador("hierba_curativa")],
    rndSecuencia([0.9 /* sin negativo */, 0.9 /* no forzado (0.9>0.25) */, 0.1 /* intento 1: 0.1<0.7 éxito */]),
  );
  assert.strictEqual(rEspera.efectos.filter((e) => e.magnitudPct > 0).length, 1);
  assert.ok(rEspera.efectos[0].magnitudPct >= 1 && rEspera.efectos[0].magnitudPct < 3, "magnitud estándar 1-3%");

  const rFalla = prepararPocion(
    [neutro("relleno"), catalizador("hierba_curativa")],
    rndSecuencia([0.9, 0.9, 0.9 /* 0.9 > 0.7: intento falla */]),
  );
  assert.strictEqual(rFalla.efectos.filter((e) => e.magnitudPct > 0).length, 0);
});

test("prepararPocion: catalizador fuerza 2 o 3 bonos de golpe (25% acumulativo por catalizador único)", () => {
  const rDos = prepararPocion(
    [catalizador("hierba_curativa")],
    rndSecuencia([0.9 /* sin negativo */, 0.1 /* 0.1 < 0.25: forzado dispara */, 0.1 /* <0.5 -> 2 bonos */]),
  );
  assert.strictEqual(rDos.efectos.filter((e) => e.magnitudPct > 0).length, 2);

  const rTres = prepararPocion(
    [catalizador("hierba_curativa")],
    rndSecuencia([0.9, 0.1, 0.9 /* >=0.5 -> 3 bonos */]),
  );
  assert.strictEqual(rTres.efectos.filter((e) => e.magnitudPct > 0).length, 3);
});

test("prepararPocion: 3+ catalizadores únicos desbloquean la mezcla avanzada — SIEMPRE 4 bonos, magnitud 5-15%", () => {
  const r = prepararPocion(
    [catalizador("hierba_curativa"), catalizador("flor_medicinal"), catalizador("hongo_medicinal")],
    rndFijo(0.99), // ni siquiera con rnd alto se libra: mezcla avanzada es incondicional una vez desbloqueada
  );
  assert.strictEqual(r.mezclaAvanzada, true);
  const positivos = r.efectos.filter((e) => e.magnitudPct > 0);
  assert.strictEqual(positivos.length, 4);
  const statsUsados = new Set(positivos.map((e) => e.stat));
  assert.strictEqual(statsUsados.size, 4, "los 4 bonos deben caer en los 4 stats distintos, sin repetir");
  for (const e of positivos) assert.ok(e.magnitudPct >= 5 && e.magnitudPct < 15, `magnitud fuera del rango avanzado: ${e.magnitudPct}`);
});

test("prepararPocion: nunca repite el mismo stat entre los bonos positivos de una misma tirada", () => {
  const r = prepararPocion(
    [catalizador("a"), catalizador("b"), catalizador("c")],
    rndFijo(0.01),
  );
  const stats = r.efectos.filter((e) => e.magnitudPct > 0).map((e) => e.stat);
  assert.strictEqual(new Set(stats).size, stats.length);
});

test("prepararPocion: todos los efectos usan un stat del pool de 4", () => {
  const r = prepararPocion([corruptivo("x"), catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.01));
  for (const e of r.efectos) assert.ok((POOL_STATS_ALQUIMIA as readonly string[]).includes(e.stat));
});

test("crearBuffsPocion: cada efecto se convierte en un buff con expiraEn = ahora + duración por defecto", () => {
  const efectos = [{ stat: "ataqueFisico" as const, magnitudPct: 5 }, { stat: "defensaFisica" as const, magnitudPct: -2 }];
  const buffs = crearBuffsPocion(efectos, 1_000_000);
  assert.strictEqual(buffs.length, 2);
  for (const b of buffs) assert.strictEqual(b.expiraEn, 1_000_000 + CONFIG_ALQUIMIA_DEFECTO.duracionBuffMs);
  assert.strictEqual(buffs[0].stat, "ataqueFisico");
  assert.strictEqual(buffs[0].magnitudPct, 5);
});

test("aplicarBuffsPocion: aplica el % como bonus plano sobre una referencia fija, SUMADO a la base", () => {
  const base = { ataqueFisico: 10, defensaFisica: 10, ataqueMagico: 0, defensaMagica: 0 };
  const buffs = [{ stat: "ataqueFisico" as const, magnitudPct: 10, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 12); // 10 + (20*10/100)=10+2
  assert.strictEqual(resultado.defensaFisica, 10); // sin buff, intacto
});

test("aplicarBuffsPocion: el bonus se calcula sobre una REFERENCIA fija, no multiplicando el stat propio — nunca inerte con base 0 (sin armadura/sin magia, el caso común)", () => {
  const base = { ataqueFisico: 0, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs = [{ stat: "defensaFisica" as const, magnitudPct: 15, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.ok(resultado.defensaFisica > 0, "con base 0, un multiplicador clásico (base*(1+pct)) daría siempre 0 — este NO debe hacerlo");
  assert.strictEqual(resultado.defensaFisica, (REFERENCIA_STAT_ALQUIMIA * 15) / 100);
});

test("aplicarBuffsPocion: un buff CADUCADO (expiraEn <= ahora) se ignora, sin necesidad de purgar la lista", () => {
  const base = { ataqueFisico: 10, defensaFisica: 10, ataqueMagico: 0, defensaMagica: 0 };
  const buffs = [{ stat: "ataqueFisico" as const, magnitudPct: 50, expiraEn: 1000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000); // expiraEn <= ahoraMs -> ya caducado
  assert.strictEqual(resultado.ataqueFisico, 10);
});

test("aplicarBuffsPocion: varios buffs sobre el MISMO stat se SUMAN antes de convertir a bonus plano, nunca en cascada", () => {
  const base = { ataqueFisico: 100, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs = [
    { stat: "ataqueFisico" as const, magnitudPct: 10, expiraEn: 2000 },
    { stat: "ataqueFisico" as const, magnitudPct: -3, expiraEn: 2000 },
  ];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  // suma neta = +7% de la referencia (20) -> +1.4, sobre base 100 = 101.4
  assert.ok(Math.abs(resultado.ataqueFisico - 101.4) < 1e-9);
});

test("aplicarBuffsPocion: nunca deja un stat negativo aunque el neto sea muy penalizador", () => {
  const base = { ataqueFisico: 1, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs = [{ stat: "ataqueFisico" as const, magnitudPct: -500, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 0);
});

// --- sesión interactiva (estacionFuego + resultado de ingredientes) ---

test("iniciarSesionAlquimia: congela el resultado de ingredientes al arrancar (independiente de la gestión del fuego)", () => {
  const s = iniciarSesionAlquimia([catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.99), 0);
  assert.strictEqual(s.estacion.fase, "TRABAJANDO");
  assert.strictEqual(s.estacion.temperatura, CONFIG_ESTACION_ALQUIMIA.temperaturaInicial);
  assert.strictEqual(s.resultadoBase.mezclaAvanzada, true);
  assert.strictEqual(s.resultadoBase.efectos.length, 4);
});

test("colarPocion: 'demasiado_pronto' antes de duracionMinimaSeg, no cambia la fase", () => {
  const s = iniciarSesionAlquimia([neutro("relleno")], rndFijo(0.99), 0);
  const r = colarPocion(s, 1000); // 1s, muy por debajo de duracionMinimaSeg
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "demasiado_pronto");
  assert.strictEqual(s.estacion.fase, "TRABAJANDO");
});

test("colarPocion: pureza casi perfecta escala la magnitud final muy cerca de la tirada base (la mecánica exacta de pureza->tiempo ya se prueba en estacionFuego.test.ts)", () => {
  const s = iniciarSesionAlquimia([catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.5), 0);
  // fija el resultado de la gestión del fuego a mano (blackbox de estacionFuego
  // ya cubierto aparte) para aislar SOLO el escalado de colarPocion — mismo
  // instante en ultimaAccionEn que el ahoraMs de colarPocion, para que
  // finalizarEstacion no sume dt real encima de estos valores fijados.
  const ahoraMs = CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100;
  s.estacion.segundosTotales = 10;
  s.estacion.segundosEnVentana = 9.9; // pureza = 0.99
  s.estacion.ultimaAccionEn = ahoraMs;
  const r = colarPocion(s, ahoraMs);
  assert.strictEqual(r.ok, true);
  assert.ok(r.pureza! > 0.95, `pureza esperada casi perfecta, salió ${r.pureza}`);
  for (let i = 0; i < r.efectos!.length; i++) {
    assert.ok(Math.abs(r.efectos![i].magnitudPct - s.resultadoBase.efectos[i].magnitudPct) < 0.5, "con pureza casi perfecta, la magnitud final debe quedar muy cerca de la tirada base");
  }
});

test("colarPocion: pureza pésima escala al suelo FACTOR_PUREZA_MINIMO (nunca 0)", () => {
  const s = iniciarSesionAlquimia([catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.5), 0);
  // arranca frío y nunca se aviva -> nunca entra en la ventana objetivo
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pureza, 0);
  for (let i = 0; i < r.efectos!.length; i++) {
    const esperado = s.resultadoBase.efectos[i].magnitudPct * FACTOR_PUREZA_MINIMO;
    assert.ok(Math.abs(r.efectos![i].magnitudPct - esperado) < 1e-9);
  }
});

test("colarPocion: nunca cambia QUÉ stats salieron ni el signo del efecto, solo su magnitud", () => {
  const s = iniciarSesionAlquimia([corruptivo("veneno")], rndFijo(0), 0); // negativo garantizado
  const statsBase = s.resultadoBase.efectos.map((e) => e.stat);
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.efectos!.map((e) => e.stat), statsBase);
  assert.ok(r.efectos!.every((e) => e.magnitudPct <= 0), "un efecto negativo escalado sigue siendo negativo (o 0), nunca cambia de signo");
});

test("avivarAlquimia/enfriarAlquimia: delegan en la temperatura de la sesión", () => {
  const s = iniciarSesionAlquimia([neutro("x")], rndFijo(0.99), 0);
  const antes = s.estacion.temperatura;
  avivarAlquimia(s, 0);
  assert.ok(s.estacion.temperatura > antes);
  const trasAvivar = s.estacion.temperatura;
  enfriarAlquimia(s, 0);
  assert.ok(s.estacion.temperatura < trasAvivar);
});
