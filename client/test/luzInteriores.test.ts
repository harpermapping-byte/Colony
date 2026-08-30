import { test } from "node:test";
import assert from "node:assert/strict";
import { nivelLuzExterior, luzAmbienteSala, NIVEL_LUZ_LUNA, TOPE_LUZ_AMBIENTE } from "../src/render3d/luzInteriores";

// Suite de luz ambiente en interiores (docs/Backlog_Mecanicas_Futuras.md,
// "Luz ambiente por hora del día en interiores") — lógica pura, sin THREE
// ni DOM. Ejecutar: node --import tsx --test client/test/luzInteriores.test.ts

test("nivelLuzExterior: de noche se queda en el suelo de luna, nunca 0", () => {
  assert.strictEqual(nivelLuzExterior(0), NIVEL_LUZ_LUNA);
  assert.strictEqual(nivelLuzExterior(2), NIVEL_LUZ_LUNA);
  assert.strictEqual(nivelLuzExterior(23.9), NIVEL_LUZ_LUNA);
  assert.ok(NIVEL_LUZ_LUNA > 0, "la luz de luna no debe ser cero del todo");
});

test("nivelLuzExterior: máximo a mediodía solar (punto medio entre amanecer y anochecer)", () => {
  // tiempo.json: horaAmanecer=4, horaAnochecer=20 → mediodía solar en 12
  const mediodia = nivelLuzExterior(12);
  assert.ok(mediodia > 0.95, `mediodía debería rondar el máximo (1), salió ${mediodia}`);
  const amanecer = nivelLuzExterior(4);
  const media_manana = nivelLuzExterior(8);
  assert.ok(amanecer < media_manana, "sube según avanza la mañana");
  assert.ok(media_manana < mediodia, "sigue subiendo hacia el mediodía");
});

test("nivelLuzExterior: nunca se sale de [NIVEL_LUZ_LUNA, 1] en ningún punto del día", () => {
  for (let h = 0; h < 24; h += 0.5) {
    const n = nivelLuzExterior(h);
    assert.ok(n >= NIVEL_LUZ_LUNA - 1e-9 && n <= 1 + 1e-9, `hora ${h}: ${n} fuera de rango`);
  }
});

test("nivelLuzExterior: simétrica alrededor del mediodía (amanecer/anochecer al mismo nivel bajo)", () => {
  const cercaAmanecer = nivelLuzExterior(5);
  const cercaAnochecer = nivelLuzExterior(19);
  assert.ok(Math.abs(cercaAmanecer - cercaAnochecer) < 0.01);
});

test("luzAmbienteSala: sin ventana (sumaAporteLuz<=0) siempre 0, sea la hora que sea", () => {
  assert.strictEqual(luzAmbienteSala(12, 0), 0);
  assert.strictEqual(luzAmbienteSala(12, -1), 0);
  assert.strictEqual(luzAmbienteSala(0, 0), 0);
});

test("luzAmbienteSala: de noche, con ventana, da poca luz pero no cero (luz de luna filtrada)", () => {
  const n = luzAmbienteSala(2, 2); // una ventana grande normal, de madrugada
  assert.ok(n > 0, "debe entrar algo de luz de luna");
  assert.ok(n < 0.3, `de noche debería ser tenue, salió ${n}`);
});

test("luzAmbienteSala: rendimientos decrecientes — 4 ventanas de aporte 1 no cuadriplican, dan √4=2× una sola", () => {
  // hora=6 (no mediodía): nivelLuzExterior < 1 ahí, así que el tope de 1 no
  // enmascara la diferencia entre sumaAporteLuz=1 y =4 (a mediodía ambas
  // saturarían al mismo tope y la comparación no diría nada real).
  const unaVentana = luzAmbienteSala(6, 1);
  const cuatroVentanas = luzAmbienteSala(6, 4);
  assert.ok(unaVentana > 0 && unaVentana < 1, `precondición: no debe estar ya saturada, salió ${unaVentana}`);
  assert.ok(Math.abs(cuatroVentanas - unaVentana * 2) < 0.01, `4 ventanas debería dar ~2x una, salió ${cuatroVentanas} vs ${unaVentana}`);
  assert.ok(cuatroVentanas < unaVentana * 4, "nunca lineal — nunca 4x");
});

test("luzAmbienteSala: nunca supera TOPE_LUZ_AMBIENTE aunque haya muchísima ventana", () => {
  assert.strictEqual(luzAmbienteSala(12, 1000), TOPE_LUZ_AMBIENTE);
});
