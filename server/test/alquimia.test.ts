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
  POOL_STATS_NEGATIVOS,
  POOL_ESPECIALES_ALQUIMIA,
  IngredienteAlquimia,
  EfectoPocion,
  BuffPocion,
  iniciarSesionAlquimia,
  avivarAlquimia,
  enfriarAlquimia,
  colarPocion,
  CONFIG_ESTACION_ALQUIMIA,
  FACTOR_PUREZA_MINIMO,
  REFERENCIA_STAT_ALQUIMIA,
  factorBuffPocion,
  factorGastoEstaminaPocion,
  tieneEspecialActivo,
  colorPocion,
  itemIdPocion,
} from "../src/construccion/alquimia";

const rndSecuencia = (valores: number[]) => {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)];
};
const rndFijo = (v: number) => () => v;

/** LCG determinista (Turbo Pascal) — mismo criterio de testabilidad que rndFijo/rndSecuencia, pero para barrer muchas semillas distintas sin depender de Math.random (no-flaky, reproducible). */
const rndSemilla = (semilla: number) => {
  let i = semilla;
  return () => {
    i = (i * 9301 + 49297) % 233280;
    return i / 233280;
  };
};

const neutro = (itemId: string): IngredienteAlquimia => ({ itemId });
const corruptivo = (itemId: string): IngredienteAlquimia => ({ itemId, corruptivo: true });
const catalizador = (itemId: string): IngredienteAlquimia => ({ itemId, catalizador: true });

/** Type guard reutilizable para EfectoPocion/BuffPocion — `.filter`/`.find` con un arrow normal NO propaga el narrowing de `categoria` al elemento devuelto, esta función sí. */
function esStat<T extends { categoria: "stat" | "especial" }>(e: T): e is Extract<T, { categoria: "stat" }> {
  return e.categoria === "stat";
}

test("prepararPocion: solo ingredientes neutros — sin catalizadores nunca hay positivo, riesgo = base (10%)", () => {
  const ingredientes = [neutro("hierba_aromatica"), neutro("hongo_medicinal")];
  const r1 = prepararPocion(ingredientes, rndFijo(0.05)); // < 0.10 -> negativo dispara
  assert.strictEqual(r1.efectos.filter((e) => e.categoria === "stat" && e.magnitudPct < 0).length, 1);
  assert.strictEqual(r1.efectos.filter((e) => e.categoria === "stat" && e.magnitudPct > 0).length, 0, "sin catalizador nunca hay bono positivo");

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
  assert.strictEqual(conUno.efectos.filter((e) => e.categoria === "stat" && e.magnitudPct < 0).length, 0, "prob 0.35 < 0.5, no dispara");
  const conDos = prepararPocion([corruptivo("hierba_venenosa"), corruptivo("seta_toxica")], rndFijo(0.5));
  assert.strictEqual(conDos.efectos.filter((e) => e.categoria === "stat" && e.magnitudPct < 0).length, 1, "prob 0.60 > 0.5, sí dispara");
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
    const negativo = r.efectos.find(esStat);
    assert.ok(negativo, "debería haber disparado con rnd()=0 en la tirada de probabilidad");
    assert.ok(negativo!.magnitudPct <= -1 && negativo!.magnitudPct > -5, `magnitud fuera de rango: ${negativo!.magnitudPct}`);
  }
});

test("prepararPocion: el efecto negativo nunca usa 'carga' (excluida de POOL_STATS_NEGATIVOS — el streamer no pidió 'carga reducida')", () => {
  // 2 corruptivos -> probNegativo=0.60, barrido de semillas para cubrir muchas tiradas de stat distintas.
  for (let semilla = 0; semilla < 100; semilla++) {
    const r = prepararPocion([corruptivo("hierba_venenosa"), corruptivo("azufre")], rndSemilla(semilla));
    const negativo = r.efectos.find(esStat);
    if (negativo && negativo.magnitudPct < 0) assert.notStrictEqual(negativo.stat, "carga");
  }
});

test("prepararPocion: sin catalizador forzado, el nº de intentos = catalizadores únicos, cada intento más difícil (armónico)", () => {
  // 1 catalizador: prob de forzado = 0.25. rnd de la tirada "forzado" > 0.25 -> cae al camino de intentos.
  // intento 1: probExito = 0.7/1 = 0.7 -> rnd < 0.7 cuenta como éxito.
  const rEspera = prepararPocion(
    [neutro("relleno"), catalizador("hierba_curativa")],
    rndSecuencia([0.9 /* sin negativo */, 0.9 /* no forzado (0.9>0.25) */, 0.1 /* intento 1: 0.1<0.7 éxito */]),
  );
  assert.strictEqual(rEspera.efectos.length, 1, "1 intento con éxito debe dar exactamente 1 efecto positivo (stat o especial)");
  const e = rEspera.efectos[0];
  if (e.categoria === "stat") assert.ok(e.magnitudPct >= 1 && e.magnitudPct < 3, "magnitud estándar 1-3%");

  const rFalla = prepararPocion(
    [neutro("relleno"), catalizador("hierba_curativa")],
    rndSecuencia([0.9, 0.9, 0.9 /* 0.9 > 0.7: intento falla */]),
  );
  assert.strictEqual(rFalla.efectos.length, 0);
});

test("prepararPocion: catalizador fuerza 2 o 3 bonos de golpe (25% acumulativo por catalizador único)", () => {
  const rDos = prepararPocion(
    [catalizador("hierba_curativa")],
    rndSecuencia([0.9 /* sin negativo */, 0.1 /* 0.1 < 0.25: forzado dispara */, 0.1 /* <0.5 -> 2 bonos */]),
  );
  assert.strictEqual(rDos.efectos.length, 2);

  const rTres = prepararPocion(
    [catalizador("hierba_curativa")],
    rndSecuencia([0.9, 0.1, 0.9 /* >=0.5 -> 3 bonos */]),
  );
  assert.strictEqual(rTres.efectos.length, 3);
});

test("prepararPocion: 3+ catalizadores únicos desbloquean la mezcla avanzada — SIEMPRE 4 bonos simultáneos (stat o especial), sin repetir", () => {
  const r = prepararPocion(
    [catalizador("hierba_curativa"), catalizador("flor_medicinal"), catalizador("hongo_medicinal")],
    rndFijo(0.99), // ni siquiera con rnd alto se libra: mezcla avanzada es incondicional una vez desbloqueada (y con 0 corruptivos, 0.99 tampoco dispara el negativo)
  );
  assert.strictEqual(r.mezclaAvanzada, true);
  assert.strictEqual(r.efectos.length, 4);
  const claves = r.efectos.map((e) => (e.categoria === "stat" ? e.stat : e.especial));
  assert.strictEqual(new Set(claves).size, 4, "los 4 bonos deben ser distintos entre sí (stat o especial), sin repetir");
  for (const e of r.efectos) {
    if (e.categoria === "stat") assert.ok(e.magnitudPct >= 5 && e.magnitudPct < 15, `magnitud fuera del rango avanzado: ${e.magnitudPct}`);
  }
});

test("prepararPocion: el pool positivo incluye los 3 especiales (xpOficioX2/produccionCrafteoX2/sigilo) — aparecen de verdad en mezcla avanzada", () => {
  const ingredientes = [catalizador("hierba_curativa"), catalizador("flor_medicinal"), catalizador("hongo_medicinal")];
  let vistoEspecial = false;
  for (let semilla = 0; semilla < 50 && !vistoEspecial; semilla++) {
    const r = prepararPocion(ingredientes, rndSemilla(semilla));
    if (r.efectos.some((e) => e.categoria === "especial")) vistoEspecial = true;
  }
  assert.ok(vistoEspecial, "con 50 semillas distintas, algún especial debería colar en la mezcla avanzada (pool de 11, siempre 4 elegidos)");
});

test("prepararPocion: nunca repite la misma clave (stat o especial) entre los bonos positivos de una misma tirada", () => {
  const r = prepararPocion(
    [catalizador("a"), catalizador("b"), catalizador("c")],
    rndFijo(0.01),
  );
  const claves = r.efectos.map((e) => (e.categoria === "stat" ? e.stat : e.especial));
  assert.strictEqual(new Set(claves).size, claves.length);
});

test("prepararPocion: todo efecto 'stat' usa un stat de POOL_STATS_ALQUIMIA y todo 'especial' usa uno de POOL_ESPECIALES_ALQUIMIA", () => {
  const r = prepararPocion([corruptivo("x"), catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.01));
  for (const e of r.efectos) {
    if (e.categoria === "stat") assert.ok((POOL_STATS_ALQUIMIA as readonly string[]).includes(e.stat));
    else assert.ok((POOL_ESPECIALES_ALQUIMIA as readonly string[]).includes(e.especial));
  }
});

test("POOL_STATS_NEGATIVOS excluye 'carga' (positiva únicamente); POOL_STATS_ALQUIMIA (positivo) sí la incluye", () => {
  assert.ok(!(POOL_STATS_NEGATIVOS as readonly string[]).includes("carga"));
  assert.ok((POOL_STATS_ALQUIMIA as readonly string[]).includes("carga"));
  assert.strictEqual(POOL_STATS_ALQUIMIA.length, POOL_STATS_NEGATIVOS.length + 1);
});

test("crearBuffsPocion: cada efecto 'stat' se convierte en un buff con expiraEn = ahora + duración por defecto", () => {
  const efectos: EfectoPocion[] = [
    { categoria: "stat", stat: "ataqueFisico", magnitudPct: 5 },
    { categoria: "stat", stat: "defensaFisica", magnitudPct: -2 },
  ];
  const buffs = crearBuffsPocion(efectos, 1_000_000);
  assert.strictEqual(buffs.length, 2);
  for (const b of buffs) assert.strictEqual(b.expiraEn, 1_000_000 + CONFIG_ALQUIMIA_DEFECTO.duracionBuffMs);
  assert.ok(buffs[0].categoria === "stat" && buffs[0].stat === "ataqueFisico" && buffs[0].magnitudPct === 5);
});

test("crearBuffsPocion: un efecto 'especial' se convierte en buff especial, sin magnitud", () => {
  const efectos: EfectoPocion[] = [{ categoria: "especial", especial: "sigilo" }];
  const buffs = crearBuffsPocion(efectos, 1_000_000);
  assert.strictEqual(buffs.length, 1);
  assert.ok(buffs[0].categoria === "especial" && buffs[0].especial === "sigilo");
  assert.strictEqual(buffs[0].expiraEn, 1_000_000 + CONFIG_ALQUIMIA_DEFECTO.duracionBuffMs);
});

test("aplicarBuffsPocion: aplica el % como bonus plano sobre una referencia fija, SUMADO a la base", () => {
  const base = { ataqueFisico: 10, defensaFisica: 10, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "ataqueFisico", magnitudPct: 10, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 12); // 10 + (20*10/100)=10+2
  assert.strictEqual(resultado.defensaFisica, 10); // sin buff, intacto
});

test("aplicarBuffsPocion: el bonus se calcula sobre una REFERENCIA fija, no multiplicando el stat propio — nunca inerte con base 0 (sin armadura/sin magia, el caso común)", () => {
  const base = { ataqueFisico: 0, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "defensaFisica", magnitudPct: 15, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.ok(resultado.defensaFisica > 0, "con base 0, un multiplicador clásico (base*(1+pct)) daría siempre 0 — este NO debe hacerlo");
  assert.strictEqual(resultado.defensaFisica, (REFERENCIA_STAT_ALQUIMIA * 15) / 100);
});

test("aplicarBuffsPocion: un buff CADUCADO (expiraEn <= ahora) se ignora, sin necesidad de purgar la lista", () => {
  const base = { ataqueFisico: 10, defensaFisica: 10, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "ataqueFisico", magnitudPct: 50, expiraEn: 1000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000); // expiraEn <= ahoraMs -> ya caducado
  assert.strictEqual(resultado.ataqueFisico, 10);
});

test("aplicarBuffsPocion: varios buffs sobre el MISMO stat se SUMAN antes de convertir a bonus plano, nunca en cascada", () => {
  const base = { ataqueFisico: 100, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [
    { categoria: "stat", stat: "ataqueFisico", magnitudPct: 10, expiraEn: 2000 },
    { categoria: "stat", stat: "ataqueFisico", magnitudPct: -3, expiraEn: 2000 },
  ];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  // suma neta = +7% de la referencia (20) -> +1.4, sobre base 100 = 101.4
  assert.ok(Math.abs(resultado.ataqueFisico - 101.4) < 1e-9);
});

test("aplicarBuffsPocion: nunca deja un stat negativo aunque el neto sea muy penalizador", () => {
  const base = { ataqueFisico: 1, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "ataqueFisico", magnitudPct: -500, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 0);
});

test("aplicarBuffsPocion: ignora buffs 'especial' (no son stats de combate) sin romper", () => {
  const base = { ataqueFisico: 10, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "especial", especial: "sigilo", expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 10);
});

test("aplicarBuffsPocion: ignora buffs de los stats NUEVOS (vida/velocidad/estamina/carga) — esos no viven en StatsConBuffs, tienen su propio factorBuffPocion", () => {
  const base = { ataqueFisico: 10, defensaFisica: 0, ataqueMagico: 0, defensaMagica: 0 };
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "vida", magnitudPct: 50, expiraEn: 2000 }];
  const resultado = aplicarBuffsPocion(base, buffs, 1000);
  assert.strictEqual(resultado.ataqueFisico, 10, "un buff de 'vida' no debe filtrarse a ningún stat de combate");
});

// --- factorBuffPocion / factorGastoEstaminaPocion / tieneEspecialActivo (docs/GDD_Pociones.md, ampliación 2026-09-01) ---

test("factorBuffPocion: multiplicador directo sobre la base real, +15% -> factor 1.15", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "vida", magnitudPct: 15, expiraEn: 2000 }];
  assert.ok(Math.abs(factorBuffPocion(buffs, "vida", 1000) - 1.15) < 1e-9);
});

test("factorBuffPocion: sin buffs de ese stat -> factor 1 (neutro)", () => {
  assert.strictEqual(factorBuffPocion([], "velocidad", 1000), 1);
});

test("factorBuffPocion: un buff CADUCADO se ignora -> factor 1", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "vida", magnitudPct: 15, expiraEn: 1000 }];
  assert.strictEqual(factorBuffPocion(buffs, "vida", 1000), 1);
});

test("factorBuffPocion: nunca baja del suelo (0.2) aunque el neto sea muy negativo", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "velocidad", magnitudPct: -500, expiraEn: 2000 }];
  assert.strictEqual(factorBuffPocion(buffs, "velocidad", 1000), 0.2);
});

test("factorBuffPocion: solo lee buffs del stat pedido, ignora los demás", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "carga", magnitudPct: 50, expiraEn: 2000 }];
  assert.strictEqual(factorBuffPocion(buffs, "vida", 1000), 1);
});

test("factorGastoEstaminaPocion: signo invertido — 'más estamina' (pct>0) BAJA el gasto", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "estamina", magnitudPct: 20, expiraEn: 2000 }];
  assert.ok(Math.abs(factorGastoEstaminaPocion(buffs, 1000) - 0.8) < 1e-9);
});

test("factorGastoEstaminaPocion: 'estamina reducida' (pct<0) SUBE el gasto", () => {
  const buffs: BuffPocion[] = [{ categoria: "stat", stat: "estamina", magnitudPct: -20, expiraEn: 2000 }];
  assert.ok(Math.abs(factorGastoEstaminaPocion(buffs, 1000) - 1.2) < 1e-9);
});

test("tieneEspecialActivo: true solo si hay un buff especial de ese tipo sin caducar", () => {
  const buffs: BuffPocion[] = [
    { categoria: "especial", especial: "sigilo", expiraEn: 2000 },
    { categoria: "especial", especial: "xpOficioX2", expiraEn: 500 }, // ya caducado a t=1000
  ];
  assert.strictEqual(tieneEspecialActivo(buffs, "sigilo", 1000), true);
  assert.strictEqual(tieneEspecialActivo(buffs, "xpOficioX2", 1000), false, "caducado");
  assert.strictEqual(tieneEspecialActivo(buffs, "produccionCrafteoX2", 1000), false, "no presente");
});

test("tieneEspecialActivo: varias pociones apiladas del mismo especial no se acumulan, basta con que una siga viva", () => {
  const buffs: BuffPocion[] = [
    { categoria: "especial", especial: "sigilo", expiraEn: 500 },
    { categoria: "especial", especial: "sigilo", expiraEn: 2000 },
  ];
  assert.strictEqual(tieneEspecialActivo(buffs, "sigilo", 1000), true, "la segunda copia sigue viva");
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
    const efectoFinal = r.efectos![i];
    const efectoBase = s.resultadoBase.efectos[i];
    assert.strictEqual(efectoFinal.categoria, efectoBase.categoria, "colarPocion no cambia la categoría de ningún efecto");
    if (efectoFinal.categoria === "stat" && efectoBase.categoria === "stat") {
      assert.ok(Math.abs(efectoFinal.magnitudPct - efectoBase.magnitudPct) < 0.5, "con pureza casi perfecta, la magnitud final debe quedar muy cerca de la tirada base");
    }
  }
});

test("colarPocion: pureza pésima escala al suelo FACTOR_PUREZA_MINIMO (nunca 0)", () => {
  const s = iniciarSesionAlquimia([catalizador("a"), catalizador("b"), catalizador("c")], rndFijo(0.5), 0);
  // arranca frío y nunca se aviva -> nunca entra en la ventana objetivo
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pureza, 0);
  for (let i = 0; i < r.efectos!.length; i++) {
    const efectoFinal = r.efectos![i];
    const efectoBase = s.resultadoBase.efectos[i];
    if (efectoBase.categoria === "stat" && efectoFinal.categoria === "stat") {
      const esperado = efectoBase.magnitudPct * FACTOR_PUREZA_MINIMO;
      assert.ok(Math.abs(efectoFinal.magnitudPct - esperado) < 1e-9);
    } else {
      assert.strictEqual(efectoFinal.categoria, "especial");
    }
  }
});

test("colarPocion: un efecto 'especial' pasa intacto (sin magnitud que escalar), tenga la pureza que tenga", () => {
  const s = iniciarSesionAlquimia([neutro("x")], rndFijo(0.99), 0);
  // fuerza un especial a mano en resultadoBase — qué especial exacto sale
  // sorteado por prepararPocion ya se cubre en el test de arriba con
  // múltiples semillas; este test aísla solo el paso-through de colarPocion.
  s.resultadoBase = { efectos: [{ categoria: "especial", especial: "sigilo" }], corruptivosUnicos: 0, catalizadoresUnicos: 0, mezclaAvanzada: false };
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.efectos, [{ categoria: "especial", especial: "sigilo" }]);
});

test("colarPocion: nunca cambia QUÉ stat salió ni el signo del efecto, solo su magnitud", () => {
  const s = iniciarSesionAlquimia([corruptivo("veneno")], rndFijo(0), 0); // negativo garantizado, sin catalizador -> nunca hay positivos
  const negativoBase = s.resultadoBase.efectos.find(esStat)!;
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  const negativoFinal = r.efectos!.find(esStat)!;
  assert.strictEqual(negativoFinal.stat, negativoBase.stat);
  assert.ok(negativoFinal.magnitudPct <= 0, "un efecto negativo escalado sigue siendo negativo (o 0), nunca cambia de signo");
});

// --- colorPocion / itemIdPocion (docs/GDD_Pociones.md, ampliación 2026-09-01: listado de color por ingredientes) ---

test("colorPocion: sin corruptivo ni catalizador -> 'clara'", () => {
  assert.strictEqual(colorPocion({ corruptivosUnicos: 0, catalizadoresUnicos: 0, mezclaAvanzada: false }), "clara");
});

test("colorPocion: solo corruptivo -> 'toxica'", () => {
  assert.strictEqual(colorPocion({ corruptivosUnicos: 1, catalizadoresUnicos: 0, mezclaAvanzada: false }), "toxica");
  assert.strictEqual(colorPocion({ corruptivosUnicos: 2, catalizadoresUnicos: 0, mezclaAvanzada: false }), "toxica");
});

test("colorPocion: solo catalizador (sin mezcla avanzada) -> 'vital'", () => {
  assert.strictEqual(colorPocion({ corruptivosUnicos: 0, catalizadoresUnicos: 1, mezclaAvanzada: false }), "vital");
  assert.strictEqual(colorPocion({ corruptivosUnicos: 0, catalizadoresUnicos: 2, mezclaAvanzada: false }), "vital");
});

test("colorPocion: corruptivo Y catalizador a la vez (sin mezcla avanzada) -> 'inestable'", () => {
  assert.strictEqual(colorPocion({ corruptivosUnicos: 1, catalizadoresUnicos: 1, mezclaAvanzada: false }), "inestable");
  assert.strictEqual(colorPocion({ corruptivosUnicos: 2, catalizadoresUnicos: 2, mezclaAvanzada: false }), "inestable");
});

test("colorPocion: mezcla avanzada manda SIEMPRE -> 'radiante', aunque también haya corruptivo (no cae en 'inestable')", () => {
  assert.strictEqual(colorPocion({ corruptivosUnicos: 0, catalizadoresUnicos: 3, mezclaAvanzada: true }), "radiante");
  assert.strictEqual(colorPocion({ corruptivosUnicos: 2, catalizadoresUnicos: 3, mezclaAvanzada: true }), "radiante");
});

test("itemIdPocion: mapea cada color a su itemId real de catálogo", () => {
  assert.strictEqual(itemIdPocion("clara"), "pocion_alquimica_clara");
  assert.strictEqual(itemIdPocion("toxica"), "pocion_alquimica_toxica");
  assert.strictEqual(itemIdPocion("vital"), "pocion_alquimica_vital");
  assert.strictEqual(itemIdPocion("inestable"), "pocion_alquimica_inestable");
  assert.strictEqual(itemIdPocion("radiante"), "pocion_alquimica_radiante");
});

test("colarPocion: el resultado trae 'color' calculado a partir de resultadoBase (corruptivo+catalizador -> 'inestable')", () => {
  const s = iniciarSesionAlquimia([corruptivo("hierba_venenosa"), catalizador("hierba_curativa")], rndFijo(0.9), 0);
  const r = colarPocion(s, CONFIG_ESTACION_ALQUIMIA.duracionMinimaSeg * 1000 + 100);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.color, "inestable");
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
