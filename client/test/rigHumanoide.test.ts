import { test } from "node:test";
import assert from "node:assert/strict";
import { poseDeAccionHerramienta } from "../src/render3d/rigHumanoide";

// Suite de la curva de pose de recoger/talar/picar/golpear (pedido streamer
// 2026-09-06: "recoger... talar o picar tiene que tener su animación con el
// hacha y pico en la mano claro") — función PURA, sin THREE.js/timers, para
// poder verificar los ángulos exactos de forma determinista. Un intento
// anterior de verificar esto muestreando frames reales vía Playwright contra
// el renderer software de este entorno (SwiftShader bajo Chromium headless)
// resultó poco fiable: perder el frame exacto del pico del golpe deja ver un
// ángulo cercano a 0 aunque la curva en sí sea correcta — esta suite cubre
// la curva de verdad, y el E2E (accionesAnimacion.e2e.mjs) se queda solo con
// las comprobaciones de red/equipo/capturas que sí puede hacer con fiabilidad.
// Ejecutar: node --import tsx --test client/test/rigHumanoide.test.ts

test("poseDeAccionHerramienta: golpe (talar/picar/golpear) arma el brazo hacia atrás al empezar", () => {
  const pose = poseDeAccionHerramienta("talar", 0);
  assert.strictEqual(pose.brazoDerRotX, 0);
  assert.strictEqual(pose.torsoRotX, 0);
});

test("poseDeAccionHerramienta: golpe alcanza el pico del armado justo antes del golpe (progreso=0.35)", () => {
  const pose = poseDeAccionHerramienta("talar", 0.35);
  assert.strictEqual(pose.brazoDerRotX, -2.1);
  assert.strictEqual(pose.torsoRotX, -0.15);
});

test("poseDeAccionHerramienta: golpe cruza por el ángulo del impacto (progreso=0.55)", () => {
  const pose = poseDeAccionHerramienta("talar", 0.55);
  assert.strictEqual(pose.brazoDerRotX, 0.85);
  assert.strictEqual(pose.torsoRotX, 0.3);
});

test("poseDeAccionHerramienta: golpe recupera la pose neutra al terminar (progreso=1)", () => {
  // Tolerancia de punto flotante a propósito (no strictEqual con 0): la
  // división (1-0.55)/0.45 no cae en 1.0 exacto en IEEE 754, deja un
  // épsilon del orden de 1e-16 — irrelevante para la animación real.
  const pose = poseDeAccionHerramienta("talar", 1);
  assert.ok(Math.abs(pose.brazoDerRotX) < 1e-9, `brazoDerRotX debería ser ~0, fue ${pose.brazoDerRotX}`);
  assert.ok(Math.abs(pose.torsoRotX) < 1e-9, `torsoRotX debería ser ~0, fue ${pose.torsoRotX}`);
});

test("poseDeAccionHerramienta: talar/picar/golpear comparten EXACTAMENTE la misma coreografía (una sola, no una por herramienta)", () => {
  for (const p of [0, 0.2, 0.35, 0.5, 0.55, 0.8, 1]) {
    const talar = poseDeAccionHerramienta("talar", p);
    const picar = poseDeAccionHerramienta("picar", p);
    const golpear = poseDeAccionHerramienta("golpear", p);
    assert.deepStrictEqual(picar, talar, `picar difiere de talar en progreso=${p}`);
    assert.deepStrictEqual(golpear, talar, `golpear difiere de talar en progreso=${p}`);
  }
});

test("poseDeAccionHerramienta: el brazo izquierdo SOLO acompaña un poco (nunca en espejo, no sujeta nada) durante el golpe", () => {
  const pose = poseDeAccionHerramienta("talar", 0.35);
  assert.strictEqual(pose.brazoIzqRotX, pose.brazoDerRotX * 0.3);
});

test("poseDeAccionHerramienta: recoger es una curva DISTINTA (agacharse con las piernas, no un golpe de brazo)", () => {
  const inicio = poseDeAccionHerramienta("recoger", 0);
  const pico = poseDeAccionHerramienta("recoger", 0.5);
  const fin = poseDeAccionHerramienta("recoger", 1);
  assert.strictEqual(inicio.piernaRotX, 0);
  assert.strictEqual(fin.piernaRotX, 0);
  assert.ok(pico.piernaRotX > 0.5, "las piernas se doblan de verdad al agacharse en el punto más bajo");
  assert.ok(pico.torsoRotX > 0.5, "el torso se inclina hacia delante al agacharse");
  assert.ok(pico.torsoOffsetY < -0.15, "la cadera baja de verdad, no solo rota el torso");
});

test("poseDeAccionHerramienta: recoger es simétrica (bajar y subir tardan lo mismo)", () => {
  const bajando = poseDeAccionHerramienta("recoger", 0.25);
  const subiendo = poseDeAccionHerramienta("recoger", 0.75);
  assert.strictEqual(bajando.piernaRotX, subiendo.piernaRotX);
  assert.strictEqual(bajando.torsoRotX, subiendo.torsoRotX);
});

test("poseDeAccionHerramienta: progreso fuera de [0,1] se recorta, nunca extrapola", () => {
  assert.deepStrictEqual(poseDeAccionHerramienta("talar", -5), poseDeAccionHerramienta("talar", 0));
  assert.deepStrictEqual(poseDeAccionHerramienta("talar", 5), poseDeAccionHerramienta("talar", 1));
  assert.deepStrictEqual(poseDeAccionHerramienta("recoger", -5), poseDeAccionHerramienta("recoger", 0));
});
