// Tests del minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería,
// pedido 2026-09-01). Los tests de golpe/temple fijan `ahoraMs` al mismo
// valor que `sesion.ultimaAccionEn` (dt=0) y tocan `sesion.cursor`/
// `sesion.temperatura` a mano para aislar la puntuación de la simulación de
// tiempo — la simulación de tiempo (avanzar) se prueba aparte. Ejecutar: npm
// test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  iniciarSesionForja,
  avivarFuego,
  golpearYunque,
  templar,
  resultadoForja,
  CONFIG_FORJA_DEFECTO,
  SesionForja,
} from "../src/construccion/herreria";

const rndFijo = (valor: number) => () => valor;

test("iniciarSesionForja: estado inicial en CALENTAR, temperatura/combustible/calidad de partida", () => {
  const s = iniciarSesionForja("espada_corta_craft", 1000);
  assert.strictEqual(s.fase, "CALENTAR");
  assert.strictEqual(s.temperatura, CONFIG_FORJA_DEFECTO.temperaturaInicial);
  assert.strictEqual(s.combustible, CONFIG_FORJA_DEFECTO.combustibleMax);
  assert.strictEqual(s.golpes, 0);
  assert.strictEqual(s.calidad, 0.35);
});

test("avivarFuego: calienta y consume combustible; transiciona a FORJAR al llegar al umbral", () => {
  const s = iniciarSesionForja("x", 0);
  const r1 = avivarFuego(s, 0);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(s.combustible, CONFIG_FORJA_DEFECTO.combustibleMax - 1);
  assert.strictEqual(s.fase, "CALENTAR"); // 12 + 22 = 34, todavía bajo 68
  assert.ok(s.temperatura < CONFIG_FORJA_DEFECTO.temperaturaObjetivoForja);

  avivarFuego(s, 0);
  avivarFuego(s, 0);
  assert.strictEqual(s.fase, "FORJAR"); // 12+22*3=78 >= 68
});

test("avivarFuego: sin combustible falla con motivo, no muta temperatura", () => {
  const s = iniciarSesionForja("x", 0);
  s.combustible = 0;
  const antes = s.temperatura;
  const r = avivarFuego(s, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_combustible");
  assert.strictEqual(s.temperatura, antes);
});

test("avivarFuego: fuera de CALENTAR/FORJAR (TEMPLAR/TERMINADO) falla con fase_incorrecta", () => {
  const s = iniciarSesionForja("x", 0);
  s.fase = "TEMPLAR";
  assert.strictEqual(avivarFuego(s, 0).motivo, "fase_incorrecta");
  s.fase = "TERMINADO";
  assert.strictEqual(avivarFuego(s, 0).motivo, "fase_incorrecta");
});

function sesionForjando(overrides: Partial<SesionForja> = {}): SesionForja {
  const s = iniciarSesionForja("x", 0);
  s.fase = "FORJAR";
  s.temperatura = 70; // dentro de la ventana óptima [62,88]
  Object.assign(s, overrides);
  return s;
}

test("golpearYunque: fuera de FORJAR falla con fase_incorrecta", () => {
  const s = iniciarSesionForja("x", 0);
  const r = golpearYunque(s, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "fase_incorrecta");
});

test("golpearYunque: cursor centrado + temperatura óptima en el primer golpe = perfecto", () => {
  const s = sesionForjando({ cursor: 0.5 });
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calidad, "perfecto");
  assert.strictEqual(s.golpesPerfectos, 1);
  assert.ok(s.calidad > 0.35);
});

test("golpearYunque: cursor lejos del centro pero dentro de ventana ancha = bueno", () => {
  const s = sesionForjando({ cursor: 0.5 + 0.15 }); // distancia = 0.3, < 0.34 pero fuera de ventana perfecta
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(r.calidad, "bueno");
  assert.strictEqual(s.golpesBuenos, 1);
});

test("golpearYunque: cursor muy lejos del centro = malo, resta calidad", () => {
  const s = sesionForjando({ cursor: 0.95 });
  const antes = s.calidad;
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(r.calidad, "malo");
  assert.strictEqual(s.golpesMalos, 1);
  assert.ok(s.calidad < antes);
});

test("golpearYunque: temperatura fuera de la ventana óptima nunca da perfecto aunque el cursor esté centrado", () => {
  const s = sesionForjando({ cursor: 0.5, temperatura: 95 }); // por encima de temperaturaOptimaMax (88)
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.notStrictEqual(r.calidad, "perfecto");
});

test("golpearYunque: temperatura por debajo de temperaturaMinimaForja da malo aunque el cursor esté centrado", () => {
  const s = sesionForjando({ cursor: 0.5, temperatura: 30 });
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(r.calidad, "malo");
});

test("golpearYunque: dificultad #2 — la ventana de perfecto se estrecha con el progreso (mismo cursor, perfecto al principio, ya no al final)", () => {
  const cursorLimite = 0.5 + 0.10; // distancia 0.20... hace falta algo más fino: usamos distancia justo bajo 0.13 y justo bajo 0.08
  const distanciaIntermedia = 0.10; // < 0.13 (ventana golpe 1) pero > 0.08 (ventana golpe 12)
  const cursor = 0.5 + distanciaIntermedia / 2;

  const sTemprano = sesionForjando({ cursor, golpes: 0 });
  const rTemprano = golpearYunque(sTemprano, sTemprano.ultimaAccionEn);
  assert.strictEqual(rTemprano.calidad, "perfecto", "con la ventana ancha del primer golpe debe contar como perfecto");

  const sTardio = sesionForjando({ cursor, golpes: CONFIG_FORJA_DEFECTO.golpesObjetivo - 1 });
  const rTardio = golpearYunque(sTardio, sTardio.ultimaAccionEn);
  assert.notStrictEqual(rTardio.calidad, "perfecto", "con la ventana estrecha del último golpe ya NO debe contar como perfecto");
});

test("golpearYunque: dificultad #1 — velocidadCursor se re-sortea tras cada golpe usando rnd inyectado", () => {
  const s1 = sesionForjando({ cursor: 0.5 });
  golpearYunque(s1, s1.ultimaAccionEn, rndFijo(0));
  const s2 = sesionForjando({ cursor: 0.5 });
  golpearYunque(s2, s2.ultimaAccionEn, rndFijo(1));

  assert.notStrictEqual(s1.velocidadCursor, s2.velocidadCursor);
  const progreso = 1 / CONFIG_FORJA_DEFECTO.golpesObjetivo;
  assert.ok(Math.abs(s1.velocidadCursor - (0.7 + 0 * 0.5 + progreso * 0.3)) < 1e-9);
  assert.ok(Math.abs(s2.velocidadCursor - (0.7 + 1 * 0.5 + progreso * 0.3)) < 1e-9);
});

test("golpearYunque: se detiene en golpesObjetivo y pasa a TEMPLAR", () => {
  const s = sesionForjando({ golpes: CONFIG_FORJA_DEFECTO.golpesObjetivo - 1, cursor: 0.5 });
  const r = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.fase, "TEMPLAR");
  assert.strictEqual(s.golpes, CONFIG_FORJA_DEFECTO.golpesObjetivo);

  const rExtra = golpearYunque(s, s.ultimaAccionEn);
  assert.strictEqual(rExtra.ok, false);
  assert.strictEqual(rExtra.motivo, "fase_incorrecta"); // ya no está en FORJAR
});

test("templar: temperatura en ventana suma calidad y termina la sesión", () => {
  const s = iniciarSesionForja("x", 0);
  s.fase = "TEMPLAR";
  s.temperatura = 70;
  s.calidad = 0.5;
  const r = templar(s, s.ultimaAccionEn);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.fase, "TERMINADO");
  assert.ok(s.calidad > 0.5);
});

test("templar: temperatura sobrecalentada penaliza más que temperatura fría", () => {
  const sCaliente = iniciarSesionForja("x", 0);
  sCaliente.fase = "TEMPLAR";
  sCaliente.temperatura = 99;
  sCaliente.calidad = 0.5;
  templar(sCaliente, sCaliente.ultimaAccionEn);

  const sFria = iniciarSesionForja("x", 0);
  sFria.fase = "TEMPLAR";
  sFria.temperatura = 40;
  sFria.calidad = 0.5;
  templar(sFria, sFria.ultimaAccionEn);

  assert.ok(sCaliente.calidad < sFria.calidad);
});

test("templar: fuera de fase TEMPLAR falla con fase_incorrecta", () => {
  const s = iniciarSesionForja("x", 0);
  assert.strictEqual(templar(s, 0).motivo, "fase_incorrecta");
});

test("resultadoForja: calidad 1.0 da 5 estrellas y perfecta=true; calidad baja da menos de 5 y perfecta=false", () => {
  const s = iniciarSesionForja("x", 0);
  s.calidad = 1;
  assert.deepStrictEqual(resultadoForja(s), { estrellas: 5, perfecta: true });

  s.calidad = 0.1;
  const r = resultadoForja(s);
  assert.ok(r.estrellas < 5);
  assert.strictEqual(r.perfecta, false);

  s.calidad = 0; // nunca menos de 1 estrella (siempre se entrega algo)
  assert.strictEqual(resultadoForja(s).estrellas, 1);
});

test("avanzar (vía avivarFuego): la temperatura decae con el tiempo transcurrido antes de aplicar la acción", () => {
  const s = iniciarSesionForja("x", 0);
  const r = avivarFuego(s, 5000); // 5s sin tocar nada: decae a razón de enfriamientoCalentarPorSeg
  const decaidaEsperada = Math.max(0, CONFIG_FORJA_DEFECTO.temperaturaInicial - CONFIG_FORJA_DEFECTO.enfriamientoCalentarPorSeg * 5);
  assert.strictEqual(r.ok, true);
  // tras decaer, avivarFuego SUMA gananciaCalorCalentar sobre la temperatura ya decaída
  assert.strictEqual(s.temperatura, Math.min(100, decaidaEsperada + CONFIG_FORJA_DEFECTO.gananciaCalorCalentar));
});

test("simulación completa: jugando siempre centrado y a temperatura óptima se llega a perfecta=true", () => {
  let t = 0;
  const s = iniciarSesionForja("espada_corta_craft", t);
  while (s.fase === "CALENTAR") { t += 100; avivarFuego(s, t); }
  while (s.fase === "FORJAR") {
    t += 50;
    s.cursor = 0.5; // congelamos el cursor centrado a mano para aislar la calidad del golpe del azar del tiempo
    s.temperatura = 75;
    golpearYunque(s, t, rndFijo(0.3));
  }
  s.temperatura = 70;
  templar(s, t + 50);
  const resultado = resultadoForja(s);
  assert.strictEqual(resultado.perfecta, true, `esperaba perfecta, calidad=${s.calidad}`);
});

test("simulación completa: jugando siempre lejos del centro NO llega a perfecta", () => {
  let t = 0;
  const s = iniciarSesionForja("espada_corta_craft", t);
  while (s.fase === "CALENTAR") { t += 100; avivarFuego(s, t); }
  while (s.fase === "FORJAR") {
    t += 50;
    s.cursor = 0.95;
    golpearYunque(s, t);
  }
  templar(s, t + 50);
  const resultado = resultadoForja(s);
  assert.strictEqual(resultado.perfecta, false);
});
