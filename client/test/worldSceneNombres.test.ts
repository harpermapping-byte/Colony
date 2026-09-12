// Nombres flotantes solo de cerca (docs/GDD_UI_Paneles.md, pedido streamer
// 2026-09-12: "los nombres... solo se muestran al acercarte mucho... o al
// darle click") — se prueba la histéresis PURA (`decidirVisibilidadNombre`,
// sin THREE/DOM: worldScene.ts la usa sobre distancias reales de mundo).
// Ejecutar: node --import tsx --test client/test/worldSceneNombres.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirVisibilidadNombre } from "../src/render3d/visibilidadNombres";

const R_VIS2 = 12 * 12;
const R_OCULTAR2 = 15 * 15;

test("decidirVisibilidadNombre: oculto y lejos sigue oculto", () => {
  assert.strictEqual(decidirVisibilidadNombre(false, 20 * 20, R_VIS2, R_OCULTAR2), false);
});

test("decidirVisibilidadNombre: oculto y dentro del radio visible pasa a visible", () => {
  assert.strictEqual(decidirVisibilidadNombre(false, 5 * 5, R_VIS2, R_OCULTAR2), true);
  assert.strictEqual(decidirVisibilidadNombre(false, 12 * 12, R_VIS2, R_OCULTAR2), true, "justo en el borde (<=) también cuenta");
});

test("decidirVisibilidadNombre: visible y todavía dentro de la zona de histéresis (12-15) sigue visible", () => {
  assert.strictEqual(decidirVisibilidadNombre(true, 13 * 13, R_VIS2, R_OCULTAR2), true, "por encima del radio de entrada pero por debajo del de salida");
  assert.strictEqual(decidirVisibilidadNombre(true, 15 * 15, R_VIS2, R_OCULTAR2), true, "justo en el borde de salida (no excede) sigue visible");
});

test("decidirVisibilidadNombre: visible y más allá del radio de ocultar pasa a oculto", () => {
  assert.strictEqual(decidirVisibilidadNombre(true, 16 * 16, R_VIS2, R_OCULTAR2), false);
});

test("decidirVisibilidadNombre: oculto y en la zona de histéresis (12-15) sigue oculto — nunca 'salta' a visible sin cruzar el radio de entrada", () => {
  assert.strictEqual(decidirVisibilidadNombre(false, 13 * 13, R_VIS2, R_OCULTAR2), false);
});

test("decidirVisibilidadNombre: nunca parpadea rondando el borde — una secuencia de distancias oscilando entre 12 y 15 no cambia de estado", () => {
  let visible = false;
  const distancias = [12, 13, 14, 15, 14, 13, 12, 13, 14, 15];
  let cambios = 0;
  for (const d of distancias) {
    const nuevo = decidirVisibilidadNombre(visible, d * d, R_VIS2, R_OCULTAR2);
    if (nuevo !== visible) cambios++;
    visible = nuevo;
  }
  // Solo el primer valor (12, <=12) puede disparar UN cambio (entra); el resto se queda dentro de la histéresis.
  assert.strictEqual(cambios, 1, "solo debería activarse una vez, nunca oscilar dentro de 12-15");
  assert.strictEqual(visible, true);
});
