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

// --- Mobiliario del carpintero (docs/GDD_Construccion.md §9, 2026-09-11) ---

test("armario/estantería/alacena ya no salen al DOBLE de una persona (antes 3.2 casillas para todo contenedor alto); cómoda/aparador a la cintura", () => {
  for (const id of ["armario", "estanteria", "armario_roble_grande", "alacena_cocina_pino", "armario_ropa_abedul"]) {
    assert.ok(modelos[id], `falta ${id}`);
    const h = alturaMundo(id);
    assert.ok(h < ALTO_PERSONA * 1.35, `${id} mide ${h.toFixed(2)}u — sigue gigante (persona=${ALTO_PERSONA.toFixed(2)}u)`);
    assert.ok(h > ALTO_PERSONA * 0.9, `${id} mide ${h.toFixed(2)}u — un armario real llega por encima de la cabeza`);
  }
  for (const id of ["comoda_pino", "aparador_roble", "botellero_roble"]) {
    const h = alturaMundo(id);
    assert.ok(h < ALTO_PERSONA * 0.7 && h > 0.5, `${id} mide ${h.toFixed(2)}u — una cómoda llega a la cintura`);
  }
  for (const id of ["arcon", "baul_pino", "caja_pino", "cesto_mimbre_grande"]) {
    const h = alturaMundo(id);
    assert.ok(h < 0.9 && h > 0.4, `${id} mide ${h.toFixed(2)}u — un baúl/caja no pasa de la cadera`);
  }
});

test("sofás/butacas/divanes son asientos tapizados: existen, tienen altura de asiento y el triple es más ancho que el doble", () => {
  for (const id of ["sofa_lino_doble", "sofa_lino_triple", "sofa_cuero_doble", "butaca_cuero", "sillon_orejero_cuero", "divan_seda_noble"]) {
    assert.ok(modelos[id], `falta ${id}`);
    assert.strictEqual(modelos[id].arquetipo, "ASIENTO", `${id} no se clasificó como asiento`);
    const h = alturaMundo(id);
    assert.ok(h > 0.5 && h < ALTO_PERSONA * 0.7, `${id} mide ${h.toFixed(2)}u`);
  }
  assert.ok(modelos.sofa_lino_triple.grid[0] > modelos.sofa_lino_doble.grid[0], "el sofá triple debe ser más ancho que el doble");
});

test("objetos DE PIE (perchero/maniquí/candelabro de pie/espejo de pie) miden alrededor de una persona, los de mesa no; araña y farol colgante flotan a la altura del techo", () => {
  for (const id of ["perchero_pie_roble", "maniqui_armadura", "candelabro_pie_hierro", "espejo_pie_abedul", "armero_pie_roble", "perchero"]) {
    const h = alturaMundo(id);
    assert.ok(h > ALTO_PERSONA * 0.8 && h < ALTO_PERSONA * 1.15, `${id} mide ${h.toFixed(2)}u — debería rondar la altura de una persona`);
  }
  for (const id of ["candelero_pino_mesa", "lampara_aceite_mesa_cobre", "candelabro_mesa_cobre"]) {
    assert.ok(alturaMundo(id) < 0.8, `${id} es de mesa, no debería pasar de 0.8u`);
  }
  for (const id of ["lampara_arana_cobre", "farol_colgante_cobre"]) {
    const minY = Math.min(...modelos[id].cajas.map((c) => c[1])) / modelos[id].resolucion;
    assert.ok(minY >= 0.85, `${id}: su vóxel más bajo está a ${minY.toFixed(2)}u — una pieza colgante no puede apoyarse en el suelo`);
  }
});

test("las piezas nuevas del carpintero tienen todas modelo generado, ninguna cae al bulto GENERICO", () => {
  const elementos = require("../interiores/catalogo/elementos.json");
  const nuevas = Object.keys(elementos).filter((k) => elementos[k]._nota && /mobiliario del carpintero/.test(elementos[k]._nota));
  assert.ok(nuevas.length >= 80, `esperaba 80+ piezas nuevas, hay ${nuevas.length}`);
  const sinModelo = nuevas.filter((k) => !modelos[k]);
  const genericas = nuevas.filter((k) => modelos[k] && modelos[k].arquetipo === "GENERICO");
  assert.deepStrictEqual(sinModelo, [], "piezas sin modelo");
  assert.deepStrictEqual(genericas, [], "piezas caídas al arquetipo GENERICO");
});
