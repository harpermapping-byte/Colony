"use strict";
// Suite del generador de hitos de plaza — node --test test_hitos_plaza.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const decoracion = require("../ciudades/catalogo/decoracion.json");
const { generarTodo, ARQUETIPO_FN, CLASIFICACION, U, NUM_VARIANTES } = require("./generar_hitos_plaza");
const { exportarModelo } = require("./exportar_glb");

const IDS = ["pozo_agua", "fuente_piedra", "estatua_piedra"];

test("las 3 piezas de decoracion.json que clasifica este generador existen de verdad en el catálogo", () => {
  for (const id of IDS) assert.ok(decoracion[id], `${id} no está en ciudades/catalogo/decoracion.json`);
});

test("cada id clasifica a un arquetipo con función real", () => {
  for (const [id, { arquetipo }] of Object.entries(CLASIFICACION)) {
    assert.ok(ARQUETIPO_FN[arquetipo], `${id} -> ${arquetipo} sin función de arquetipo`);
  }
});

test("generarTodo da 3 variantes x 3 hitos = 9 modelos, todos con cajas y grid válidos", () => {
  const { resultado, conteo } = generarTodo();
  assert.strictEqual(Object.keys(resultado).length, IDS.length * NUM_VARIANTES);
  assert.strictEqual(Object.keys(conteo).length, IDS.length); // 1 arquetipo por hito, sin compartir
  for (const [clave, modelo] of Object.entries(resultado)) {
    assert.ok(modelo.cajas.length > 0, `${clave} generó 0 cajas`);
    assert.ok(modelo.grid.every((n) => n > 0), `${clave} grid inválido: ${modelo.grid}`);
    assert.strictEqual(modelo.resolucion, U);
  }
});

test("determinismo: misma semilla -> mismas cajas exactas", () => {
  const a = generarTodo().resultado;
  const b = generarTodo().resultado;
  assert.deepStrictEqual(a, b);
});

test("todas las cajas quedan DENTRO del grid declarado (nada sobresale de su propia caja delimitadora)", () => {
  const { resultado } = generarTodo();
  for (const [clave, modelo] of Object.entries(resultado)) {
    const [gx, gy, gz] = modelo.grid;
    for (const [x0, y0, z0, x1, y1, z1] of modelo.cajas) {
      assert.ok(x0 >= 0 && z0 >= 0 && y0 >= 0, `${clave}: caja con coordenada negativa`);
      assert.ok(x1 < gx && y1 < gy && z1 < gz, `${clave}: caja [${x1},${y1},${z1}] se sale del grid ${modelo.grid}`);
    }
  }
});

test("3 variantes de cada hito no son todas idénticas (variedad real por semilla)", () => {
  const { resultado } = generarTodo();
  for (const id of IDS) {
    const variantes = [1, 2, 3].map((n) => JSON.stringify(resultado[`${id}_${String(n).padStart(2, "0")}`].cajas));
    assert.ok(new Set(variantes).size > 1, `${id}: las 3 variantes generaron exactamente las mismas cajas`);
  }
});

test("el tamaño del modelo (grid/resolucion) es del orden de las dimensiones reales del catálogo (±50% de margen por postes/pedestal)", () => {
  const { resultado } = generarTodo();
  for (const id of IDS) {
    const [dx, dy, dz] = decoracion[id].dimensiones;
    const modelo = resultado[`${id}_01`];
    const [gx, gy, gz] = modelo.grid.map((n) => n / U);
    // margen generoso: el grid incluye postes/torno/cubo colgante (pozo) o
    // remate de agua (fuente) que sobresalen algo de la huella base
    assert.ok(gx >= dx * 0.6 && gx <= dx * 2.2, `${id}: ancho X ${gx} lejos de la dimensión de catálogo ${dx}`);
    assert.ok(gz >= dz * 0.6 && gz <= dz * 2.2, `${id}: ancho Z ${gz} lejos de la dimensión de catálogo ${dz}`);
    assert.ok(gy >= dy * 0.5 && gy <= dy * 2.5, `${id}: alto Y ${gy} lejos de la dimensión de catálogo ${dy}`);
  }
});

// --- exportación y validez real del .glb ------------------------------------

// Misma lectura mínima de cabecera glTF binario que usa taller-vox/validar_glb.js
// (duplicada aquí a propósito: es un script CLI sin module.exports, y este
// test solo necesita confirmar que el .glb no está corrupto, no reusar su CLI).
function validarGLB(buf) {
  assert.strictEqual(buf.readUInt32LE(0), 0x46546c67, "magic glTF inválido");
  assert.strictEqual(buf.readUInt32LE(8), buf.length, "longitud total del .glb no coincide");
  const jsonLen = buf.readUInt32LE(12);
  assert.strictEqual(buf.readUInt32LE(16), 0x4e4f534a, "primer chunk no es JSON");
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const binOffset = 20 + jsonLen;
  assert.strictEqual(buf.readUInt32LE(binOffset + 4), 0x004e4942, "segundo chunk no es BIN");
  const prim = json.meshes[0].primitives[0];
  const idxAcc = json.accessors[prim.indices];
  assert.strictEqual(idxAcc.count % 3, 0, "número de índices no divisible por 3");
  const posAcc = json.accessors[prim.attributes.POSITION];
  return { vertices: posAcc.count, triangulos: idxAcc.count / 3 };
}

test("las 9 variantes exportan a .glb válido (magic/JSON/BIN/índices correctos)", () => {
  const { resultado } = generarTodo();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hitos-plaza-glb-"));
  try {
    for (const [clave, modelo] of Object.entries(resultado)) {
      const ruta = path.join(tmp, `${clave}.glb`);
      const stats = exportarModelo(modelo, clave, ruta, 1 / modelo.resolucion);
      assert.ok(stats.triangulos > 0, `${clave}: 0 triángulos exportados`);
      const info = validarGLB(fs.readFileSync(ruta));
      assert.strictEqual(info.triangulos, stats.triangulos);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
