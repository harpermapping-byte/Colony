"use strict";
// Test de INTEGRACIÓN de punta a punta: ciudad real (ciudades/) + las 3
// fases del poblador juntas, en los 6 tiers de asentamiento, con varias
// semillas — el "¿está todo bien?" de todo el sistema en una pasada.
// Ejecutar: node --test poblacion/test/integracion.test.js
const test = require("node:test");
const assert = require("node:assert");
const { cargarCatalogos: cargarCatalogosInteriores } = require("../../interiores/src/catalogo");
const { cargarCatalogos } = require("../src/catalogo");
const { exportarAsentamiento } = require("../src/exportarAsentamiento");

const catalogosPoblacion = cargarCatalogos();
const tiers = Object.keys(catalogosPoblacion.censo).filter((k) => !k.startsWith("_"));
const SEMILLAS = ["integracion-1", "integracion-2"];

test("los 6 tiers, con 2 semillas cada uno, generan un asentamiento completo sin errores", async () => {
  for (const tier of tiers) {
    for (const semilla of SEMILLAS) {
      const resultado = await exportarAsentamiento(tier, semilla, { apiKey: undefined });
      assert.ok(resultado.npcs.length > 0, `${tier}/${semilla}: censo vacío`);
    }
  }
});

test("cada NPC sale coherente de punta a punta: identidad, físico, ropa, ubicación y perfil social", async () => {
  const resultado = await exportarAsentamiento("pueblo", "integracion-3", { apiKey: undefined });
  for (const npc of resultado.npcs) {
    assert.ok(npc.nombre && npc.apellido, `${npc.slotId}: sin nombre`);
    assert.ok(npc.ficha?.morfologia?.sexo === "hombre" || npc.ficha.morfologia.sexo === "mujer", `${npc.slotId}: físico inválido`);
    assert.strictEqual(npc.ropa.length, npc.ficha.ropa.length, `${npc.slotId}: no salió vestido según su arquetipo`);
    assert.ok(npc.perfilSocial, `${npc.slotId}: sin perfil social`);
    // vivienda es opcional (déficit válido en v1, ver GDD) pero si la tiene, coherente
    if (npc.vivienda) assert.ok(npc.vivienda.edificioId && npc.vivienda.tipoEdificioId);
    if (npc.trabajo) assert.ok(npc.trabajo.edificioId && npc.trabajo.tipoEdificioId);
  }
});

test("determinismo de punta a punta: mismo tier+semilla+día = mismo resultado byte a byte", async () => {
  const a = await exportarAsentamiento("aldea", "integracion-4", { apiKey: undefined, dia: 2 });
  const b = await exportarAsentamiento("aldea", "integracion-4", { apiKey: undefined, dia: 2 });
  const { ciudad: ciudadA, ...restoA } = a;
  const { ciudad: ciudadB, ...restoB } = b;
  assert.deepStrictEqual(restoA, restoB);
});

test("nadie con vivienda vive por encima de la capacidad real de camas de su edificio (Fase 2 sigue intacta tras Fase 3)", async () => {
  const resultado = await exportarAsentamiento("pueblo", "integracion-5", { apiKey: undefined });
  const { contarCamas } = require("../src/asignarUbicacion");
  const edificiosPorId = new Map(resultado.ciudad.edificios.map((e) => [e.interior.id, e]));
  const porEdificio = new Map();
  for (const npc of resultado.npcs) {
    if (!npc.vivienda) continue;
    porEdificio.set(npc.vivienda.edificioId, (porEdificio.get(npc.vivienda.edificioId) ?? 0) + 1);
  }
  for (const [edificioId, ocupantes] of porEdificio) {
    assert.ok(ocupantes <= contarCamas(edificiosPorId.get(edificioId)));
  }
});

test("cobertura de rutinas: en un pueblo con herrería/taberna, la mayoría de adultos con trabajo consiguen camino bakeado hasta él", async () => {
  const resultado = await exportarAsentamiento("pueblo", "integracion-6", { apiKey: undefined });
  const conTrabajo = resultado.npcs.filter((n) => n.trabajo);
  assert.ok(conTrabajo.length > 0, "esta semilla debería dar al menos un NPC con trabajo");
  const conCamino = conTrabajo.filter((n) => n.rutina.some((t) => t.lugar === "trabajo" && t.camino?.length > 0));
  const cobertura = conCamino.length / conTrabajo.length;
  assert.ok(cobertura >= 0.8, `solo ${(cobertura * 100).toFixed(0)}% de los NPCs con trabajo consiguieron camino hasta él`);
});
