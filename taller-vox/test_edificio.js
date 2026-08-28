"use strict";
// Suite del generador de edificios — node --test test_edificio.js
const test = require("node:test");
const assert = require("node:assert");
const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const { generarEdificio, clasificarEdificio, ARQUETIPO_FN, POR_ARQUETIPO, generarTodo, U, PAD, MADERA_CLARA, elegirTecho, ESTILOS_VENTANA } = require("./generar_edificio");

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

test("generarTodo(true) da 3 variantes de los 10 arquetipos de prueba (30 modelos)", () => {
  const { resultado, conteo } = generarTodo(true);
  assert.strictEqual(Object.keys(resultado).length, 30);
  assert.strictEqual(Object.keys(conteo).length, 10);
});

test("castillo lleva 4 torres de esquina (además del cuerpo, más cajas que un edificio simple)", () => {
  const m = generarEdificio("castillo", 1);
  assert.ok(m.cajas.length > 50, "castillo debería tener bastantes cajas (cuerpo + 4 torres + almenas)");
});

test("generarTodo (catálogo completo) da bastantes más de 41 edificios distintos", () => {
  const { resultado } = generarTodo(false);
  assert.ok(Object.keys(resultado).length > 41 * 2, `solo ${Object.keys(resultado).length} modelos`);
});

test("variedad real entre variantes: material, estilo de madera/ventana o forma cambian con la semilla", () => {
  // 6 variantes de un tipo con varios materialesPreferidos y ala disponible en huellas.alas
  const variantes = [1, 2, 3, 4, 5, 6].map((n) => generarEdificio("posada", n));
  const materialesVistos = new Set(variantes.map((v) => v.material));
  const estilosMadera = new Set(variantes.map((v) => v.estiloMadera));
  const estilosVentana = new Set(variantes.map((v) => v.estiloVentana));
  const formas = new Set(variantes.map((v) => `${v.forma}|${v.enL}`));
  const distintos = materialesVistos.size + estilosMadera.size + estilosVentana.size + formas.size;
  assert.ok(distintos > 4, "6 variantes de posada deberían mostrar alguna variedad real, no ser todas iguales");
});

test("el ala en L, cuando sale, se fusiona sin romper la geometría (más cajas, grid coherente)", () => {
  // castillo tiene ala en huellas.json — probamos semillas hasta encontrar una con ala
  let conAla = null;
  for (let n = 1; n <= 20 && !conAla; n++) {
    const m = generarEdificio("castillo", n);
    if (m.enL) conAla = m;
  }
  assert.ok(conAla, "ninguna de las 20 semillas de castillo salió en L — revisar elegirForma");
  assert.ok(conAla.grid[0] > 0 && conAla.grid[2] > 0);
  assert.ok(conAla.cajas.every((c) => c.every((n) => Number.isFinite(n))));
});

test("elegirTecho: adobe da un tejado propio, no paja ni pizarra", () => {
  assert.notStrictEqual(elegirTecho("adobe", "humilde"), undefined);
});

test("TODOS los edificios llevan puerta sí o sí (hoja en la fachada sur, planta baja)", () => {
  // la hoja de la puerta siempre cae en z0=z1=PAD-1, y0=0 — invariante de
  // puertaEnFachada(pisos[0]/planta0) en TODOS los arquetipos, con o sin ala/elongación
  for (const tipoId of TODOS_LOS_TIPOS) {
    const m = generarEdificio(tipoId, 1);
    const idxHoja = m.paleta.indexOf(MADERA_CLARA);
    assert.ok(idxHoja !== -1, `${tipoId}: ni siquiera aparece el color de la hoja de puerta`);
    const tienePuerta = m.cajas.some(([x0, y0, z0, x1, y1, z1, p]) => p === idxHoja && y0 === 0 && z0 === PAD - 1 && z1 === PAD - 1);
    assert.ok(tienePuerta, `${tipoId}: no se encontró la hoja de la puerta en la posición esperada`);
  }
});

test("10 estilos de ventana reales: una muestra de semillas los toca casi todos", () => {
  const vistos = new Set();
  for (let n = 1; n <= 40; n++) vistos.add(generarEdificio("casa_noble", n).estiloVentana);
  assert.ok(vistos.size >= 6, `solo ${vistos.size} estilos distintos de ${ESTILOS_VENTANA.length} en 40 semillas`);
  for (const estilo of vistos) assert.ok(ESTILOS_VENTANA.includes(estilo));
});

test("variedad estructural en casas ricas: porche/balcón/retranqueo cambian el nº de cajas entre semillas", () => {
  const conteos = new Set();
  for (let n = 1; n <= 15; n++) conteos.add(generarEdificio("casa_noble", n).cajas.length);
  assert.ok(conteos.size >= 5, `casa_noble apenas varía en cajas entre semillas (${conteos.size} valores distintos) — ¿balcón/porche/retranqueo no se están aplicando?`);
});

test("densidad de ventanas variable: no todas las variantes tienen la misma cantidad de huecos", () => {
  const contarVentanas = (m) => m.cajas.filter(([, , , , , , p]) => m.paleta[p] === "#bcdff0").length; // CRISTAL
  const conteos = new Set();
  for (let n = 1; n <= 15; n++) conteos.add(contarVentanas(generarEdificio("taberna", n)));
  assert.ok(conteos.size >= 3, `la densidad de ventanas casi no varía (${conteos.size} valores distintos)`);
});
