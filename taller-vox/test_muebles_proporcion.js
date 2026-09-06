"use strict";
// Suite de regresión del bug real reportado por el streamer ("las sillas
// son GIGANTES la cama y mesa ENORMES en proporción a los NPC... las
// colisiones... deben adecuarse... que ahora chocas con la cama en una
// zona que no hay cama") — node --test test_muebles_proporcion.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exportarModelo } = require("./exportar_glb");

delete require.cache[require.resolve("./modelos_generados.json")];
const modelos = require("./modelos_generados.json");

// Persona de referencia (client/src/render3d/proporcionesRig.json): altura
// total de pie = altoPierna + altoTorso + ladoCabeza.
const rig = require("../client/src/render3d/proporcionesRig.json");
const ALTO_PERSONA = rig.altoPierna + rig.altoTorso + rig.ladoCabeza;

function alturaMundo(id) {
  const m = modelos[id];
  return m.grid[1] / m.resolucion;
}

test("silla/banco ya no salen más altos que una persona de pie (antes 2.3 casillas, ~1.46x la persona)", () => {
  for (const id of ["silla", "banco", "taburete"]) {
    assert.ok(modelos[id], `falta ${id} en modelos_generados.json`);
    const h = alturaMundo(id);
    assert.ok(h < ALTO_PERSONA, `${id} mide ${h.toFixed(2)}u, ALTO_PERSONA=${ALTO_PERSONA.toFixed(2)}u — sigue "gigante"`);
    assert.ok(h > 0.5, `${id} mide ${h.toFixed(2)}u — demasiado bajo para ser una silla real`);
  }
});

test("trono sigue siendo el asiento más alto (ornamental) pero no desproporcionado (< 1.5x persona)", () => {
  const h = alturaMundo("trono");
  assert.ok(h > alturaMundo("silla"), "el trono debería seguir siendo más alto que una silla normal");
  assert.ok(h < ALTO_PERSONA * 1.5, `trono mide ${h.toFixed(2)}u — sigue desproporcionado (persona=${ALTO_PERSONA.toFixed(2)}u)`);
});

test("mesa/yunque ya no salen a la altura de una persona (antes 1.9 casillas, prácticamente la altura de un NPC)", () => {
  for (const id of ["mesa_comedor", "mesa_comedor_larga", "escritorio"]) {
    assert.ok(modelos[id], `falta ${id} en modelos_generados.json`);
    const h = alturaMundo(id);
    assert.ok(h < ALTO_PERSONA * 0.6, `${id} mide ${h.toFixed(2)}u — sigue "enorme" (persona=${ALTO_PERSONA.toFixed(2)}u)`);
    assert.ok(h > 0.4, `${id} mide ${h.toFixed(2)}u — demasiado baja para ser una mesa real`);
  }
});

test("cama ya no sale con postes de cabecero casi tan altos como una persona de pie (antes 1.5 casillas)", () => {
  for (const id of ["cama_individual", "cama_doble"]) {
    assert.ok(modelos[id], `falta ${id} en modelos_generados.json`);
    const h = alturaMundo(id);
    assert.ok(h < ALTO_PERSONA * 0.75, `${id} mide ${h.toFixed(2)}u — sigue "enorme" (persona=${ALTO_PERSONA.toFixed(2)}u)`);
  }
});

test("exportarModelo con centrarXZ=true saca el mesh centrado en su propio origen local (min=-max en X/Z)", () => {
  const modelo = modelos["silla"];
  const tmp = path.join(os.tmpdir(), "test_silla_centrada.glb");
  exportarModelo(modelo, "silla", tmp, 1 / modelo.resolucion, true);
  const buf = fs.readFileSync(tmp);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const [minx, miny, minz, maxx, , maxz] = json.accessors[0].min.concat(json.accessors[0].max);
  assert.ok(Math.abs(minx + maxx) < 1e-6, `X no está centrado: min=${minx} max=${maxx}`);
  assert.ok(Math.abs(minz + maxz) < 1e-6, `Z no está centrado: min=${minz} max=${maxz}`);
  assert.strictEqual(miny, 0, "Y debe seguir apoyada en el suelo (y=0), solo X/Z se centran");
  fs.unlinkSync(tmp);
});

test("exportarModelo SIN centrarXZ (comportamiento por defecto, edificios/naturaleza/personajes) sigue ANCLADO en la esquina — no rompe nada fuera de interiores/", () => {
  const modelo = modelos["silla"];
  const tmp = path.join(os.tmpdir(), "test_silla_esquina.glb");
  exportarModelo(modelo, "silla", tmp, 1 / modelo.resolucion); // centrarXZ omitido = false
  const buf = fs.readFileSync(tmp);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const [minx, , minz] = json.accessors[0].min;
  assert.strictEqual(minx, 0);
  assert.strictEqual(minz, 0);
  fs.unlinkSync(tmp);
});

test("footprint real tras centrar coincide con la huella del catálogo (interiores/catalogo/elementos.json)", () => {
  const elementos = require("../interiores/catalogo/elementos.json");
  for (const id of ["silla", "cama_individual", "mesa_comedor"]) {
    const modelo = modelos[id];
    const huella = elementos[id].huella; // [ancho, largo] en casillas
    const tmp = path.join(os.tmpdir(), `test_footprint_${id}.glb`);
    exportarModelo(modelo, id, tmp, 1 / modelo.resolucion, true);
    const buf = fs.readFileSync(tmp);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
    const [minx, , minz, maxx, , maxz] = json.accessors[0].min.concat(json.accessors[0].max);
    assert.ok(Math.abs((maxx - minx) - huella[0]) < 0.05, `${id}: ancho real ${(maxx - minx).toFixed(2)} vs huella ${huella[0]}`);
    assert.ok(Math.abs((maxz - minz) - huella[1]) < 0.05, `${id}: largo real ${(maxz - minz).toFixed(2)} vs huella ${huella[1]}`);
    fs.unlinkSync(tmp);
  }
});
