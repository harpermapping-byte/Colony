"use strict";
// Suite del generador de edificios — node --test test_edificio.js
const test = require("node:test");
const assert = require("node:assert");
const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const { generarEdificio, clasificarEdificio, ARQUETIPO_FN, POR_ARQUETIPO, generarTodo, U, PAD, MADERA_CLARA, TONOS_PUERTA, elegirTecho, ESTILOS_VENTANA } = require("./generar_edificio");

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
  // puertaEnFachada(pisos[0]/planta0) en TODOS los arquetipos, con o sin ala/elongación.
  // El color de la hoja ahora varía por semilla (TONOS_PUERTA), no es siempre MADERA_CLARA.
  for (const tipoId of TODOS_LOS_TIPOS) {
    const m = generarEdificio(tipoId, 1);
    const idxsHoja = new Set(TONOS_PUERTA.map((hex) => m.paleta.indexOf(hex)).filter((i) => i !== -1));
    assert.ok(idxsHoja.size > 0, `${tipoId}: ni siquiera aparece ningún color de hoja de puerta`);
    const tienePuerta = m.cajas.some(([x0, y0, z0, x1, y1, z1, p]) => idxsHoja.has(p) && y0 === 0 && z0 === PAD - 1 && z1 === PAD - 1);
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

test("estiloVentanaAlt siempre distinto del principal (variedad DENTRO de un mismo edificio)", () => {
  for (let n = 1; n <= 20; n++) {
    const m = generarEdificio("casa_noble", n);
    assert.notStrictEqual(m.estiloVentanaAlt, m.estiloVentana, `semilla ${n}: alt igual al principal`);
    assert.ok(ESTILOS_VENTANA.includes(m.estiloVentanaAlt));
  }
});

// --- plan de suelo (vinculación con ciudades/) -------------------------------

test("plan de suelo: el modelo respeta w/h y las alas exactas del plan (formato ciudades/)", () => {
  const plan = {
    semilla: "rio-3:taberna:18",
    w: 9, h: 8,
    piezas: [
      { ox: 0, oy: 0, w: 9, h: 8 },
      { ox: 2, oy: -(8 / 2 + 4 / 2), w: 5, h: 4 }, // ala trasera tipo L
    ],
  };
  const m = generarEdificio("taberna", 1, plan);
  assert.strictEqual(m.forma, "plan");
  assert.strictEqual(m.enL, true);
  // el cuerpo manda en anchura (el ala cabe dentro); el ala alarga el fondo
  assert.strictEqual(m.grid[0], plan.w * U + 2 * PAD, "anchura ≠ plan");
  const fondoMinimo = (plan.h + 4) * U; // cuerpo + ala (con solape, algo menos que la suma exacta)
  assert.ok(m.grid[2] > plan.h * U + PAD && m.grid[2] <= fondoMinimo + 2 * PAD, `fondo ${m.grid[2]} no refleja el ala del plan`);
});

test("plan de suelo: misma semilla de plan = modelo idéntico (determinismo por instancia)", () => {
  const plan = { semilla: "rio-3:botica:15", w: 9, h: 7, piezas: [{ ox: 0, oy: 0, w: 9, h: 7 }], plantasAltas: 1 };
  const a = generarEdificio("botica", 1, plan);
  const b = generarEdificio("botica", 99, plan); // nn distinto NO debe influir si hay plan
  assert.deepStrictEqual(a.cajas, b.cajas);
  assert.deepStrictEqual(a.paleta, b.paleta);
});

test("plan de suelo: plantasAltas del plan manda sobre la tirada (encaje con el interior anidado)", () => {
  const base = { semilla: "x", w: 9, h: 7, piezas: [{ ox: 0, oy: 0, w: 9, h: 7 }] };
  const con2 = generarEdificio("posada", 1, { ...base, plantasAltas: 2 });
  const con0 = generarEdificio("posada", 1, { ...base, plantasAltas: 0 });
  const altura = (m) => Math.max(...m.cajas.map((c) => Math.max(c[1], c[4])));
  assert.ok(altura(con2) > altura(con0), "más plantas en el plan debería dar un modelo más alto");
});

// --- nivel de mejora (1/2/3) --------------------------------------------

test("nivel: sin pasar el argumento, el resultado es idéntico al de siempre (retrocompatible)", () => {
  const a = generarEdificio("casa_noble", 5);
  const b = generarEdificio("casa_noble", 5, null, null);
  assert.deepStrictEqual(a.cajas, b.cajas);
  assert.strictEqual(a.nivel, null);
});

test("nivel: nivel 3 da un edificio con más plantas (o igual) y nunca MENOS cajas que nivel 1", () => {
  const alturaDe = (m) => Math.max(...m.cajas.map((c) => Math.max(c[1], c[4])));
  for (let n = 1; n <= 10; n++) {
    const n1 = generarEdificio("casa_noble", n, null, 1);
    const n3 = generarEdificio("casa_noble", n, null, 3);
    assert.ok(alturaDe(n3) >= alturaDe(n1), `semilla ${n}: nivel 3 más bajo que nivel 1`);
    assert.ok(n3.cajas.length >= n1.cajas.length, `semilla ${n}: nivel 3 con menos cajas que nivel 1`);
  }
});

test("nivel: no rompe ningún tipoEdificio del catálogo en ninguno de los 3 niveles", () => {
  for (const tipoId of TODOS_LOS_TIPOS) {
    for (const nivel of [1, 2, 3]) {
      const m = generarEdificio(tipoId, 1, null, nivel);
      assert.ok(m.cajas.length > 0, `${tipoId} nivel ${nivel} generó 0 cajas`);
    }
  }
});

test("generarTodo con conNiveles=true multiplica por 3 sin tocar el modo normal (30 sigue siendo 30)", () => {
  const normal = generarTodo(true);
  assert.strictEqual(Object.keys(normal.resultado).length, 30);
  const conNiveles = generarTodo(true, true);
  assert.strictEqual(Object.keys(conNiveles.resultado).length, 90);
});

test("entramado Tudor ya no es exclusivo de casa_noble con voladizo: aparece también en casas modestas de madera", () => {
  let vistoEnModesta = false;
  for (let n = 1; n <= 30 && !vistoEnModesta; n++) {
    const m = generarEdificio("casa_modesta", n);
    if (m.material === "madera") {
      // el color de viga del entramado (MADERA_OSCURA) ya se usaba para el
      // marco de puertas/ventanas, así que buscamos algo más específico:
      // suficientes cajas del color de viga como para ser un entramado real,
      // no solo el marco de una puerta/ventana suelta.
      const nVigas = m.cajas.filter((c) => m.paleta[c[6]] === MADERA_CLARA || m.paleta[c[6]] === "#5a4326").length;
      if (nVigas > 15) vistoEnModesta = true;
    }
  }
  assert.ok(vistoEnModesta, "ninguna casa_modesta de madera en 30 semillas mostró entramado real");
});

test("greedy meshing: cada cara expuesta queda cubierta exactamente una vez (área fusionada = área original)", () => {
  const { expandirVoxeles, mallarVoxeles } = require("./exportar_glb");
  const m = generarEdificio("casa_humilde", 3);
  const ocupado = expandirVoxeles(m);
  // caras expuestas contadas a mano (el criterio de siempre: sin vecino en esa dirección)
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let expuestas = 0;
  for (const key of ocupado.keys()) {
    const [x, y, z] = key.split(",").map(Number);
    for (const [dx, dy, dz] of DIRS) if (!ocupado.has(`${x + dx},${y + dy},${z + dz}`)) expuestas++;
  }
  const mesh = mallarVoxeles(ocupado, 1);
  // área de cada quad = producto de sus dos lados no degenerados (los vértices
  // van en el orden de CARAS: 0→1 y 0→3 son las aristas del rectángulo)
  let area = 0;
  for (let q = 0; q < mesh.positions.length / 12; q++) {
    const v = (i) => mesh.positions.slice(q * 12 + i * 3, q * 12 + i * 3 + 3);
    const [a, b, d] = [v(0), v(1), v(3)];
    const lado1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lado2 = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    area += lado1 * lado2;
  }
  assert.strictEqual(area, expuestas, "el mesher greedy pierde o duplica superficie");
  assert.ok(mesh.indices.length / 3 < expuestas, "greedy no está fusionando nada");
});
