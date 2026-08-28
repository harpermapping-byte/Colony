"use strict";
// Tests de la Fase 1 del poblador (GDD_Poblacion_NPCs.md): censo,
// identidad, familia y vestido — SIN llamar a la IA real (generarHistoria
// se prueba aparte, con fetch inyectado). Ejecutar:
//   node --test poblacion/test/poblacion.test.js
const test = require("node:test");
const assert = require("node:assert");
const { cargarCatalogos } = require("../src/catalogo");
const { generarCenso } = require("../src/generarCenso");
const { exportarPoblacion } = require("../src/exportarPoblacion");

const catalogos = cargarCatalogos();
const tiers = Object.keys(catalogos.censo).filter((k) => !k.startsWith("_"));

test("generarCenso: determinista (mismo tier+semilla = mismo censo)", () => {
  for (const tier of tiers) {
    const a = generarCenso(tier, "semilla-test", catalogos);
    const b = generarCenso(tier, "semilla-test", catalogos);
    assert.deepStrictEqual(a, b);
  }
});

test("generarCenso: todos los tiers producen al menos un slot", () => {
  for (const tier of tiers) {
    const slots = generarCenso(tier, "semilla-test", catalogos);
    assert.ok(slots.length > 0, `${tier}: censo vacío`);
  }
});

test("generarCenso: una unidad familiar es cabeza + cónyuge (+ 0-2 hijos), todos con el mismo familiaId", () => {
  const slots = generarCenso("aldea", "semilla-familias", catalogos);
  const porFamilia = new Map();
  for (const s of slots) {
    if (!s.familiaId) continue;
    if (!porFamilia.has(s.familiaId)) porFamilia.set(s.familiaId, []);
    porFamilia.get(s.familiaId).push(s);
  }
  assert.ok(porFamilia.size > 0, "no se generó ninguna familia con esta semilla");
  for (const [familiaId, miembros] of porFamilia) {
    const roles = miembros.map((m) => m.rolFamiliar).sort();
    assert.strictEqual(roles.filter((r) => r === "cabeza").length, 1, `${familiaId}: no tiene exactamente 1 cabeza`);
    assert.strictEqual(roles.filter((r) => r === "conyuge").length, 1, `${familiaId}: no tiene exactamente 1 cónyuge`);
    const hijos = roles.filter((r) => r === "hijo").length;
    assert.ok(hijos >= 0 && hijos <= 2, `${familiaId}: ${hijos} hijos fuera de rango`);
  }
});

test("exportarPoblacion: determinista de punta a punta (censo+identidad+físico+ropa), sin IA (sin apiKey)", async () => {
  const a = await exportarPoblacion("aldea_pequena", "semilla-export", { apiKey: undefined });
  const b = await exportarPoblacion("aldea_pequena", "semilla-export", { apiKey: undefined });
  assert.deepStrictEqual(a, b);
  assert.ok(a.npcs.length > 0);
  for (const npc of a.npcs) {
    assert.strictEqual(npc.historia, null); // sin GEMINI_API_KEY, no hay biografía
    assert.ok(npc.nombre && npc.apellido);
    assert.ok(npc.ficha.sexo === "hombre" || npc.ficha.sexo === "mujer");
  }
});

test("exportarPoblacion: cónyuge de sexo opuesto al cabeza, mismo apellido en toda la familia", async () => {
  const resultado = await exportarPoblacion("aldea", "semilla-conyuges", { apiKey: undefined });
  const porFamilia = new Map();
  for (const npc of resultado.npcs) {
    if (!npc.familiaId) continue;
    if (!porFamilia.has(npc.familiaId)) porFamilia.set(npc.familiaId, []);
    porFamilia.get(npc.familiaId).push(npc);
  }
  assert.ok(porFamilia.size > 0, "no se generó ninguna familia con esta semilla");
  for (const [familiaId, miembros] of porFamilia) {
    const apellidos = new Set(miembros.map((m) => m.apellido));
    assert.strictEqual(apellidos.size, 1, `${familiaId}: apellidos distintos dentro de la misma familia`);
    const cabeza = miembros.find((m) => m.rolFamiliar === "cabeza");
    const conyuge = miembros.find((m) => m.rolFamiliar === "conyuge");
    assert.notStrictEqual(cabeza.ficha.sexo, conyuge.ficha.sexo, `${familiaId}: cabeza y cónyuge del mismo sexo`);
  }
});

test("exportarPoblacion: los hijos salen a escala reducida frente a un adulto", async () => {
  const resultado = await exportarPoblacion("aldea", "semilla-hijos", { apiKey: undefined });
  const hijos = resultado.npcs.filter((n) => n.rolFamiliar === "hijo");
  const adultosAldeano = resultado.npcs.filter((n) => n.ficha.npcId === "aldeano" && n.rolFamiliar !== "hijo");
  if (hijos.length === 0 || adultosAldeano.length === 0) return; // semilla sin hijos: nada que comprobar
  const alturaMediaHijos = hijos.reduce((s, n) => s + n.ficha.morfologia.altura, 0) / hijos.length;
  const alturaMediaAdultos = adultosAldeano.reduce((s, n) => s + n.ficha.morfologia.altura, 0) / adultosAldeano.length;
  assert.ok(alturaMediaHijos < alturaMediaAdultos, "los hijos no salen más bajos que los adultos");
});

test("exportarPoblacion: cada NPC sale vestido según la ropa de su arquetipo", async () => {
  const resultado = await exportarPoblacion("aldea_pequena", "semilla-ropa", { apiKey: undefined });
  for (const npc of resultado.npcs) {
    assert.strictEqual(npc.ropa.length, npc.ficha.ropa.length);
    for (const prenda of npc.ropa) {
      assert.ok(prenda.voxeles.length > 0, `${npc.nombre}: prenda "${prenda.prendaId}" sin vóxeles`);
    }
  }
});
