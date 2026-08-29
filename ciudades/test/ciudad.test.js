"use strict";
// Tests del bakeador ORGÁNICO de ciudades — node --test ciudades/test/ciudad.test.js
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

test("todos los tiers generan ciudades VÁLIDAS (estancas, conectadas, sin solapes) con 2 semillas", () => {
  for (const tier of tiers) {
    for (const semilla of ["test-1", "test-2"]) {
      const ciudad = generarCiudad({ tier, semilla, catalogos });
      const errores = validarCiudad(ciudad);
      assert.deepStrictEqual(errores, [], `${tier}/${semilla}: ${errores.join(" | ")}`);
      assert.ok(ciudad.puertas.length >= 1, `${tier}: sin puertas de muralla`);
      assert.ok(ciudad.modulosMuralla.some((m) => m.tipo === "torre"), `${tier}: sin torres`);
      assert.ok(ciudad.modulosMuralla.some((m) => m.tipo === "puerta"), `${tier}: sin módulo puerta`);
    }
  }
});

test("los edificios OBLIGATORIOS del tier siempre encuentran sitio", () => {
  for (const tier of tiers) {
    const ciudad = generarCiudad({ tier, semilla: "test-1", catalogos });
    const puestos = new Set(ciudad.edificios.map((e) => e.tipoEdificioId));
    for (const ob of asentamientos[tier].edificios.obligatorios || []) {
      assert.ok(puestos.has(ob), `${tier}: falta el obligatorio ${ob}`);
    }
  }
});

test("determinismo: mismo tier+semilla = misma ciudad; semillas distintas difieren", () => {
  const a = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  const b = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  assert.deepStrictEqual(a.terreno.datos, b.terreno.datos);
  assert.deepStrictEqual(a.portales, b.portales);
  assert.deepStrictEqual(a.modulosMuralla, b.modulosMuralla);
  const c = generarCiudad({ tier: "aldea", semilla: "s2", catalogos });
  assert.notDeepStrictEqual(a.terreno.datos, c.terreno.datos);
});

test("cada edificio va ROTADO hacia una calle y su huella sale de huellas.json", () => {
  const huellas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "huellas.json"), "utf8"));
  const ciudad = generarCiudad({ tier: "pueblo", semilla: "test-1", catalogos });
  assert.ok(ciudad.edificios.length >= 8, `pocos edificios: ${ciudad.edificios.length}`);
  let rotados = 0;
  for (const ed of ciudad.edificios) {
    const esperada = huellas.porTipo[ed.tipoEdificioId] ||
      huellas.porRiqueza[catalogos.tiposEdificio[ed.tipoEdificioId]?.riqueza || "modesta"];
    // el jitter de variedad mueve la huella ±1 por instancia
    assert.ok(Math.abs(ed.w - esperada[0]) <= 1 && Math.abs(ed.h - esperada[1]) <= 1,
      `${ed.tipoEdificioId}: huella ${ed.w}x${ed.h} vs base ${esperada}`);
    assert.ok(ed.casillas.length > 0, "huella rasterizada");
    assert.ok(ed.interior.plantas.length > 0, "interior anidado generado");
    if (ed.rot % 90 !== 0) rotados++;
  }
  assert.ok(rotados > 0, "ningún edificio con rotación orgánica (todos alineados a los ejes)");
});

test("la muralla es un polígono IRREGULAR (no un círculo perfecto ni un rectángulo)", () => {
  const ciudad = generarCiudad({ tier: "capital", semilla: "test-1", catalogos });
  const radios = ciudad.poligonoMuralla.map((p) => Math.hypot(p.x - ciudad.focal.x, p.y - ciudad.focal.y));
  const min = Math.min(...radios), max = Math.max(...radios);
  assert.ok(max / min > 1.08, `polígono demasiado regular (max/min=${(max / min).toFixed(3)})`);
});

test("el export completo cuadra con el formato de sectores + capa vectorial", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-test-"));
  const ciudad = hornearCiudad("aldea_pequena", "test-export", carpeta);
  const indice = JSON.parse(fs.readFileSync(path.join(carpeta, "indice.json"), "utf8"));
  assert.strictEqual(indice.tamanoChunk, TAMANO_CHUNK);
  assert.ok(indice.portales.some((p) => p.tipo === "exterior"));
  assert.strictEqual(indice.portales.filter((p) => p.tipo === "interior").length, ciudad.edificios.length);
  assert.ok(indice.muralla.modulos.length > 0, "módulos de muralla en la capa vectorial");
  assert.ok(indice.caminos.length >= 1, "polilíneas de caminos");
  assert.ok(Array.isArray(indice.zonasVerdes), "zonas verdes en el índice");
  // el spawn cae en casilla transitable
  const cx = Math.floor(indice.ciudad.x / TAMANO_CHUNK), cy = Math.floor(indice.ciudad.y / TAMANO_CHUNK);
  const sx = Math.floor(cx / indice.tamanoSectorChunks), sy = Math.floor(cy / indice.tamanoSectorChunks);
  const sector = JSON.parse(fs.readFileSync(path.join(carpeta, `sector_${String(sx).padStart(3, "0")}_${String(sy).padStart(3, "0")}.json`), "utf8"));
  const chunk = sector.chunks[`${cx}_${cy}`];
  const lx = indice.ciudad.x - cx * TAMANO_CHUNK, ly = indice.ciudad.y - cy * TAMANO_CHUNK;
  const id = indice.leyendaTerreno[parseInt(chunk.terreno[ly * TAMANO_CHUNK + lx], 36)];
  assert.ok(["camino", "adoquin", "cesped", "tierra"].includes(id), `spawn sobre ${id}`);
  assert.strictEqual(chunk.elevacion.length, TAMANO_CHUNK * TAMANO_CHUNK, "elevación por casilla");
  assert.strictEqual(fs.readdirSync(path.join(carpeta, "interiores")).length, ciudad.edificios.length);
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test("determinismo del export completo: dos bakes de la misma semilla dan los MISMOS sector_*.json byte a byte (incluida `va` de cada edificio)", () => {
  // Regresión de un bug reportado por el usuario: al rebakear dos veces la
  // misma ciudad, la `va` (variante de placeholder) de algunos edificios
  // cambiaba entre bake y bake pese a que el resto de campos (w,h,dx,dy,x,y,ro)
  // eran idénticos. La causa real resultó ser dos bakes corridos a caballo de
  // un commit que cambió cómo se calcula `va` (de fijo 0 a hash de semilla),
  // no una fuente de aleatoriedad no determinista en el código actual — pero
  // el caso merece guardia permanente: mismo tier+semilla SIEMPRE debe
  // exportar los mismos ficheros, sin importar cuántas veces se hornee.
  const carpetaA = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-det-a-"));
  const carpetaB = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-det-b-"));
  hornearCiudad("pueblo", "det-repro", carpetaA);
  hornearCiudad("pueblo", "det-repro", carpetaB);

  const archivosSector = fs.readdirSync(carpetaA).filter((f) => f.startsWith("sector_") && f.endsWith(".json"));
  assert.ok(archivosSector.length > 0, "el bake no exportó ningún sector");

  const vasDe = (carpeta) => {
    const vas = [];
    for (const archivo of archivosSector.sort()) {
      const sector = JSON.parse(fs.readFileSync(path.join(carpeta, archivo), "utf8"));
      for (const clave of Object.keys(sector.chunks).sort()) {
        for (const obj of sector.chunks[clave].objetos || [])
          if (obj.t === "e") vas.push(`${archivo}:${clave}:${obj.i}@${obj.x},${obj.y} -> va:${obj.va}`);
      }
    }
    return vas;
  };
  assert.deepStrictEqual(vasDe(carpetaA), vasDe(carpetaB), "la variante `va` de algún edificio cambió entre dos bakes idénticos");

  // guardia más amplia: el export entero (sectores + indice) es idéntico byte a byte
  for (const archivo of [...archivosSector, "indice.json"]) {
    const a = fs.readFileSync(path.join(carpetaA, archivo), "utf8");
    const b = fs.readFileSync(path.join(carpetaB, archivo), "utf8");
    assert.strictEqual(a, b, `${archivo} difiere entre dos bakes de la misma semilla`);
  }

  fs.rmSync(carpetaA, { recursive: true, force: true });
  fs.rmSync(carpetaB, { recursive: true, force: true });
});

test("capas de vegetación, decoración e iluminación: presentes y con catálogo coherente", () => {
  const catDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  const ciudad = generarCiudad({ tier: "capital", semilla: "test-capas", catalogos });
  assert.ok(ciudad.arboles.length > 0, "capa de vegetación vacía");
  assert.ok(ciudad.deco.length > 0, "capa de decoración vacía");
  assert.ok(ciudad.luces.length >= 4, `pocas luces: ${ciudad.luces.length}`);
  for (const d of ciudad.deco) assert.ok(catDeco[d.i], `pieza de deco sin entrada de catálogo: ${d.i}`);
  for (const l of ciudad.luces) assert.ok(catDeco[l.id]?.luz, `luz sin datos de luz en catálogo: ${l.id}`);
  // la deco que colisiona nunca pisa un camino (no encierra a nadie)
  for (const d of ciudad.deco) {
    if (!catDeco[d.i].colision) continue;
    const t = ciudad.terreno.get(d.x, d.y);
    assert.ok(t !== "camino" && t !== "puente", `${d.i} bloquea un camino en ${d.x},${d.y}`);
  }
  // el tier más grande dobla el radio de la capital
  assert.strictEqual(asentamientos.gran_capital.organico.radio, asentamientos.capital.organico.radio * 2);
});

test("los terrenos urbanos existen en el catálogo del baker con su transitabilidad", () => {
  const terrenos = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "baker", "catalogo", "terrenos.json"), "utf8"));
  assert.strictEqual(terrenos.adoquin.transitable, true);
  assert.strictEqual(terrenos.muralla_piedra.transitable, false);
  assert.strictEqual(terrenos.empalizada.transitable, false);
  assert.strictEqual(terrenos.solar_edificio.transitable, false);
});
