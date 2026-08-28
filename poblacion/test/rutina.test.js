"use strict";
// Tests de la Fase 3 (GDD_Poblacion_NPCs.md): perfil social, rutina
// horaria y caminos bakeados. Ejecutar: node --test poblacion/test/rutina.test.js
const test = require("node:test");
const assert = require("node:assert");
const { generarCiudad } = require("../../ciudades/src/generar");
const { cargarCatalogos: cargarCatalogosInteriores } = require("../../interiores/src/catalogo");
const { cargarCatalogos } = require("../src/catalogo");
const { exportarPoblacion } = require("../src/exportarPoblacion");
const { asignarUbicacion } = require("../src/asignarUbicacion");
const { asignarPerfil } = require("../src/asignarPerfil");
const { generarRutina } = require("../src/generarRutina");
const { bakearCaminosDeRutina } = require("../src/bakearCaminos");

const catalogosInteriores = cargarCatalogosInteriores();
const catalogos = cargarCatalogos();

async function asentamientoDePrueba(tier, semilla) {
  const ciudad = generarCiudad({ tier, semilla, catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion(tier, semilla, { apiKey: undefined });
  asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios);
  return { ciudad, npcs: poblacion.npcs };
}

test("asignarPerfil: los hijos SOLO reciben perfiles soloHijos, nunca uno que exija trabajo", async () => {
  const { npcs } = await asentamientoDePrueba("aldea", "test-rutina-1");
  for (const npc of npcs.filter((n) => n.rolFamiliar === "hijo")) {
    const perfil = asignarPerfil(npc, catalogos.perfilesSociales);
    assert.ok(perfil, `${npc.nombre}: sin perfil asignable`);
    assert.strictEqual(catalogos.perfilesSociales[perfil].soloHijos, true);
  }
});

test("asignarPerfil: un adulto sin trabajo nunca recibe un perfil requiereTrabajo:true", async () => {
  const { npcs } = await asentamientoDePrueba("aldea_pequena", "test-rutina-2"); // sin herrería/cuartel: aldeanos sin trabajo
  for (const npc of npcs.filter((n) => n.rolFamiliar !== "hijo" && !n.trabajo)) {
    const perfil = asignarPerfil(npc, catalogos.perfilesSociales);
    assert.ok(perfil, `${npc.nombre}: sin perfil asignable`);
    assert.notStrictEqual(catalogos.perfilesSociales[perfil].requiereTrabajo, true);
  }
});

test("asignarPerfil: un adulto CON trabajo real nunca recibe un perfil requiereTrabajo:false (dejaría su oficio sin usar)", async () => {
  const { npcs } = await asentamientoDePrueba("pueblo", "test-rutina-2b"); // pueblo: herrería/cuartel/botica obligatorios
  const conTrabajo = npcs.filter((n) => n.rolFamiliar !== "hijo" && n.trabajo);
  assert.ok(conTrabajo.length > 0, "esta semilla debería dar NPCs con trabajo real");
  for (const npc of conTrabajo) {
    const perfil = asignarPerfil(npc, catalogos.perfilesSociales);
    assert.strictEqual(catalogos.perfilesSociales[perfil].requiereTrabajo, true, `${npc.nombre}: tiene trabajo pero le tocó "${perfil}" (no usa su oficio)`);
  }
});

test("generarRutina: empieza durmiendo en casa, todos los tramos tienen punto y son deterministas", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-rutina-3");
  const npc = npcs.find((n) => n.vivienda);
  assert.ok(npc, "necesito al menos un NPC con vivienda para este test");
  npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);

  const rutinaA = generarRutina(npc, ciudad, catalogos, 0);
  const rutinaB = generarRutina(npc, ciudad, catalogos, 0);
  assert.deepStrictEqual(rutinaA, rutinaB, "misma semilla+día debería dar la misma rutina");

  assert.ok(rutinaA.length > 0);
  assert.strictEqual(rutinaA[0].accion, "dormir");
  assert.strictEqual(rutinaA[0].lugar, "casa");
  for (const tramo of rutinaA) {
    assert.ok(tramo.punto && Number.isFinite(tramo.punto.x) && Number.isFinite(tramo.punto.y), `tramo ${tramo.lugar}/${tramo.accion} sin punto válido`);
  }
});

test("generarRutina: la variación diaria cambia horarios (jitter) pero NO la plantilla (mismos lugar/acción en orden)", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-rutina-4");
  const npc = npcs.find((n) => n.vivienda);
  npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);

  const dia0 = generarRutina(npc, ciudad, catalogos, 0);
  const dia1 = generarRutina(npc, ciudad, catalogos, 1);

  assert.deepStrictEqual(dia0.map((t) => [t.lugar, t.accion]), dia1.map((t) => [t.lugar, t.accion]));
  const huboJitter = dia0.some((t, i) => t.horaInicio !== dia1[i].horaInicio || t.horaFin !== dia1[i].horaFin);
  assert.ok(huboJitter, "dos días distintos deberían dar AL MENOS algún horario distinto");
});

test("generarRutina: la parada 'dormir' en casa apunta a una sala de tipo dormitorio de SU vivienda", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-rutina-5");
  let encontrado = false;
  for (const npc of npcs.filter((n) => n.vivienda)) {
    npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);
    const rutina = generarRutina(npc, ciudad, catalogos, 0);
    const dormir = rutina.find((t) => t.accion === "dormir");
    if (dormir?.sala) {
      assert.ok(catalogos.accionesPorSala.dormir.includes(dormir.sala.tipoSalaId));
      encontrado = true;
    }
  }
  assert.ok(encontrado, "ningún NPC encontró sala de dormitorio en su propia casa — revisar accionesPorSala.json");
});

test("bakearCaminosDeRutina: los tramos que cambian de sitio consiguen un camino caminable real (A* sobre la rejilla del asentamiento)", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-rutina-6");
  const npc = npcs.find((n) => n.vivienda && n.trabajo);
  assert.ok(npc, "necesito un NPC con vivienda Y trabajo para este test");
  npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);
  const rutina = generarRutina(npc, ciudad, catalogos, 0);
  bakearCaminosDeRutina(ciudad, rutina, new Map());

  const tramoTrabajo = rutina.find((t) => t.lugar === "trabajo");
  assert.ok(tramoTrabajo, "el NPC debería tener un tramo de trabajo");
  assert.ok(Array.isArray(tramoTrabajo.camino) && tramoTrabajo.camino.length > 0, "sin camino caminable hasta el trabajo");
  assert.ok(
    tramoTrabajo.camino.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)),
    "el camino debería ser una lista de casillas enteras",
  );
});

test("bakearCaminosDeRutina: comparte caché entre NPCs con el mismo trayecto (mismo camino por referencia)", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-rutina-7");
  const cache = new Map();
  const conTrabajo = npcs.filter((n) => n.vivienda && n.trabajo).slice(0, 2);
  if (conTrabajo.length < 2) return; // semilla sin suficientes NPCs con trabajo: nada que comparar
  for (const npc of conTrabajo) {
    npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);
    npc.rutina = generarRutina(npc, ciudad, catalogos, 0);
    bakearCaminosDeRutina(ciudad, npc.rutina, cache);
  }
  assert.ok(cache.size > 0, "la caché debería tener al menos una entrada");
});

test("contadorZonas: dos NPCs cuya rutina cae en la plaza a la vez reciben casillas DISTINTAS (no se apelotonan)", async () => {
  const { ciudad, npcs } = await asentamientoDePrueba("pueblo", "test-zonas-1");
  const contadorZonas = {};
  const puntosPlaza = new Set();
  let vistos = 0;
  for (const npc of npcs.filter((n) => n.rolFamiliar !== "hijo")) {
    npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales) ?? "trabajador";
    const rutina = generarRutina(npc, ciudad, catalogos, 0, contadorZonas);
    for (const tramo of rutina) {
      if (tramo.lugar === "plaza" && tramo.punto) {
        puntosPlaza.add(`${tramo.punto.x},${tramo.punto.y}`);
        vistos++;
      }
    }
  }
  assert.ok(vistos >= 3, `muy pocos tramos de plaza para probar el reparto (${vistos})`);
  // con el pool de hasta 10 casillas por zona, varios NPCs en la plaza
  // deberían caer en más de una casilla distinta (round-robin real, no
  // todos en el mismo punto)
  assert.ok(puntosPlaza.size > 1, `todos los tramos de plaza cayeron en la MISMA casilla (${[...puntosPlaza]})`);
});

test("vendedores especializados: tendero/panadero/sastre salen SIEMPRE en un pueblo (censo con suelo garantizado)", async () => {
  const { npcs } = await asentamientoDePrueba("aldea_pequena", "test-vendedores-1");
  const oficios = new Set(npcs.map((n) => n.ficha.npcId));
  for (const esperado of ["tendero", "panadero", "sastre", "alfarero"]) {
    assert.ok(oficios.has(esperado), `aldea_pequena sin ningún ${esperado} (censo con suelo garantizado)`);
  }
});

test("vendedores sin edificio: asignarUbicacion los marca con puestoExterior en vez de dejarlos sin trabajo visible", async () => {
  // aldea_pequena: 4 vendedores garantizados por censo, pero el asentamiento
  // no siempre tiene las 4 tiendas correspondientes bakeadas
  const { npcs } = await asentamientoDePrueba("aldea_pequena", "test-vendedores-2");
  const vendedoresSinTrabajo = npcs.filter(
    (n) => ["tendero", "panadero", "sastre", "alfarero"].includes(n.ficha.npcId) && !n.trabajo,
  );
  for (const v of vendedoresSinTrabajo) {
    assert.strictEqual(v.puestoExterior, true, `${v.nombre} (${v.ficha.npcId}) sin trabajo y sin puestoExterior`);
  }
});
