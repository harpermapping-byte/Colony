// Tests de la lógica PURA de oficios ronda 2 (server/src/personaje/oficios.ts,
// docs/GDD_Profesiones.md, pedido 2026-08-30: "sigue sin coste ni
// exclusividad real... 2 oficios"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  OFICIOS_JUGADOR_VALIDOS, tieneOficio, NIVEL_MAX_OFICIO,
  bonusVelocidadCrafteoPorNivelOficio, bonusCantidadCrafteoPorNivelOficio,
  FRASES_VENDEDOR_SUCIO, FRASES_NPC_SUCIO,
} from "../src/personaje/oficios";

test("OFICIOS_JUGADOR_VALIDOS: exactamente los 10 oficios finales", () => {
  assert.strictEqual(OFICIOS_JUGADOR_VALIDOS.size, 10);
  for (const id of ["herrero", "carpintero", "ingeniero", "picapedrero", "molinero", "cazador", "cocinero", "curandero", "curtidor", "joyero"]) {
    assert.ok(OFICIOS_JUGADOR_VALIDOS.has(id), `falta ${id}`);
  }
});

test("tieneOficio: cualquiera de los 2 slots cuenta, vacíos no", () => {
  assert.strictEqual(tieneOficio("curtidor", "", "curtidor"), true);
  assert.strictEqual(tieneOficio("", "herrero", "herrero"), true);
  assert.strictEqual(tieneOficio("curtidor", "herrero", "joyero"), false);
  assert.strictEqual(tieneOficio("", "", "curtidor"), false);
});

test("bonusVelocidadCrafteoPorNivelOficio: 0% en nivel 1, +50% en nivel 10, lineal entre medias", () => {
  assert.strictEqual(bonusVelocidadCrafteoPorNivelOficio(1), 0);
  assert.strictEqual(bonusVelocidadCrafteoPorNivelOficio(NIVEL_MAX_OFICIO), 0.5);
  const n5 = bonusVelocidadCrafteoPorNivelOficio(5);
  const n6 = bonusVelocidadCrafteoPorNivelOficio(6);
  assert.ok(n5 > 0 && n5 < 0.5, "nivel intermedio debe estar entre 0 y el máximo");
  assert.ok(n6 > n5, "más nivel, más bono — nunca al revés");
});

test("bonusCantidadCrafteoPorNivelOficio: 0% en nivel 1, +100% (x2) en nivel 10, lineal entre medias", () => {
  assert.strictEqual(bonusCantidadCrafteoPorNivelOficio(1), 0);
  assert.strictEqual(bonusCantidadCrafteoPorNivelOficio(NIVEL_MAX_OFICIO), 1);
  const n5 = bonusCantidadCrafteoPorNivelOficio(5);
  const n6 = bonusCantidadCrafteoPorNivelOficio(6);
  assert.ok(n5 > 0 && n5 < 1, "nivel intermedio debe estar entre 0 y el máximo");
  assert.ok(n6 > n5, "más nivel, más bono — nunca al revés");
});

test("bonus de nivel: nunca se sale de [0,1] aunque llegue un nivel fuera de rango", () => {
  assert.strictEqual(bonusVelocidadCrafteoPorNivelOficio(0), 0);
  assert.strictEqual(bonusVelocidadCrafteoPorNivelOficio(999), 0.5);
  assert.strictEqual(bonusCantidadCrafteoPorNivelOficio(0), 0);
  assert.strictEqual(bonusCantidadCrafteoPorNivelOficio(999), 1);
});

test("frases de suciedad: al menos 10-15 de vendedor y 20 de NPC genérico, sin huecos ni duplicados", () => {
  assert.ok(FRASES_VENDEDOR_SUCIO.length >= 10, `solo ${FRASES_VENDEDOR_SUCIO.length} frases de vendedor`);
  assert.ok(FRASES_NPC_SUCIO.length >= 20, `solo ${FRASES_NPC_SUCIO.length} frases de NPC genérico`);
  assert.strictEqual(new Set(FRASES_VENDEDOR_SUCIO).size, FRASES_VENDEDOR_SUCIO.length, "frase de vendedor duplicada");
  assert.strictEqual(new Set(FRASES_NPC_SUCIO).size, FRASES_NPC_SUCIO.length, "frase de NPC duplicada");
  for (const f of [...FRASES_VENDEDOR_SUCIO, ...FRASES_NPC_SUCIO]) assert.ok(f.trim().length > 0);
});
