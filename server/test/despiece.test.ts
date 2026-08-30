// Tests de mundo/despiece.ts (docs/GDD_Caza.md, rediseño 2026-08-30 octava
// pasada) — procesar (desollar/despiezar) el ítem "cadáver entero" ya
// recogido: en el sitio (más lento, menos material) o junto a mesa_despiece/
// mesa_corte (más rápido, más material). Lógica PURA. Ejecutar: npm test.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  iniciarDespiece, despiezeListo, recolectarDespiece,
  MULTIPLICADOR_TIEMPO_CAMPO, FRACCION_MATERIAL_CAMPO,
} from "../src/mundo/despiece";
import { cadaverItemId } from "../src/mundo/lootCaza";
import { EstadisticasCombateAnimal } from "../src/mundo/catalogoCombateFauna";

const JABALI: EstadisticasCombateAnimal = {
  categoriaVida: "grande", vidaMaxima: 200, ataque: 25, peligroso: true, domesticable: false,
  categoriaRecursoCarne: "carne_caza_mayor", categoriaRecursoPiel: "cuero_grueso",
};
const ID_JABALI = cadaverItemId(JABALI); // cadaver_carne_caza_mayor_cuero_grueso_grande

test("iniciarDespiece: en mesa termina 3x más rápido que en el sitio (mismo verbo)", () => {
  const ahora = 1_000_000;
  const enSitio = iniciarDespiece(1, ID_JABALI, "despiezar", false, ahora);
  const enMesa = iniciarDespiece(1, ID_JABALI, "despiezar", true, ahora);
  const duracionSitio = enSitio.terminaEn - ahora;
  const duracionMesa = enMesa.terminaEn - ahora;
  assert.strictEqual(duracionSitio, duracionMesa * MULTIPLICADOR_TIEMPO_CAMPO);
});

test("despiezeListo: false antes de terminaEn, true justo al llegar o pasar", () => {
  const estado = iniciarDespiece(1, ID_JABALI, "desollar", true, 1000);
  assert.strictEqual(despiezeListo(estado, 999), false);
  assert.strictEqual(despiezeListo(estado, estado.terminaEn - 1), false);
  assert.strictEqual(despiezeListo(estado, estado.terminaEn), true);
  assert.strictEqual(despiezeListo(estado, estado.terminaEn + 999), true);
});

test("recolectarDespiece: despiezar en MESA da la cantidad COMPLETA (carne/tendones/tripas/grasa, grande)", () => {
  const estado = iniciarDespiece(1, ID_JABALI, "despiezar", true, 0);
  const r = recolectarDespiece(estado);
  assert.deepStrictEqual(r, {
    tendones: 3, tripas: 3, grasa: 4,
    carne: { itemId: "carne_caza_mayor", cantidad: 7 },
  });
});

test("recolectarDespiece: despiezar en el SITIO da la mitad (redondeado hacia abajo, nunca 0 si la base era > 0)", () => {
  const estado = iniciarDespiece(1, ID_JABALI, "despiezar", false, 0);
  const r = recolectarDespiece(estado);
  assert.deepStrictEqual(r, {
    tendones: 1, tripas: 1, grasa: 2, // 3*0.5=1.5->1, 3*0.5->1, 4*0.5=2
    carne: { itemId: "carne_caza_mayor", cantidad: 3 }, // 7*0.5=3.5->3
  });
  assert.strictEqual(FRACCION_MATERIAL_CAMPO, 0.5);
});

test("recolectarDespiece: desollar en mesa da la piel completa + tirada de trofeo independiente", () => {
  const estado = iniciarDespiece(1, ID_JABALI, "desollar", true, 0);
  const sinTrofeo = recolectarDespiece(estado, () => 0.99);
  assert.deepStrictEqual(sinTrofeo, { piel: { itemId: "cuero_grueso", cantidad: 3 } });
  const conTrofeo = recolectarDespiece(estado, () => 0);
  assert.deepStrictEqual(conTrofeo, { piel: { itemId: "cuero_grueso", cantidad: 3 }, trofeoItemId: "cabeza_trofeo_grande" });
});

test("recolectarDespiece: desollar en el sitio da la MITAD de piel — el trofeo NO cambia por campo/mesa (el streamer no lo pidió)", () => {
  const enSitio = iniciarDespiece(1, ID_JABALI, "desollar", false, 0);
  const r = recolectarDespiece(enSitio, () => 0);
  assert.deepStrictEqual(r, { piel: { itemId: "cuero_grueso", cantidad: 1 }, trofeoItemId: "cabeza_trofeo_grande" }); // 3*0.5=1.5->1
});

test("recolectarDespiece: especie sin piel (generico/sinpiel) desollar no da nada de piel, pero sigue pudiendo dar trofeo", () => {
  const sinPiel = "cadaver_generico_sinpiel_mediano";
  const estado = iniciarDespiece(1, sinPiel, "desollar", true, 0);
  const r = recolectarDespiece(estado, () => 0);
  assert.deepStrictEqual(r, { trofeoItemId: "cabeza_trofeo_mediana" });
});

test("recolectarDespiece: itemId de cadáver desconocido devuelve null (no revienta)", () => {
  const estado = iniciarDespiece(1, "cadaver_inventado_sin_dar_de_alta_alfa", "despiezar", true, 0);
  assert.strictEqual(recolectarDespiece(estado), null);
});
