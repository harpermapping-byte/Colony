// Tests de estacionFuego.ts — motor genérico de "gestiona el calor un rato
// y termina" reutilizado por alquimia.ts (y cocina más adelante). Ejecutar:
// npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  iniciarSesionEstacion,
  avivarEstacion,
  enfriarEstacion,
  finalizarEstacion,
  ConfigEstacion,
} from "../src/construccion/estacionFuego";

const CFG: ConfigEstacion = {
  temperaturaInicial: 20,
  temperaturaObjetivoMin: 50,
  temperaturaObjetivoMax: 70,
  gananciaCalor: 15,
  perdidaCalor: 10,
  enfriamientoAmbientePorSeg: 2,
  duracionMinimaSeg: 5,
};

test("iniciarSesionEstacion: estado inicial", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  assert.strictEqual(s.fase, "TRABAJANDO");
  assert.strictEqual(s.temperatura, 20);
  assert.strictEqual(s.segundosEnVentana, 0);
  assert.strictEqual(s.segundosTotales, 0);
});

test("avivarEstacion: sube temperatura, tope 100", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  avivarEstacion(s, 0, CFG);
  assert.strictEqual(s.temperatura, 35);
  for (let i = 0; i < 10; i++) avivarEstacion(s, 0, CFG);
  assert.strictEqual(s.temperatura, 100);
});

test("enfriarEstacion: baja temperatura, suelo 0", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  enfriarEstacion(s, 0, CFG);
  assert.strictEqual(s.temperatura, 10);
  enfriarEstacion(s, 0, CFG);
  assert.strictEqual(s.temperatura, 0);
});

test("avanzar (vía avivar): la temperatura decae con el tiempo transcurrido antes de la acción", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  avivarEstacion(s, 3000, CFG); // 3s de enfriamiento ambiente (2/s) antes de sumar el golpe de calor
  assert.strictEqual(s.temperatura, 20 - 2 * 3 + 15);
});

test("finalizarEstacion: 'demasiado_pronto' si no ha pasado duracionMinimaSeg", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  const r = finalizarEstacion(s, 1000, CFG); // solo 1s
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "demasiado_pronto");
  assert.strictEqual(s.fase, "TRABAJANDO", "no debe terminar la sesión si falla");
});

test("finalizarEstacion: pureza alta si la sesión pasa la mayor parte del tiempo dentro de la ventana objetivo", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  s.temperatura = 65; // dentro de [50,70]; a 2/s tarda (65-50)/2=7.5s en salir por abajo
  const r = finalizarEstacion(s, 8000, CFG); // 8s totales: ~7.5s dentro, ~0.5s fuera -> pureza ~0.9375
  assert.strictEqual(r.ok, true);
  assert.ok(Math.abs(r.pureza! - 7.5 / 8) < 0.02, `pureza esperada ~0.9375, salió ${r.pureza}`);
});

test("finalizarEstacion: pureza 0 si nunca estuvo en la ventana (siempre demasiado frío)", () => {
  const s = iniciarSesionEstacion(CFG, 0); // arranca a 20, ventana [50,70] — nunca se aviva
  const r = finalizarEstacion(s, 6000, CFG);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pureza, 0);
});

test("finalizarEstacion: pureza parcial si solo una parte del tiempo estuvo en ventana", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  s.temperatura = 60; // dentro de [50,70]; a 2/s tarda (60-50)/2=5s en salir por abajo
  const r = finalizarEstacion(s, 10000, CFG); // 10s totales: 5s dentro, 5s fuera -> pureza ~0.5
  assert.strictEqual(r.ok, true);
  assert.ok(Math.abs(r.pureza! - 0.5) < 0.02, `pureza esperada ~0.5, salió ${r.pureza}`);
});

test("finalizarEstacion: fase_incorrecta si se llama dos veces", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  finalizarEstacion(s, 6000, CFG);
  const r2 = finalizarEstacion(s, 7000, CFG);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.motivo, "fase_incorrecta");
});

test("avivarEstacion/enfriarEstacion: fase_incorrecta tras finalizar", () => {
  const s = iniciarSesionEstacion(CFG, 0);
  finalizarEstacion(s, 6000, CFG);
  assert.strictEqual(avivarEstacion(s, 7000, CFG).motivo, "fase_incorrecta");
  assert.strictEqual(enfriarEstacion(s, 7000, CFG).motivo, "fase_incorrecta");
});
