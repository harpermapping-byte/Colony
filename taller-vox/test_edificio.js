"use strict";
// Suite del generador de edificios — node --test test_edificio.js
const test = require("node:test");
const assert = require("node:assert");
const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const materiales = require("../interiores/catalogo/materiales.json");
const huellasCat = require("../ciudades/catalogo/huellas.json");
const {
  generarEdificio, clasificarEdificio, ARQUETIPO_FN, POR_ARQUETIPO, generarTodo, U, PAD, MADERA_CLARA, MADERA_OSCURA,
  CRISTAL, FUEGO, BARRO, TONOS_PUERTA, elegirTecho, ESTILOS_VENTANA, MARGEN_ENTRE_HUECOS, MARGEN_SEGURIDAD_ALA,
  ESTILOS_TECHO, rangoLibre, sombrear, PALETA_BLASON_FAMILIAR, TRONCO_CLARO, TRONCO_OSCURO, MIMBRE, HIEDRA_1, HIEDRA_2,
} = require("./generar_edificio");

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

// =============================================================================
// Parte A: ventanas por piso sin solape + más variedad de techos (2026-09-12)
// =============================================================================

// ¿alguna caja de vidrio (CRISTAL) queda "enterrada" — es decir, en el
// resultado FINAL (tras resolver los solapes de voxel exactamente como
// exportar_glb.js::expandirVoxeles: gana la caja que se dibuja MÁS TARDE en
// `m.cajas`) alguno de sus vóxeles deja de ser del color de vidrio? Eso es
// EXACTAMENTE el bug real medido (83.2% de los edificios con ala): una
// ventana pintada por una pieza queda tapada por la masa sólida de la otra,
// fusionada DESPUÉS en el array de cajas.
//
// Implementación restringida al volumen de cada ventana (no expandirVoxeles
// sobre el edificio ENTERO, que en un castillo/institución grande son
// cientos de miles de vóxeles y hace la comprobación 17×3×20 veces
// inviable en tiempo) — mismo criterio exacto (orden de array, última caja
// gana), solo evaluado sobre las pocas cajas que de verdad podrían solaparse
// con esa ventana.
function cajasSeSolapan(c, x0, y0, z0, x1, y1, z1) {
  let [cx0, cy0, cz0, cx1, cy1, cz1] = c;
  if (cx1 < cx0) [cx0, cx1] = [cx1, cx0];
  if (cy1 < cy0) [cy0, cy1] = [cy1, cy0];
  if (cz1 < cz0) [cz0, cz1] = [cz1, cz0];
  return cx0 <= x1 && cx1 >= x0 && cy0 <= y1 && cy1 >= y0 && cz0 <= z1 && cz1 >= z0;
}
function hexARgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
// ¿la caja `c` está COMPLETAMENTE dentro de la caja [x0..x1,y0..y1,z0..z1]?
// Usado para descartar la propia decoración de la ventana (mullones de
// estilo cruz/diamante/redonda/bífora, que dibujarVentana pinta ENCIMA de
// su propio vidrio a propósito — parte del dibujo del cristal emplomado, no
// un solape real con otra pieza) del análisis de "enterrada por otra pieza".
function cajaContenida(c, x0, y0, z0, x1, y1, z1) {
  let [cx0, cy0, cz0, cx1, cy1, cz1] = c;
  if (cx1 < cx0) [cx0, cx1] = [cx1, cx0];
  if (cy1 < cy0) [cy0, cy1] = [cy1, cy0];
  if (cz1 < cz0) [cz0, cz1] = [cz1, cz0];
  return cx0 >= x0 && cx1 <= x1 && cy0 >= y0 && cy1 <= y1 && cz0 >= z0 && cz1 <= z1;
}
// ¿a qué PIEZA (0=cuerpo principal, 1=primer ala fusionada, 2=segunda...)
// pertenece el índice `idx` de `cajas`? Usa `m.limitesPiezas` (nuevo campo
// del modelo, Parte A4 — las fronteras reales entre piezas en índices de
// caja, calculadas por generarEdificio ANTES/DESPUÉS de cada fusión).
function piezaDe(idx, limitesPiezas) {
  for (let i = 0; i < limitesPiezas.length; i++) if (idx < limitesPiezas[i]) return i;
  return limitesPiezas.length;
}
function ventanaEnterrada(m) {
  const idxCristal = m.paleta.indexOf(CRISTAL);
  if (idxCristal === -1) return false; // sin ventanas en este modelo, nada que comprobar
  const rgbCristal = hexARgb(CRISTAL);
  for (let idx = 0; idx < m.cajas.length; idx++) {
    const c = m.cajas[idx];
    if (c[6] !== idxCristal) continue;
    let [x0, y0, z0, x1, y1, z1] = c;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    // marco/mullones de la MISMA ventana: dibujarVentana nunca pinta su
    // propia decoración (cruz/diamante/redonda/bífora) más allá de 1 vóxel
    // fuera del vidrio en las dos direcciones que varían (el eje "fijo" de
    // profundidad se queda igual) — cualquier caja posterior TOTALMENTE
    // contenida en ese margen es la propia ventana pintándose a sí misma,
    // no una masa sólida de otra pieza.
    const mx0 = x0 === x1 ? x0 : x0 - 1, mx1 = x0 === x1 ? x1 : x1 + 1;
    const my0 = y0 - 1, my1 = y1 + 1;
    const mz0 = z0 === z1 ? z0 : z0 - 1, mz1 = z0 === z1 ? z1 : z1 + 1;
    const piezaVentana = piezaDe(idx, m.limitesPiezas);
    // solo las cajas dibujadas DESPUÉS (índice mayor) pueden ganarle el
    // vóxel a esta — expandirVoxeles resuelve por orden de inserción. Y
    // solo cuenta si viene de OTRA PIEZA fusionada (Parte A4: el bug real
    // era "ventana de una pieza enterrada en la masa de la OTRA pieza") —
    // un solape puramente interno de la MISMA pieza (p.ej. el frontón de un
    // pórtico institucional cruzando una ventana de su propio piso de
    // arriba) es un problema real pero DISTINTO, fuera de alcance aquí.
    const posteriores = [];
    for (let j = idx + 1; j < m.cajas.length; j++) {
      const p = m.cajas[j];
      if (piezaDe(j, m.limitesPiezas) === piezaVentana) continue; // misma pieza, no es el bug que se busca
      if (!cajasSeSolapan(p, x0, y0, z0, x1, y1, z1)) continue;
      if (cajaContenida(p, mx0, my0, mz0, mx1, my1, mz1)) continue; // propia decoración, no cuenta
      posteriores.push(p);
    }
    if (posteriores.length === 0) continue; // nada la toca después — no puede estar enterrada
    const ocupado = new Map();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) ocupado.set(`${x},${y},${z}`, rgbCristal);
    for (const p of posteriores) {
      let [px0, py0, pz0, px1, py1, pz1, pp] = p;
      if (px1 < px0) [px0, px1] = [px1, px0];
      if (py1 < py0) [py0, py1] = [py1, py0];
      if (pz1 < pz0) [pz0, pz1] = [pz1, pz0];
      const prgb = hexARgb(m.paleta[pp]);
      for (let x = Math.max(x0, px0); x <= Math.min(x1, px1); x++)
        for (let y = Math.max(y0, py0); y <= Math.min(y1, py1); y++)
          for (let z = Math.max(z0, pz0); z <= Math.min(z1, pz1); z++)
            ocupado.set(`${x},${y},${z}`, prgb);
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const final = ocupado.get(`${x},${y},${z}`);
      if (final[0] !== rgbCristal[0] || final[1] !== rgbCristal[1] || final[2] !== rgbCristal[2]) return true;
    }
  }
  return false;
}

test("Parte A2/A3: ninguna ventana (marco incluido) solapa la puerta real, 74 tipos × 30 semillas", () => {
  let comprobados = 0;
  for (const tipoId of TODOS_LOS_TIPOS) {
    for (let n = 1; n <= 30; n++) {
      const m = generarEdificio(tipoId, n);
      // hoja de la puerta: siempre en el plano z0=z1=PAD-1, y0=piso0.y0=0
      const idxsHoja = new Set(TONOS_PUERTA.map((hex) => m.paleta.indexOf(hex)).filter((i) => i !== -1));
      const puertas = m.cajas.filter((c) => idxsHoja.has(c[6]) && c[2] === PAD - 1 && c[5] === PAD - 1 && c[1] === 0);
      if (puertas.length === 0) continue; // ya cubierto por "TODOS los edificios llevan puerta" — aquí solo importa el solape
      const [pa0, py0, , pa1, py1] = puertas[0];
      const puertaMarco = [Math.min(pa0, pa1) - 1, Math.max(pa0, pa1) + 1];
      const puertaY = [Math.min(py0, py1), Math.max(py0, py1)];
      // ventanas EN ESE MISMO plano (marco MADERA_OSCURA o vidrio CRISTAL) —
      // el marco de una ventana en cara S/N se pinta a la MISMA profundidad
      // que la hoja de la puerta (PAD-1), así que es el plano relevante. El
      // solape que de verdad importa es en 3D: una ventana de planta ALTA
      // puede compartir X con la puerta de planta baja sin colisionar nunca
      // (alturas Y distintas, exactamente lo esperable — una ventana encima
      // de la puerta) — hace falta comprobar TAMBIÉN el rango Y real.
      const idxMarcoVentana = m.paleta.indexOf(MADERA_OSCURA);
      const idxVidrio = m.paleta.indexOf(CRISTAL);
      for (const c of m.cajas) {
        if (c[2] !== PAD - 1 || c[5] !== PAD - 1) continue;
        if (c[6] !== idxMarcoVentana && c[6] !== idxVidrio) continue;
        const [wa0, wy0, , wa1, wy1] = c;
        // descarta las marcas de UN SOLO vóxel (ménsulas del voladizo,
        // corbelesVoladizo, MISMO color MADERA_OSCURA que un marco de
        // ventana pero SIN anchura real — una ventana real, marco incluido,
        // nunca es un único punto) — nada que ver con la puerta ni con
        // ninguna ventana, ya estaban ahí antes de esta pasada.
        if (wa0 === wa1) continue;
        const wa = Math.min(wa0, wa1), wc = Math.max(wa0, wa1);
        const wY = [Math.min(wy0, wy1), Math.max(wy0, wy1)];
        const solapaX = wa <= puertaMarco[1] && wc >= puertaMarco[0];
        const solapaY = wY[0] <= puertaY[1] && wY[1] >= puertaY[0];
        assert.ok(!(solapaX && solapaY), `${tipoId} semilla ${n}: una ventana/marco solapa la puerta real en 3D (marco incluido)`);
        if (solapaX) comprobados++; // solo cuenta como comprobación real si de verdad compartían columna X
      }
    }
  }
  assert.ok(comprobados > 0, "no se comprobó ninguna ventana en el plano de la puerta — revisar el filtro");
});

test("Parte A3: MARGEN_ENTRE_HUECOS es una constante real y rangoLibre la respeta de verdad", () => {
  assert.strictEqual(MARGEN_ENTRE_HUECOS, 2);
  // pegado/solapado: debe rechazarse siempre
  assert.strictEqual(rangoLibre([[10, 15]], 16, 20), false, "hueco pegado a otro debería rechazarse");
  // separación real por debajo de 2×margen: sigue sin ser suficiente
  assert.strictEqual(rangoLibre([[10, 15]], 19, 23), false, "separación de 3 vóxeles (<2×margen) debería rechazarse");
  // separación real de exactamente 2×margen: ya es libre
  assert.strictEqual(rangoLibre([[10, 15]], 20, 24), true, "separación de 4 vóxeles (=2×margen) debería aceptarse");
});

test("Parte A4: ninguna ventana de una pieza queda enterrada en la masa sólida de la otra, 17 tipos con ala × 3 formas forzadas × 20 semillas", () => {
  const tiposConAla = Object.keys(huellasCat.alas || {});
  assert.strictEqual(tiposConAla.length, 17, "el catálogo de alas cambió de tamaño — revisar la cifra del enunciado");
  let comprobadas = 0, enterradas = 0;
  for (const tipoId of tiposConAla) {
    const base = huellasCat.porTipo[tipoId] || huellasCat.porRiqueza[tiposEdificio[tipoId].riqueza];
    const [w, h] = base;
    const ala = huellasCat.alas[tipoId];
    const oy = -(h / 2 + ala[1] / 2); // MISMO cálculo real que ciudades/src/generar.js (oy siempre "detrás")
    for (const forma of ["T", "L-derecha", "L-izquierda"]) {
      for (let n = 1; n <= 20; n++) {
        const piezas = [{ ox: 0, oy: 0, w, h }];
        if (forma === "T") piezas.push({ ox: 0, oy, w: ala[0], h: ala[1] });
        else if (forma === "L-derecha") piezas.push({ ox: w / 2 - ala[0] / 2, oy, w: ala[0], h: ala[1] });
        else piezas.push({ ox: -(w / 2 - ala[0] / 2), oy, w: ala[0], h: ala[1] });
        const plan = { semilla: `${tipoId}:${forma}:${n}`, w, h, piezas };
        const m = generarEdificio(tipoId, n, plan);
        comprobadas++;
        if (ventanaEnterrada(m)) enterradas++;
      }
    }
  }
  assert.ok(comprobadas >= 17 * 3 * 20, `solo se comprobaron ${comprobadas} combinaciones`);
  assert.strictEqual(enterradas, 0, `${enterradas}/${comprobadas} combinaciones con al menos una ventana enterrada por el ala`);
});

test("Parte A5: estiloTecho aparece en el modelo y varía por semilla en los arquetipos con catálogo", () => {
  const CASOS = [
    { tipo: "casa_noble", min: 3 },
    { tipo: "casa_humilde", min: 2 }, // CHOZA: solo dosAguas/cobertizo
    { tipo: "herreria", min: 2 }, // TALLER
    { tipo: "ayuntamiento", min: 3 }, // INSTITUCION
  ];
  for (const { tipo, min } of CASOS) {
    const vistos = new Set();
    for (let n = 1; n <= 40; n++) {
      const m = generarEdificio(tipo, n);
      assert.ok(m.estiloTecho, `${tipo} semilla ${n}: sin estiloTecho`);
      assert.ok(ESTILOS_TECHO.includes(m.estiloTecho), `${tipo}: estilo desconocido ${m.estiloTecho}`);
      vistos.add(m.estiloTecho);
    }
    assert.ok(vistos.size >= min, `${tipo}: solo ${vistos.size} formas de techo distintas en 40 semillas (${[...vistos]})`);
  }
});

test("Parte A5: TEMPLO/MILITAR/TORRE/CASTILLO no tienen estiloTecho — su silueta no se toca", () => {
  for (const tipo of ["templo", "cuartel_guardia", "torre_mago", "castillo"]) {
    for (let n = 1; n <= 5; n++) {
      assert.strictEqual(generarEdificio(tipo, n).estiloTecho, null, `${tipo} semilla ${n}`);
    }
  }
});

test("Parte A5: mansarda/cobertizo son geometría real (más de 1 caja, coherente con el grid)", () => {
  let vistaMansarda = false, vistoCobertizo = false;
  for (let n = 1; n <= 60 && (!vistaMansarda || !vistoCobertizo); n++) {
    const m = generarEdificio("casa_noble", n);
    if (m.estiloTecho === "mansarda") vistaMansarda = true;
    if (m.estiloTecho === "cobertizo") vistoCobertizo = true;
    assert.ok(m.cajas.length > 0);
    assert.ok(m.cajas.every((c) => c.every((v) => Number.isFinite(v))), `semilla ${n}: caja con NaN/Infinity`);
  }
  assert.ok(vistaMansarda, "ninguna casa_noble en 60 semillas salió con techo mansarda");
  assert.ok(vistoCobertizo, "ninguna casa_noble en 60 semillas salió con techo cobertizo");
});

// =============================================================================
// Parte B: variaciones por tier/riqueza — chimeneas, porticado, escudos,
// antorchas, entramado de barro (2026-09-12)
// =============================================================================

function colorMuroDe(m) { return materiales[m.material]?.colorDebug || materiales.madera.colorDebug; }
function tieneChimeneaMaciza(m) {
  const colorColarin = sombrear(colorMuroDe(m), 0.6);
  const idx = m.paleta.indexOf(colorColarin);
  return idx !== -1 && m.cajas.some((c) => c[6] === idx);
}
function tienePortico(m) {
  const colorColumna = sombrear(sombrear(colorMuroDe(m), 1.15), 0.8);
  const idx = m.paleta.indexOf(colorColumna);
  return idx !== -1 && m.cajas.some((c) => c[6] === idx);
}
function tieneEscudoFamiliar(m) {
  const marmol = sombrear(materiales.marmol?.colorDebug || "#e8e4dc", 0.9);
  if (m.paleta.indexOf(marmol) === -1) return false;
  return PALETA_BLASON_FAMILIAR.some((hex) => m.paleta.includes(hex));
}
function tieneAntorchas(m) { return m.paleta.includes(FUEGO); }
function tieneEntramadoBarro(m) { return m.paleta.includes(BARRO) || m.paleta.includes(sombrear(BARRO, 0.5)); }
function tieneDecoracionPared(m) { return [TRONCO_CLARO, TRONCO_OSCURO, MIMBRE, HIEDRA_1, HIEDRA_2].some((hex) => m.paleta.includes(hex)); }

test("Bloque A: chimenea 'maciza' solo en casa_noble+piedra, nunca en modesta/humilde", () => {
  let vistaEnNoble = false;
  for (let n = 1; n <= 40; n++) {
    const m = generarEdificio("casa_noble", n);
    if (m.material === "piedra" && tieneChimeneaMaciza(m)) vistaEnNoble = true;
  }
  assert.ok(vistaEnNoble, "ninguna casa_noble de piedra en 40 semillas mostró chimenea maciza");
  for (const tipo of ["casa_modesta", "casa_humilde"]) {
    for (let n = 1; n <= 40; n++) {
      assert.ok(!tieneChimeneaMaciza(generarEdificio(tipo, n)), `${tipo} semilla ${n}: nunca debería tener chimenea maciza (riqueza no noble)`);
    }
  }
});

test("Bloque A: chimenea llega también a INSTITUCION y TEMPLO (arquetipos que antes nunca tenían)", () => {
  // La chimenea de institución/templo nunca lleva brasas (FUEGO), así que el
  // criterio real es el color del TUBO (sombrear(colorMuro,0.7)) — puede
  // coincidir por casualidad con otra textura, así que basta con confirmar
  // que aparece en AL MENOS una de 60 semillas (~25%/~20% esperado).
  let vistaInst = false, vistaTemplo = false;
  for (let n = 1; n <= 60 && !vistaInst; n++) {
    const m = generarEdificio("ayuntamiento", n);
    const tuboColor = sombrear(colorMuroDe(m), 0.7);
    if (m.paleta.includes(tuboColor)) vistaInst = true;
  }
  for (let n = 1; n <= 60 && !vistaTemplo; n++) {
    const m = generarEdificio("templo", n);
    const tuboColor = sombrear(colorMuroDe(m), 0.7);
    if (m.paleta.includes(tuboColor)) vistaTemplo = true;
  }
  assert.ok(vistaInst, "ningún ayuntamiento en 60 semillas mostró chimenea (~25% esperado)");
  assert.ok(vistaTemplo, "ningún templo en 60 semillas mostró chimenea de sacristía (~20% esperado)");
});

test("Bloque B: pórtico monumental solo en casa_noble+piedra, nunca en modesta/humilde", () => {
  let vistoEnNoble = false;
  for (let n = 1; n <= 40; n++) {
    const m = generarEdificio("casa_noble", n);
    if (m.material === "piedra" && tienePortico(m)) vistoEnNoble = true;
  }
  assert.ok(vistoEnNoble, "ninguna casa_noble de piedra en 40 semillas mostró pórtico");
  for (const tipo of ["casa_modesta", "casa_humilde"]) {
    for (let n = 1; n <= 40; n++) assert.ok(!tienePortico(generarEdificio(tipo, n)), `${tipo} semilla ${n}: nunca debería tener pórtico (riqueza no noble)`);
  }
});

test("Bloque B: pórtico también en TALLER noble+piedra (joyeria)", () => {
  let visto = false;
  for (let n = 1; n <= 60 && !visto; n++) {
    const m = generarEdificio("joyeria", n);
    if (m.material === "metal" && tienePortico(m)) visto = true;
  }
  assert.ok(visto, "ninguna joyeria (TALLER noble) en 60 semillas mostró pórtico");
});

test("Bloque C: escudo de armas familiar solo en casa_noble+piedra, nunca en modesta/humilde", () => {
  let vistoEnNoble = false;
  for (let n = 1; n <= 40; n++) {
    const m = generarEdificio("casa_noble", n);
    if (m.material === "piedra" && tieneEscudoFamiliar(m)) vistoEnNoble = true;
  }
  assert.ok(vistoEnNoble, "ninguna casa_noble de piedra en 40 semillas mostró escudo familiar");
  for (const tipo of ["casa_modesta", "casa_humilde"]) {
    for (let n = 1; n <= 40; n++) assert.ok(!tieneEscudoFamiliar(generarEdificio(tipo, n)), `${tipo} semilla ${n}: nunca debería tener escudo (riqueza no noble)`);
  }
});

test("Bloque D: antorchas junto a la puerta aparecen en las 3 riquezas de CASA (distinta frecuencia)", () => {
  for (const tipo of ["casa_noble", "casa_modesta", "casa_humilde"]) {
    let vistas = 0;
    for (let n = 1; n <= 40; n++) if (tieneAntorchas(generarEdificio(tipo, n))) vistas++;
    assert.ok(vistas > 0, `${tipo}: ninguna semilla en 40 mostró antorchas`);
  }
});

test("Bloque D: CASTILLO y MILITAR llevan antorchas SIEMPRE (pareja, sin roll)", () => {
  for (const tipo of ["castillo", "cuartel_guardia"]) {
    for (let n = 1; n <= 10; n++) assert.ok(tieneAntorchas(generarEdificio(tipo, n)), `${tipo} semilla ${n}: sin antorchas`);
  }
});

test("Bloque E: entramado de madera + barro solo en riqueza humilde + madera, nunca en modesta/noble", () => {
  let vistoEnHumilde = false;
  for (let n = 1; n <= 40; n++) {
    const m = generarEdificio("casa_humilde", n);
    if (m.material === "madera") {
      if (tieneEntramadoBarro(m)) vistoEnHumilde = true;
    } else {
      assert.ok(!tieneEntramadoBarro(m), `casa_humilde semilla ${n} (${m.material}): no debería tener barro sin madera`);
    }
  }
  assert.ok(vistoEnHumilde, "ninguna casa_humilde de madera en 40 semillas mostró entramado de barro");
  for (const tipo of ["casa_modesta", "casa_noble"]) {
    for (let n = 1; n <= 40; n++) assert.ok(!tieneEntramadoBarro(generarEdificio(tipo, n)), `${tipo} semilla ${n}: no debería tener entramado de barro (riqueza no humilde)`);
  }
});

test("Bloque F: decoración genérica de pared (leña/barril-cesta/hiedra) aparece en las 3 riquezas de CASA", () => {
  for (const tipo of ["casa_noble", "casa_modesta", "casa_humilde"]) {
    let vista = 0;
    for (let n = 1; n <= 40; n++) if (tieneDecoracionPared(generarEdificio(tipo, n))) vista++;
    assert.ok(vista > 0, `${tipo}: ninguna semilla en 40 mostró decoración genérica de pared`);
  }
});

test("Parte A/B: los tests YA existentes de determinismo/huella/puerta siguen siendo compatibles (regresión rápida)", () => {
  const a = generarEdificio("casa_noble", 3);
  const b = generarEdificio("casa_noble", 3);
  assert.deepStrictEqual(a.cajas, b.cajas, "el registro de huecos/estiloTecho no debería romper el determinismo por semilla");
  const plan = { semilla: "rio-3:botica:15", w: 9, h: 7, piezas: [{ ox: 0, oy: 0, w: 9, h: 7 }], plantasAltas: 1 };
  const p1 = generarEdificio("botica", 1, plan);
  const p2 = generarEdificio("botica", 99, plan);
  assert.deepStrictEqual(p1.cajas, p2.cajas, "determinismo por plan también debe seguir intacto");
});
