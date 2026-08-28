"use strict";
// Suite del generador de edificios — node --test test_edificio.js
const test = require("node:test");
const assert = require("node:assert");
const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const { generarEdificio, clasificarEdificio, ARQUETIPO_FN, POR_ARQUETIPO, generarTodo, U } = require("./generar_edificio");

const TODOS_LOS_TIPOS = Object.keys(tiposEdificio).filter((id) => !id.startsWith("_"));

test("todo tipoEdificio del catálogo clasifica a un arquetipo con función real", () => {
  for (const tipoId of TODOS_LOS_TIPOS) {
    const arq = clasificarEdificio(tipoId, tiposEdificio[tipoId]);
    assert.ok(ARQUETIPO_FN[arq], `${tipoId} -> ${arq} sin función de arquetipo`);
  }
});

test("no hay tipoEdificio duplicado entre arquetipos del mapa explícito", () => {
  const vistos = new Set();
  for (const ids of Object.values(POR_ARQUETIPO)) {
    for (const id of ids) {
      assert.ok(!vistos.has(id), `${id} aparece en más de un arquetipo`);
      vistos.add(id);
    }
  }
});

test("generarEdificio no revienta para ningún tipo del catálogo real", () => {
  for (const tipoId of TODOS_LOS_TIPOS) {
    const m = generarEdificio(tipoId, 1);
    assert.ok(m.cajas.length > 0, `${tipoId} generó 0 cajas`);
    assert.ok(m.grid[0] > 0 && m.grid[1] > 0 && m.grid[2] > 0, `${tipoId} grid inválido`);
  }
});

test("determinismo: misma semilla -> mismas cajas exactas", () => {
  const a = generarEdificio("casa_noble", 3);
  const b = generarEdificio("casa_noble", 3);
  assert.deepStrictEqual(a.cajas, b.cajas);
});

test("variantes distintas de un mismo tipo pueden diferir (plantas/detalle por semilla)", () => {
  const a = generarEdificio("posada", 1);
  const b = generarEdificio("posada", 2);
  // no exigimos que difieran siempre (el rango de plantas puede coincidir),
  // pero ambas deben ser modelos válidos con la misma huella base
  assert.deepStrictEqual(a.huella, b.huella);
});

test("la huella del modelo (x,z) es coherente con huellas.json (±margen de aleros/voladizo)", () => {
  const huellas = require("../ciudades/catalogo/huellas.json");
  for (const tipoId of TODOS_LOS_TIPOS) {
    const m = generarEdificio(tipoId, 1);
    const esperado = huellas.porTipo[tipoId] || huellas.porRiqueza[tiposEdificio[tipoId].riqueza];
    assert.deepStrictEqual(m.huella, esperado, tipoId);
    // el grid en vóxeles debe ser al menos ancho*U (nunca más pequeño que la huella real)
    assert.ok(m.grid[0] >= esperado[0] * U, `${tipoId}: grid X menor que la huella`);
    assert.ok(m.grid[2] >= esperado[1] * U, `${tipoId}: grid Z menor que la huella`);
  }
});

test("generarTodo(true) da el subconjunto de 10 arquetipos de prueba", () => {
  const { resultado, conteo } = generarTodo(true);
  assert.strictEqual(Object.keys(resultado).length, 10);
  assert.strictEqual(Object.keys(conteo).length, 10);
});

test("castillo lleva 4 torres de esquina (además del cuerpo, más cajas que un edificio simple)", () => {
  const m = generarEdificio("castillo", 1);
  assert.ok(m.cajas.length > 50, "castillo debería tener bastantes cajas (cuerpo + 4 torres + almenas)");
});
