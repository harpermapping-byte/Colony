"use strict";
// Suite de los generadores de vóxeles de ÍTEMS (armas/herramientas/objetos/
// comida) — node --test test_items.js. Mismo patrón que test_pj.js/
// test_edificio.js: geometría válida para TODO el catálogo real (barato,
// solo cálculo en memoria — no exporta .glb de los 194 ids, ver cabecera
// de generar_armas.js sobre el pacto de alcance 2026-09-01), determinismo
// por semilla, y una exportación .glb real de una muestra pequeña para
// probar el pipeline completo hasta el archivo binario.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const items = require("../items/catalogo/items.json");

const armas = require("./generar_armas");
const herramientas = require("./generar_herramientas");
const objetos = require("./generar_objetos");
const comida = require("./generar_comida");
const { exportarModelo } = require("./exportar_glb");

function assertModeloValido(m, id) {
  assert.ok(m, `${id}: modelo nulo`);
  assert.ok(Array.isArray(m.cajas) && m.cajas.length > 0, `${id}: sin cajas`);
  assert.ok(Array.isArray(m.paleta) && m.paleta.length > 0, `${id}: paleta vacía`);
  assert.ok(m.grid.every((g) => g > 0), `${id}: grid inválido ${JSON.stringify(m.grid)}`);
  for (const [x0, y0, z0, x1, y1, z1, p] of m.cajas) {
    assert.ok(x1 >= x0 && y1 >= y0 && z1 >= z0, `${id}: caja invertida`);
    assert.ok(p >= 0 && p < m.paleta.length, `${id}: índice de paleta fuera de rango`);
  }
}

// --- armas -------------------------------------------------------------

test("armas: todo id del catálogo tipo:arma clasifica a un arquetipo con función real", () => {
  assert.strictEqual(armas.IDS_ARMA.length, 19);
  for (const id of armas.IDS_ARMA) {
    const arq = armas.clasificarArma(id);
    assert.ok(armas.ARQUETIPO_FN[arq], `${id} -> ${arq} sin función`);
  }
});

test("armas: generarArma no revienta para ningún id real y produce geometría válida", () => {
  for (const id of armas.IDS_ARMA) assertModeloValido(armas.generarArma(id), id);
});

test("armas: determinismo — mismo id, mismas cajas exactas", () => {
  const a = armas.generarArma("espada_larga");
  const b = armas.generarArma("espada_larga");
  assert.deepStrictEqual(a.cajas, b.cajas);
  assert.deepStrictEqual(a.paleta, b.paleta);
});

test("armas: '_bonificada' comparte aspecto EXACTO con su base (nota del catálogo)", () => {
  for (const id of armas.IDS_ARMA) {
    const m = id.match(/^(.+)_bonificad[oa]$/);
    if (!m) continue;
    const base = armas.generarArma(m[1]);
    const bonificada = armas.generarArma(id);
    assert.deepStrictEqual(bonificada.cajas, base.cajas, `${id} debería verse igual que ${m[1]}`);
  }
});

test("armas: la longitud crece con huella[1] del catálogo (daga corta < espada_larga < lanza)", () => {
  const daga = armas.generarArma("daga");
  const larga = armas.generarArma("espada_larga");
  const lanza = armas.generarArma("lanza");
  assert.ok(daga.grid[1] < larga.grid[1]);
  assert.ok(larga.grid[1] < lanza.grid[1]);
});

// --- herramientas --------------------------------------------------------

test("herramientas: todo id del catálogo tipo:herramienta clasifica y genera geometría válida", () => {
  assert.strictEqual(herramientas.IDS_HERRAMIENTA.length, 70);
  for (const id of herramientas.IDS_HERRAMIENTA) {
    const arq = herramientas.clasificarHerramienta(id);
    assert.ok(herramientas.ARQUETIPO_FN[arq], `${id} -> ${arq} sin función`);
    assertModeloValido(herramientas.generarHerramienta(id), id);
  }
});

test("herramientas: el fallback GENERICO no es la mayoría del catálogo (la clasificación por familia cubre de verdad)", () => {
  const conteo = {};
  for (const id of herramientas.IDS_HERRAMIENTA) {
    const arq = herramientas.clasificarHerramienta(id);
    conteo[arq] = (conteo[arq] || 0) + 1;
  }
  assert.ok(conteo.GENERICO < herramientas.IDS_HERRAMIENTA.length * 0.2, `demasiadas herramientas sin arquetipo específico: ${conteo.GENERICO}`);
});

test("herramientas: determinismo", () => {
  const a = herramientas.generarHerramienta("pico_minero");
  const b = herramientas.generarHerramienta("pico_minero");
  assert.deepStrictEqual(a.cajas, b.cajas);
});

// --- objetos ---------------------------------------------------------------

test("objetos: todo id del catálogo tipo:objeto clasifica (cobertura real o SIN_COBERTURA/BARCO documentados)", () => {
  assert.strictEqual(objetos.IDS_OBJETO.length, 75);
  for (const id of objetos.IDS_OBJETO) {
    const arq = objetos.clasificarObjeto(id);
    assert.ok(arq in objetos.ARQUETIPO_FN, `${id} -> ${arq} sin entrada en ARQUETIPO_FN`);
  }
});

test("objetos: generarObjeto produce geometría válida para todo id CON cobertura", () => {
  let cubiertos = 0;
  for (const id of objetos.IDS_OBJETO) {
    const arq = objetos.clasificarObjeto(id);
    const m = objetos.generarObjeto(id);
    if (arq === "SIN_COBERTURA" || arq === "BARCO") {
      assert.strictEqual(m, null, `${id} (${arq}) debería devolver null`);
    } else {
      assertModeloValido(m, id);
      cubiertos++;
    }
  }
  assert.ok(cubiertos >= 35, `cobertura de objetos sospechosamente baja: ${cubiertos}`);
});

test("objetos: los 40 cadáveres quedan documentados como SIN_COBERTURA (no se fuerza un arquetipo malo)", () => {
  const cadaveres = objetos.IDS_OBJETO.filter((id) => id.startsWith("cadaver_"));
  assert.ok(cadaveres.length > 0);
  for (const id of cadaveres) assert.strictEqual(objetos.clasificarObjeto(id), "SIN_COBERTURA");
});

test("objetos: los 4 barcos no se duplican (ya cubiertos por generar_barco.js)", () => {
  for (const id of ["barco_1", "barco_2", "barco_3", "barco_4"]) {
    assert.strictEqual(objetos.clasificarObjeto(id), "BARCO");
  }
});

// --- comida ------------------------------------------------------------

test("comida: todo id del catálogo tipo:consumible clasifica y genera geometría válida", () => {
  assert.strictEqual(comida.IDS_CONSUMIBLE.length, 31);
  for (const id of comida.IDS_CONSUMIBLE) {
    const arq = comida.clasificarComida(id);
    assert.ok(comida.ARQUETIPO_FN[arq], `${id} -> ${arq} sin función`);
    assertModeloValido(comida.generarComida(id), id);
  }
});

test("comida: determinismo", () => {
  const a = comida.generarComida("queso");
  const b = comida.generarComida("queso");
  assert.deepStrictEqual(a.cajas, b.cajas);
});

// --- exportación .glb real de una muestra pequeña (prueba de pipeline) ---

test("exportar_glb: una muestra pequeña de cada categoría exporta un .glb válido y no vacío", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "items-glb-"));
  const muestra = [
    ["arma", armas.generarArma("daga")],
    ["herramienta", herramientas.generarHerramienta("martillo_forja_hierro")],
    ["objeto", objetos.generarObjeto("caldero")],
    ["comida", comida.generarComida("pan")],
  ];
  for (const [grupo, modelo] of muestra) {
    const ruta = path.join(dir, `${grupo}.glb`);
    const unit = 1 / (modelo.resolucion || 12);
    const stats = exportarModelo(modelo, grupo, ruta, unit);
    assert.ok(stats.bytes > 200, `${grupo}: .glb sospechosamente pequeño (${stats.bytes} bytes)`);
    assert.ok(fs.existsSync(ruta));
    const header = fs.readFileSync(ruta).subarray(0, 4).toString("ascii");
    assert.strictEqual(header, "glTF", `${grupo}: cabecera .glb inválida`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- coherencia con items.json: ningún id inventado, ninguno olvidado ---

test("los 4 catálogos de items.json (arma/herramienta/objeto/consumible) están cubiertos exactamente por IDS_*", () => {
  const porTipo = { arma: [], herramienta: [], objeto: [], consumible: [] };
  for (const [id, v] of Object.entries(items)) {
    if (v && porTipo[v.tipo]) porTipo[v.tipo].push(id);
  }
  assert.deepStrictEqual([...armas.IDS_ARMA].sort(), porTipo.arma.sort());
  assert.deepStrictEqual([...herramientas.IDS_HERRAMIENTA].sort(), porTipo.herramienta.sort());
  assert.deepStrictEqual([...objetos.IDS_OBJETO].sort(), porTipo.objeto.sort());
  assert.deepStrictEqual([...comida.IDS_CONSUMIBLE].sort(), porTipo.consumible.sort());
});
