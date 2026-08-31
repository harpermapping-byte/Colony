// Tests del bakeador de mazmorras (docs/GDD_Bakeador_Dungeons.md). Ejecutar:
// node --test mazmorras/test/mazmorra.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { generarMazmorra, bfsProfundidades, elegirAristasBucle, construirMST } = require("../src/generarMazmorra");
const { generarFormaOrganica } = require("../src/celular");
const { cargarCatalogos } = require("../../interiores/src/catalogo");

const catalogosInteriores = cargarCatalogos();
const tiposDungeon = require("../catalogo/tipos_dungeon.json");
const catalogosMazmorra = { tiposDungeon };
const enemigos = require("../../personajes/catalogo/enemigos.json");

// "asentamiento" (aldea_bandidos, poblado_orco...) NO pasa por este
// generador — reutiliza ciudades/hornearCiudad + interiores/generarEdificio
// para cada casa, igual que un POI aldea normal (solo cambia el tier y
// quién puebla las casas); generarMazmorra.js es solo para "cueva"/"edificio".
const TIPOS_IDS = Object.keys(tiposDungeon).filter(
  (k) => !k.startsWith("_") && tiposDungeon[k].estiloExterior !== "asentamiento",
);

test("celular.js: generarFormaOrganica siempre da una única región conexa, sin islas", () => {
  for (const semilla of ["a", "b", "c", "d", "e"]) {
    const { ancho, largo, mascara } = generarFormaOrganica({ ancho: 16, alto: 14, semilla });
    // flood-fill desde la primera casilla de suelo que encuentre
    const idxInicio = mascara.indexOf("1");
    assert.ok(idxInicio >= 0, `semilla ${semilla}: máscara sin ninguna casilla de suelo`);
    const visitado = new Uint8Array(ancho * largo);
    const cola = [idxInicio];
    visitado[idxInicio] = 1;
    let visitas = 1;
    while (cola.length) {
      const i = cola.pop();
      const x = i % ancho, y = Math.floor(i / ancho);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ancho || ny >= largo) continue;
        const k = ny * ancho + nx;
        if (visitado[k] || mascara[k] !== "1") continue;
        visitado[k] = 1; visitas++; cola.push(k);
      }
    }
    const totalSuelo = (mascara.match(/1/g) || []).length;
    assert.strictEqual(visitas, totalSuelo, `semilla ${semilla}: la máscara tiene más de una región (isla suelta)`);
  }
});

test("los 30 tipos de mazmorra del catálogo generan sin error, con varias semillas", () => {
  let generadas = 0;
  for (const tipoDungeonId of TIPOS_IDS) {
    for (const semilla of ["seed-1", "seed-2"]) {
      const m = generarMazmorra({ tipoDungeonId, catalogosMazmorra, catalogosInteriores, semilla });
      assert.ok(m.plantas.length >= 1, `${tipoDungeonId}/${semilla}: sin plantas`);
      for (const planta of m.plantas) {
        assert.ok(planta.salas.length >= 1, `${tipoDungeonId}/${semilla} nivel ${planta.nivel}: sin salas`);
      }
      generadas++;
    }
  }
  assert.strictEqual(generadas, TIPOS_IDS.length * 2);
});

test("misma semilla + mismo tipo = misma mazmorra byte a byte (determinismo)", () => {
  const a = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla: "determinismo" });
  const b = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla: "determinismo" });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

test("temasEnemigo/bossPool de cada tipo de mazmorra referencian enemigos reales del catálogo", () => {
  const idsValidos = new Set(Object.keys(enemigos).filter((k) => !k.startsWith("_")));
  const temasValidos = new Set();
  for (const def of Object.values(enemigos)) {
    if (!def.temasEnemigo) continue;
    for (const t of def.temasEnemigo) temasValidos.add(t);
  }
  for (const [id, def] of Object.entries(tiposDungeon)) {
    if (id.startsWith("_")) continue;
    for (const tema of def.temasEnemigo || []) {
      assert.ok(temasValidos.has(tema), `${id}: temasEnemigo "${tema}" no lo usa ningún enemigo del catálogo`);
    }
    for (const bossId of def.bossPool || []) {
      assert.ok(idsValidos.has(bossId), `${id}: bossPool referencia enemigo desconocido "${bossId}"`);
      assert.ok(enemigos[bossId].esBoss, `${id}: bossPool "${bossId}" no tiene esBoss:true en enemigos.json`);
    }
  }
});

// Reproduce la selección de enemigo que hace DungeonRoom.ts en runtime
// (temasEnemigo del spawn + esBoss) — mismo criterio, sin importar el
// server (TypeScript) desde este archivo JS.
function hayEnemigoParaTemas(temas, soloBosses) {
  return Object.values(enemigos).some(
    (def) => !!def.esBoss === soloBosses && (def.temasEnemigo || []).some((t) => temas.includes(t)),
  );
}

test("el slot de jefe de CADA tipo de mazmorra resuelve a un enemigo real en runtime (mismo filtro que DungeonRoom.ts)", () => {
  // Bug real encontrado con la prueba visual: el slot de jefe llevaba
  // temasEnemigo:def.bossPool (una lista de IDs de enemigo, no de temas) —
  // el filtro por tema de DungeonRoom nunca encontraba nada y el jefe no
  // aparecía nunca. Aquí se prueba con la MISMA mazmorra generada, no solo
  // el catálogo suelto, para que un futuro cambio de generarMazmorra.js que
  // reintroduzca el bug lo pille.
  for (const tipoDungeonId of TIPOS_IDS) {
    const def = tiposDungeon[tipoDungeonId];
    if (!def.bossPool?.length) continue;
    const m = generarMazmorra({ tipoDungeonId, catalogosMazmorra, catalogosInteriores, semilla: "boss-runtime-test" });
    for (const planta of m.plantas) {
      const bossSpawn = planta.spawnsEnemigos.find((s) => s.esBossSlot);
      if (!bossSpawn) continue;
      assert.ok(
        hayEnemigoParaTemas(bossSpawn.temasEnemigo, true),
        `${tipoDungeonId} nivel ${planta.nivel}: el slot de jefe (temas ${JSON.stringify(bossSpawn.temasEnemigo)}) no resuelve a ningún enemigo con esBoss:true`,
      );
    }
  }
});

// --- Profundidad BFS + bucles sobre el MST (pedido 2026-08-31) ---

test("bfsProfundidades: la raíz (sala 0) siempre tiene profundidad 0, y sube 1 por cada salto real en una cadena", () => {
  // 0-1-2-3 en cadena: profundidad 0,1,2,3
  const cadena = [[0, 1], [1, 2], [2, 3]];
  assert.deepStrictEqual(bfsProfundidades(4, cadena), [0, 1, 2, 3]);
});

test("bfsProfundidades: usa la ruta MÁS CORTA cuando hay varios caminos (no la primera que encuentra)", () => {
  // 0 conectado directo a 2 (profundidad 1) Y por 0-1-2 (profundidad 2 si fuera esa la única ruta) — BFS coge la corta.
  const grafo = [[0, 1], [1, 2], [0, 2]];
  assert.deepStrictEqual(bfsProfundidades(3, grafo), [0, 1, 1]);
});

test("bfsProfundidades: nodos sin aristas ni sea la raíz (grafo vacío) se quedan a profundidad 0, no revienta", () => {
  assert.deepStrictEqual(bfsProfundidades(1, []), [0]);
  assert.deepStrictEqual(bfsProfundidades(0, []), []);
});

function salaDePrueba(offsetX, offsetY, lado = 6) {
  return { offsetX, offsetY, resultado: { ancho: lado, largo: lado } };
}

test("elegirAristasBucle: con menos de 3 salas nunca añade bucles (no hay nada que rodear)", () => {
  const salas = [salaDePrueba(0, 0), salaDePrueba(10, 0)];
  const mst = construirMST(salas);
  assert.deepStrictEqual(elegirAristasBucle(salas, mst, () => 0), []);
});

test("elegirAristasBucle: nunca reinserta una arista que YA está en el MST", () => {
  const salas = [salaDePrueba(0, 0), salaDePrueba(10, 0), salaDePrueba(20, 0), salaDePrueba(30, 0), salaDePrueba(40, 0)];
  const mst = construirMST(salas);
  const conectadas = new Set(mst.map(([i, j]) => `${Math.min(i, j)}_${Math.max(i, j)}`));
  const bucles = elegirAristasBucle(salas, mst, () => 0); // rnd()=0 siempre pasa el filtro de probabilidad: caso "más bucles posibles"
  for (const [i, j] of bucles) {
    assert.ok(!conectadas.has(`${Math.min(i, j)}_${Math.max(i, j)}`), `[${i},${j}] ya estaba en el MST — no debería reinsertarse`);
  }
});

test("elegirAristasBucle: con rnd()=1 (nunca pasa la probabilidad) no añade ningún bucle", () => {
  const salas = [salaDePrueba(0, 0), salaDePrueba(10, 0), salaDePrueba(20, 0), salaDePrueba(30, 0)];
  const mst = construirMST(salas);
  assert.deepStrictEqual(elegirAristasBucle(salas, mst, () => 0.999999), []);
});

test("elegirAristasBucle: nunca supera el tope proporcional al número de salas", () => {
  // salas en rejilla — muchos pares "cercanos" candidatos, para forzar el tope en vez del filtro de cercanía
  const salas = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 4; y++) salas.push(salaDePrueba(x * 10, y * 10));
  const mst = construirMST(salas);
  const bucles = elegirAristasBucle(salas, mst, () => 0); // siempre pasa el filtro de probabilidad
  assert.ok(bucles.length <= Math.floor(salas.length * 0.25) + 1, `demasiados bucles: ${bucles.length} para ${salas.length} salas`);
});

test("salas más profundas en el grafo tienden a ser más grandes que las cercanas a la entrada (mazmorras orgánicas, muestra estadística)", () => {
  // No es determinista sala a sala (hay ruido aleatorio dentro del rango),
  // pero en agregado sobre varias mazmorras/semillas el área media de las
  // salas más profundas debe ser mayor que la de las más cercanas a la
  // entrada — si esto falla, el sesgo por profundidad se rompió.
  let areaSumaCercanas = 0, nCercanas = 0;
  let areaSumaProfundas = 0, nProfundas = 0;
  for (const semilla of ["prof-1", "prof-2", "prof-3", "prof-4", "prof-5"]) {
    const m = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla });
    for (const planta of m.plantas) {
      if (planta.salas.length < 4) continue;
      const aristasMST = construirMST(planta.salas.map((s) => ({ offsetX: s.offsetX, offsetY: s.offsetY, resultado: s.resultado })));
      const profundidades = bfsProfundidades(planta.salas.length, aristasMST);
      const maxProf = Math.max(1, ...profundidades);
      planta.salas.forEach((s, idx) => {
        const area = s.resultado.ancho * s.resultado.largo;
        const factor = profundidades[idx] / maxProf;
        if (factor <= 0.25) { areaSumaCercanas += area; nCercanas++; }
        else if (factor >= 0.75) { areaSumaProfundas += area; nProfundas++; }
      });
    }
  }
  assert.ok(nCercanas > 3 && nProfundas > 3, "muestra insuficiente — ajustar semillas/tipo si esto falla");
  const mediaCercanas = areaSumaCercanas / nCercanas;
  const mediaProfundas = areaSumaProfundas / nProfundas;
  assert.ok(mediaProfundas > mediaCercanas, `esperaba salas profundas más grandes en media (cercanas=${mediaCercanas.toFixed(1)}, profundas=${mediaProfundas.toFixed(1)})`);
});

// La conectividad REAL (flood-fill contra la rejilla de colisión que carga
// el servidor) se prueba en server/test/mazmorra.test.ts — cargarInterior
// es TypeScript y este archivo corre con node --test plano (sin tsx),
// mismo motivo por el que interiores/ y server/ ya separan sus suites.
