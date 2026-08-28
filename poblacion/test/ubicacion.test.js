"use strict";
// Tests de la Fase 2 del poblador (GDD_Poblacion_NPCs.md): vivienda y
// trabajo sobre un asentamiento REAL bakeado por ciudades/. Ejecutar:
//   node --test poblacion/test/ubicacion.test.js
const test = require("node:test");
const assert = require("node:assert");
const { generarCiudad } = require("../../ciudades/src/generar");
const { cargarCatalogos: cargarCatalogosInteriores } = require("../../interiores/src/catalogo");
const { cargarCatalogos } = require("../src/catalogo");
const { exportarPoblacion } = require("../src/exportarPoblacion");
const { asignarUbicacion, contarCamas, capacidadTrabajo } = require("../src/asignarUbicacion");

const catalogosInteriores = cargarCatalogosInteriores();
const catalogos = cargarCatalogos();

test("capacidadTrabajo: taberna/posada/templo/tienda/panaderia usan piezas reales (mostrador/altar/horno_pan), no solo la huella", () => {
  const objetivo = new Set(["taberna", "posada", "templo", "tienda", "panaderia"]);
  const vistos = new Set();
  for (const semilla of ["cap-1", "cap-2", "cap-3", "cap-4", "cap-5", "cap-6", "cap-7", "cap-8"]) {
    const ciudad = generarCiudad({ tier: "gran_capital", semilla, catalogos: catalogosInteriores });
    for (const ed of ciudad.edificios) {
      if (!objetivo.has(ed.tipoEdificioId) || vistos.has(ed.tipoEdificioId)) continue;
      const piezasReales = (ed.interior?.plantas ?? []).some((p) =>
        (p.salas ?? []).some((s) => (s.resultado?.colocados ?? []).some((c) => catalogosInteriores.elementos[c.id]?.temasProfesion)),
      );
      // mostrador/altar son isMandatory: si el edificio tiene la sala temática, siempre hay pieza real.
      if (["taberna", "posada", "templo", "tienda"].includes(ed.tipoEdificioId)) {
        assert.ok(piezasReales, `${ed.tipoEdificioId}: sin pieza temática (mostrador/altar) — revisar temaTaller/temasProfesion`);
      }
      vistos.add(ed.tipoEdificioId);
    }
  }
  assert.ok(vistos.size >= 4, `solo se encontraron ${vistos.size}/5 tipos de edificio en 8 semillas de gran_capital`);
});

test("contarCamas: suma plazas de todas las salas/plantas de un edificio real", () => {
  const ciudad = generarCiudad({ tier: "aldea", semilla: "test-ubicacion-1", catalogos: catalogosInteriores });
  const casas = ciudad.edificios.filter((e) => e.tipoEdificioId.startsWith("casa_"));
  assert.ok(casas.length > 0, "la aldea de prueba debería tener casas");
  for (const casa of casas) {
    assert.ok(contarCamas(casa) >= 0);
  }
  assert.ok(casas.some((c) => contarCamas(c) > 0), "al menos una casa debería tener camas");
});

test("asignarUbicacion: nadie vive en una casa por encima de su capacidad de camas", async () => {
  const ciudad = generarCiudad({ tier: "pueblo", semilla: "test-ubicacion-2", catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion("pueblo", "test-ubicacion-2", { apiKey: undefined });
  asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios);

  const porEdificio = new Map();
  for (const npc of poblacion.npcs) {
    if (!npc.vivienda) continue;
    porEdificio.set(npc.vivienda.edificioId, (porEdificio.get(npc.vivienda.edificioId) ?? 0) + 1);
  }
  const edificiosPorId = new Map(ciudad.edificios.map((e) => [e.interior.id, e]));
  for (const [edificioId, ocupantes] of porEdificio) {
    const capacidad = contarCamas(edificiosPorId.get(edificioId));
    assert.ok(ocupantes <= capacidad, `${edificioId}: ${ocupantes} ocupantes > ${capacidad} camas`);
  }
});

test("asignarUbicacion: una familia entera vive en la MISMA vivienda", async () => {
  const ciudad = generarCiudad({ tier: "pueblo", semilla: "test-ubicacion-3", catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion("pueblo", "test-ubicacion-3", { apiKey: undefined });
  asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios);

  const porFamilia = new Map();
  for (const npc of poblacion.npcs) {
    if (!npc.familiaId) continue;
    if (!porFamilia.has(npc.familiaId)) porFamilia.set(npc.familiaId, []);
    porFamilia.get(npc.familiaId).push(npc);
  }
  for (const [familiaId, miembros] of porFamilia) {
    const conVivienda = miembros.filter((m) => m.vivienda);
    if (conVivienda.length === 0) continue; // asentamiento sin hueco para esta familia: caso de déficit, no de reparto
    const edificios = new Set(conVivienda.map((m) => m.vivienda.edificioId));
    assert.strictEqual(edificios.size, 1, `${familiaId}: repartida en ${edificios.size} viviendas distintas`);
    assert.strictEqual(conVivienda.length, miembros.length, `${familiaId}: no toda la familia consiguió vivienda`);
  }
});

test("asignarUbicacion: el herrero trabaja en LA herrería si el pueblo tiene una, nunca por encima de su capacidad", async () => {
  const ciudad = generarCiudad({ tier: "pueblo", semilla: "test-ubicacion-4", catalogos: catalogosInteriores });
  const tieneHerreria = ciudad.edificios.some((e) => e.tipoEdificioId === "herreria");
  const poblacion = await exportarPoblacion("pueblo", "test-ubicacion-4", { apiKey: undefined });
  asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios);

  const herreros = poblacion.npcs.filter((n) => n.ficha.npcId === "herrero");
  if (tieneHerreria) {
    for (const h of herreros) {
      assert.ok(h.trabajo, `${h.nombre}: herrero sin trabajo asignado pese a haber herrería`);
      assert.strictEqual(h.trabajo.tipoEdificioId, "herreria");
    }
  }
  const porEdificioTrabajo = new Map();
  for (const npc of poblacion.npcs) {
    if (!npc.trabajo) continue;
    porEdificioTrabajo.set(npc.trabajo.edificioId, (porEdificioTrabajo.get(npc.trabajo.edificioId) ?? 0) + 1);
  }
  const edificiosPorId = new Map(ciudad.edificios.map((e) => [e.interior.id, e]));
  for (const [edificioId, ocupantes] of porEdificioTrabajo) {
    assert.ok(ocupantes <= capacidadTrabajo(edificiosPorId.get(edificioId)), `${edificioId}: más trabajadores que capacidad`);
  }
});

test("asignarUbicacion: los hijos nunca reciben trabajo", async () => {
  const ciudad = generarCiudad({ tier: "aldea", semilla: "test-ubicacion-5", catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion("aldea", "test-ubicacion-5", { apiKey: undefined });
  asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios);
  for (const npc of poblacion.npcs.filter((n) => n.rolFamiliar === "hijo")) {
    assert.strictEqual(npc.trabajo, undefined, `${npc.nombre}: hijo con trabajo asignado`);
  }
});
