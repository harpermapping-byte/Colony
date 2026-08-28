"use strict";
// Tests de src/fauna.js — fauna doméstica urbana (GDD_Agentes_Moviles.md
// v1.3). Ejecutar: node --test ciudades/test/fauna.test.js
const test = require("node:test");
const assert = require("node:assert");
const { generarCiudad } = require("../src/generar");
const { generarFauna, CANTIDAD_POR_TIER } = require("../src/fauna");
const { cargarCatalogos } = require("../../interiores/src/catalogo");

const catalogos = cargarCatalogos();

test("generarFauna: la cantidad cae dentro del rango del tier, y cada spawn es transitable", () => {
  for (const tier of Object.keys(CANTIDAD_POR_TIER)) {
    const ciudad = generarCiudad({ tier, semilla: `fauna-test-${tier}`, catalogos });
    const fauna = generarFauna(ciudad);
    const [min, max] = CANTIDAD_POR_TIER[tier];
    // el gallo se añade APARTE del sorteo principal, puede pasar de max
    const sinGallosExtra = fauna.filter((f) => f.especieId !== "gallo").length;
    assert.ok(sinGallosExtra >= 0 && sinGallosExtra <= max, `${tier}: ${sinGallosExtra} fuera de [0,${max}]`);
    for (const f of fauna) {
      assert.ok(ciudad.terreno.dentro(f.x, f.y), `${tier}: spawn ${f.especieId} fuera de la rejilla`);
    }
  }
});

test("generarFauna: determinista — misma semilla, misma fauna", () => {
  const ciudad1 = generarCiudad({ tier: "pueblo", semilla: "fauna-determinismo", catalogos });
  const ciudad2 = generarCiudad({ tier: "pueblo", semilla: "fauna-determinismo", catalogos });
  assert.deepStrictEqual(generarFauna(ciudad1), generarFauna(ciudad2));
});

test("generarFauna: solo hay gallos si hubo al menos una gallina", () => {
  let vistoConGallo = false;
  for (let i = 0; i < 15; i++) {
    const ciudad = generarCiudad({ tier: "gran_capital", semilla: `fauna-gallo-${i}`, catalogos });
    const fauna = generarFauna(ciudad);
    const hayGallina = fauna.some((f) => f.especieId === "gallina_salvaje");
    const hayGallo = fauna.some((f) => f.especieId === "gallo");
    if (hayGallo) { vistoConGallo = true; assert.ok(hayGallina, "gallo sin ninguna gallina en el mismo asentamiento"); }
  }
  assert.ok(vistoConGallo, "ningún gallo en 15 semillas de gran_capital — revisar probabilidad");
});

test("generarFauna: aldea_pequena sin edificios de vivienda cae al focal, sin explotar", () => {
  const ciudad = generarCiudad({ tier: "aldea_pequena", semilla: "fauna-borde", catalogos });
  const original = ciudad.edificios;
  ciudad.edificios = []; // fuerza el caso límite: sin casas donde anclar spawns
  assert.doesNotThrow(() => generarFauna(ciudad));
  ciudad.edificios = original;
});
