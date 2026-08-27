"use strict";
// Tests del bakeador de ciudades — node --test ciudades/test/ciudad.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { generarCiudad, validarCiudad, cargarAsentamientos } = require("../src/generar");
const { hornearCiudad, TAMANO_CHUNK } = require("../src/index");
const { cargarCatalogos } = require("../../interiores/src/catalogo");

const catalogos = cargarCatalogos();
const asentamientos = cargarAsentamientos();
const tiers = Object.keys(asentamientos).filter((k) => !k.startsWith("_"));

test("todos los tiers generan una ciudad VÁLIDA (estanca, conectada, sin solapes)", () => {
  for (const tier of tiers) {
    const ciudad = generarCiudad({ tier, semilla: "test-1", catalogos });
    const errores = validarCiudad(ciudad);
    assert.deepStrictEqual(errores, [], `${tier}: ${errores.join(" | ")}`);
    const [minEd] = asentamientos[tier].edificios.cantidad;
    assert.ok(ciudad.edificios.length >= Math.min(minEd, 3), `${tier}: solo ${ciudad.edificios.length} edificios`);
  }
});

test("los edificios obligatorios del tier siempre encuentran sitio", () => {
  for (const tier of tiers) {
    const ciudad = generarCiudad({ tier, semilla: "test-obligatorios", catalogos });
    const puestos = new Set(ciudad.edificios.map((e) => e.tipoEdificioId));
    for (const ob of asentamientos[tier].edificios.obligatorios || []) {
      assert.ok(puestos.has(ob), `${tier}: falta el obligatorio ${ob} (descartados: ${ciudad.descartados})`);
    }
  }
});

test("determinismo: mismo tier+semilla = misma ciudad; semillas distintas difieren", () => {
  const a = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  const b = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  assert.deepStrictEqual(a.terreno.datos, b.terreno.datos);
  assert.deepStrictEqual(a.portales, b.portales);
  const c = generarCiudad({ tier: "aldea", semilla: "s2", catalogos });
  assert.notDeepStrictEqual(a.terreno.datos, c.terreno.datos);
});

test("la huella de cada edificio es su interior real + muro (bake anidado)", () => {
  const ciudad = generarCiudad({ tier: "aldea_pequena", semilla: "test-1", catalogos });
  for (const ed of ciudad.edificios) {
    const baja = ed.interior.plantas.find((p) => p.nivel === 0) || ed.interior.plantas[0];
    assert.strictEqual(ed.w, baja.ancho + 2, ed.tipoEdificioId);
    assert.strictEqual(ed.h, baja.alto + 2, ed.tipoEdificioId);
  }
});

test("el export completo es legible y cuadra con el formato de sectores del baker", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-test-"));
  const ciudad = hornearCiudad("aldea_pequena", "test-export", carpeta);
  const indice = JSON.parse(fs.readFileSync(path.join(carpeta, "indice.json"), "utf8"));
  assert.strictEqual(indice.tamanoChunk, TAMANO_CHUNK);
  assert.ok(indice.portales.some((p) => p.tipo === "exterior"), "portal de salida al exterior");
  assert.strictEqual(
    indice.portales.filter((p) => p.tipo === "interior").length,
    ciudad.edificios.length,
    "un portal interior por edificio",
  );
  // el spawn (indice.ciudad) cae en terreno transitable
  const sector = JSON.parse(fs.readFileSync(path.join(carpeta, "sector_000_000.json"), "utf8"));
  const cx = Math.floor(indice.ciudad.x / TAMANO_CHUNK), cy = Math.floor(indice.ciudad.y / TAMANO_CHUNK);
  const chunk = sector.chunks[`${cx}_${cy}`];
  assert.ok(chunk, "el chunk del spawn existe");
  const lx = indice.ciudad.x - cx * TAMANO_CHUNK, ly = indice.ciudad.y - cy * TAMANO_CHUNK;
  const id = indice.leyendaTerreno[parseInt(chunk.terreno[ly * TAMANO_CHUNK + lx], 36)];
  assert.ok(["camino", "adoquin", "cesped"].includes(id), `spawn sobre ${id}`);
  // cada chunk trae terreno y elevación del tamaño exacto
  for (const ch of Object.values(sector.chunks)) {
    assert.strictEqual(ch.terreno.length, TAMANO_CHUNK * TAMANO_CHUNK);
    assert.strictEqual(ch.elevacion.length, TAMANO_CHUNK * TAMANO_CHUNK);
  }
  // los interiores del bake anidado existen como archivos
  const interiores = fs.readdirSync(path.join(carpeta, "interiores"));
  assert.strictEqual(interiores.length, ciudad.edificios.length);
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test("los terrenos urbanos existen en el catálogo del baker con su transitabilidad", () => {
  const terrenos = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "baker", "catalogo", "terrenos.json"), "utf8"));
  assert.strictEqual(terrenos.adoquin.transitable, true);
  assert.strictEqual(terrenos.muralla_piedra.transitable, false);
  assert.strictEqual(terrenos.empalizada.transitable, false);
  assert.strictEqual(terrenos.solar_edificio.transitable, false);
});
