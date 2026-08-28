"use strict";

// Tests de la herramienta de parcelas (node --test parcelas/test/parcelas.test.js).
// Tres frentes: la máscara (roundtrip runs↔casillas del GDD §1), la varita
// (respeta vetos y objetivo sobre un fixture sintético) y el parcelas.json
// DEMO validado contra el MAPA REAL — si alguien rebakea el mapa y las
// parcelas caen sobre un río nuevo, esto lo grita.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const Mascara = require("../src/mascara");
const { crecimientoParcela, terrenoVetado } = require("../src/varita");
const { crearLectorMapa, validarParcelas } = require("../gui/servidor");
const { crearPRNG } = require("../../interiores/src/azar");

const RAIZ_REPO = path.join(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ_REPO, "assets", "mapas", "principal");
const RUTA_DEMO = path.join(RUTA_MAPA, "parcelas.json");

// ---------------------------------------------------------------------------
test("mascara: roundtrip runs → casillas → runs idéntico", () => {
  const ancho = 100;
  const runs = [
    [5, 10, 20],
    [6, 8, 25],
    [6, 30, 30], // dos runs en la misma fila (hueco en medio)
    [7, 12, 12],
  ];
  const casillas = Mascara.desdeRuns(runs, ancho);
  assert.equal(casillas.size, 11 + 18 + 1 + 1);
  assert.deepEqual(Mascara.aRuns(casillas, ancho), runs);
});

test("mascara: añadir/quitar/contar y fusión de runs contiguos", () => {
  const ancho = 50;
  const casillas = new Set();
  Mascara.anadir(casillas, 3, 2, ancho);
  Mascara.anadir(casillas, 5, 2, ancho);
  Mascara.anadir(casillas, 4, 2, ancho); // rellena el hueco: los 3 deben fundirse en un run
  assert.equal(Mascara.contar(casillas), 3);
  assert.deepEqual(Mascara.aRuns(casillas, ancho), [[2, 3, 5]]);
  Mascara.quitar(casillas, 4, 2, ancho); // vuelve a partir el run en dos
  assert.deepEqual(Mascara.aRuns(casillas, ancho), [[2, 3, 3], [2, 5, 5]]);
});

test("mascara: índice de pertenencia con clave numérica y*ancho+x", () => {
  const ancho = 40;
  const indice = Mascara.construirIndice(
    { p_0001: { runs: [[1, 2, 4]] }, p_0002: { runs: [[3, 0, 0]] } },
    ancho
  );
  assert.equal(indice.get(1 * ancho + 3), "p_0001");
  assert.equal(indice.get(3 * ancho + 0), "p_0002");
  assert.equal(indice.get(0), undefined);
  assert.equal(indice.size, 4);
});

// ---------------------------------------------------------------------------
test("terrenoVetado: reglas del GDD §1 sobre el catálogo real de terrenos", () => {
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json"), "utf8"));
  assert.ok(terrenoVetado("camino", terrenos.camino));
  assert.ok(terrenoVetado("puente", terrenos.puente));
  assert.ok(terrenoVetado("agua", terrenos.agua)); // requiereNadar
  assert.ok(terrenoVetado("roca_inaccesible", terrenos.roca_inaccesible)); // transitable false
  assert.ok(terrenoVetado("terreno_inventado", undefined)); // desconocido = vetado
  assert.ok(!terrenoVetado("cesped", terrenos.cesped));
  assert.ok(!terrenoVetado("roca", terrenos.roca)); // transitable aunque lento
});

test("varita: respeta vetadas y para en el objetivo (fixture sintético)", () => {
  // Mapa 20x20 con un "río" vertical en x=10: la varita sembrada a la
  // izquierda no puede cruzarlo jamás.
  const ancho = 20;
  const esValida = (x, y) => x >= 0 && y >= 0 && x < ancho && y < 20 && x !== 10;
  const { casillas, completo } = crecimientoParcela({
    esValida,
    semillaX: 4,
    semillaY: 10,
    objetivo: 60,
    rnd: crearPRNG("test-varita"),
    anchoMapa: ancho,
  });
  assert.ok(completo);
  assert.equal(casillas.size, 60);
  for (const k of casillas) {
    const { x, y } = Mascara.coordenadas(k, ancho);
    assert.ok(esValida(x, y), `casilla vetada colada: (${x},${y})`);
    assert.ok(x < 10, `cruzó el río: (${x},${y})`); // conexión: solo el lado de la semilla
  }
  // Conexidad: toda casilla (salvo la semilla) tiene una vecina en el conjunto
  for (const k of casillas) {
    const { x, y } = Mascara.coordenadas(k, ancho);
    if (x === 4 && y === 10) continue;
    const vecina = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => casillas.has((y + dy) * ancho + (x + dx)));
    assert.ok(vecina, `casilla suelta: (${x},${y})`);
  }
});

test("varita: determinista (misma semilla PRNG = mismas casillas) y distinta con otra", () => {
  const esValida = (x, y) => x >= 0 && y >= 0 && x < 30 && y < 30;
  const correr = (s) => crecimientoParcela({ esValida, semillaX: 15, semillaY: 15, objetivo: 50, rnd: crearPRNG(s), anchoMapa: 30 }).casillas;
  assert.deepEqual([...correr("a")].sort(), [...correr("a")].sort());
  assert.notDeepEqual([...correr("a")].sort(), [...correr("b")].sort());
});

test("varita: frontera agotada → completo=false con todo lo alcanzable", () => {
  // Isla de 3x3 válida: objetivo 50 imposible, debe devolver las 9 y avisar.
  const esValida = (x, y) => x >= 5 && x <= 7 && y >= 5 && y <= 7;
  const { casillas, completo } = crecimientoParcela({ esValida, semillaX: 6, semillaY: 6, objetivo: 50, rnd: crearPRNG("isla"), anchoMapa: 20 });
  assert.equal(completo, false);
  assert.equal(casillas.size, 9);
});

test("varita: semilla vetada → conjunto vacío", () => {
  const { casillas, completo } = crecimientoParcela({ esValida: () => false, semillaX: 0, semillaY: 0, objetivo: 10, rnd: crearPRNG("x"), anchoMapa: 10 });
  assert.equal(casillas.size, 0);
  assert.equal(completo, false);
});

// ---------------------------------------------------------------------------
test("demo: parcelas.json del mapa principal es válido contra el mapa REAL", () => {
  assert.ok(fs.existsSync(RUTA_DEMO), "falta assets/mapas/principal/parcelas.json — ejecutar node parcelas/src/generar_demo.js");
  const datos = JSON.parse(fs.readFileSync(RUTA_DEMO, "utf8"));
  const lector = crearLectorMapa(RUTA_MAPA);
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json"), "utf8"));

  // La validación completa del servidor: dentro del mapa, 0 vetadas, 0
  // solapes, `casillas` coherente con los runs, topeProps entero.
  const veredicto = validarParcelas(datos, lector, terrenos);
  assert.ok(veredicto.ok, veredicto.motivo);

  const ids = Object.keys(datos.parcelas);
  assert.equal(ids.length, 3);
  assert.equal(datos.siguienteId, 4);
  for (const id of ids) {
    const p = datos.parcelas[id];
    assert.equal(p.asentamiento, "ciudad");
    assert.ok(p.nombre.length > 0);
    assert.equal(p.topeProps, Math.round(p.casillas / 5), `${id}: topeProps debe ser casillas/5 redondeado`);
    // Cerca de la ciudad (1600,1600): toda casilla a menos de 200 de distancia Chebyshev
    for (const [y, x0, x1] of p.runs) {
      assert.ok(Math.abs(y - 1600) < 200 && Math.abs(x0 - 1600) < 200 && Math.abs(x1 - 1600) < 200, `${id}: run lejos de la ciudad`);
    }
  }
});

test("demo: validarParcelas rechaza un solape y una casilla vetada", () => {
  const lector = crearLectorMapa(RUTA_MAPA);
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json"), "utf8"));
  const datos = JSON.parse(fs.readFileSync(RUTA_DEMO, "utf8"));

  // Solape: duplica la primera parcela con otro id
  const primeraId = Object.keys(datos.parcelas)[0];
  const conSolape = JSON.parse(JSON.stringify(datos));
  conSolape.parcelas.p_9999 = JSON.parse(JSON.stringify(datos.parcelas[primeraId]));
  const v1 = validarParcelas(conSolape, lector, terrenos);
  assert.equal(v1.ok, false);
  assert.match(v1.motivo, /solapa/);

  // Vetada: fuera del mapa directamente
  const fuera = JSON.parse(JSON.stringify(datos));
  fuera.parcelas[primeraId].runs.push([99999, 0, 0]);
  fuera.parcelas[primeraId].casillas += 1;
  const v2 = validarParcelas(fuera, lector, terrenos);
  assert.equal(v2.ok, false);
  assert.match(v2.motivo, /fuera del mapa/);
});
