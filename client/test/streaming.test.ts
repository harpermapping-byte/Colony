import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamingSectores } from "../src/mapa/streamingSectores";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

// Suite del streaming de sectores — la mecánica principal de carga del mapa
// (GDD_Motor_3D_Props). Se prueba la LÓGICA pura con fetch/materializar
// falsos e instantáneos: qué sectores se piden, materializan y sueltan al
// caminar, la histéresis en fronteras y que la caché evita refetches.
// Ejecutar: node --import tsx --test client/test/streaming.test.ts

// Índice con la MISMA geometría que el mapa principal real:
// 100x100 chunks de 32, sectores de 10 chunks → 10x10 sectores de 320 casillas.
const INDICE: IndiceMapa = {
  version: 1,
  nombre: "test",
  semilla: "s",
  anchoChunks: 100,
  altoChunks: 100,
  tamanoChunk: 32,
  tamanoSectorChunks: 10,
  leyendaTerreno: ["cesped"],
};

function sectorFalso(sx: number, sy: number): SectorBakeado {
  return { sectorX: sx, sectorY: sy, chunks: {} };
}

interface Registro {
  fetches: string[];
  materializados: Set<string>;
  soltados: string[];
}

function crearStreaming(registro: Registro) {
  return new StreamingSectores<string>({
    indice: INDICE,
    obtenerSector: async (sx, sy) => {
      registro.fetches.push(`${sx}_${sy}`);
      return sectorFalso(sx, sy);
    },
    materializar: async (sector) => {
      const k = `${sector.sectorX}_${sector.sectorY}`;
      registro.materializados.add(k);
      return k;
    },
    soltar: (k) => {
      registro.materializados.delete(k);
      registro.soltados.push(k);
    },
  });
}

// Los callbacks son async — un microtick da tiempo a que resuelvan todos.
const asentar = () => new Promise((r) => setTimeout(r, 0));

test("en el centro de un sector se materializa el anillo 3x3 completo", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  streaming.actualizar(1760, 1760); // centro del sector (5,5): 1600 + 160
  await asentar();
  assert.equal(registro.materializados.size, 9);
  for (const sy of [4, 5, 6]) for (const sx of [4, 5, 6]) assert.ok(registro.materializados.has(`${sx}_${sy}`), `falta ${sx}_${sy}`);
});

test("el spawn real (ciudad en 1600,1600, esquina de 4 sectores) materializa esos 4", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  streaming.actualizar(1600, 1600); // la casilla 1600 es la juntura de (4,4)(5,4)(4,5)(5,5)
  await asentar();
  assert.equal(registro.materializados.size, 4);
  for (const k of ["4_4", "5_4", "4_5", "5_5"]) assert.ok(registro.materializados.has(k), `falta ${k}`);
});

test("en una esquina del mapa, lejos de fronteras, basta el propio sector", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  streaming.actualizar(10, 10); // sector (0,0); el vecino (1,0) empieza a 310 casillas — fuera del radio
  await asentar();
  assert.equal(registro.materializados.size, 1);
  assert.ok(registro.materializados.has("0_0"));
});

test("histéresis: pasearse pegado a una frontera no suelta ni recarga nada", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  streaming.actualizar(1760, 1760);
  await asentar();
  // Ir y volver sobre la frontera x=1920 entre los sectores (5,5) y (6,5).
  for (const x of [1900, 1940, 1900, 1940, 1900]) {
    streaming.actualizar(x, 1760);
    await asentar();
  }
  assert.equal(registro.soltados.length, 0, "la histéresis debe impedir soltar en la frontera");
  // La columna 6 (por delante) está cargada sin haber soltado la 4 (por
  // detrás, a ~300 casillas: entre el radio de carga y el de descarga).
  assert.ok(registro.materializados.has("6_5"));
  assert.ok(registro.materializados.has("4_5"));
});

test("caminata larga: lo dejado atrás se suelta y la memoria se mantiene acotada", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  let maximo = 0;
  // Cruzar la isla de oeste a este por el centro de la fila 5 (3200 casillas).
  for (let x = 160; x < 3200; x += 32) {
    streaming.actualizar(x, 1760);
    await asentar();
    maximo = Math.max(maximo, registro.materializados.size);
  }
  assert.ok(registro.soltados.length >= 18, `deben soltarse las columnas dejadas atrás (soltados=${registro.soltados.length})`);
  assert.ok(maximo <= 12, `pico de sectores materializados acotado (fue ${maximo})`);
  // Al final (borde este) ya no queda nada del oeste.
  assert.ok(!registro.materializados.has("0_5"));
  assert.ok(registro.materializados.has("9_5"));
});

test("volver sobre tus pasos re-materializa desde caché, sin refetch", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  streaming.actualizar(1760, 1760);
  await asentar();
  // Alejarse tres sectores hacia el este (se suelta la columna 4) y volver.
  for (let x = 1760; x <= 2880; x += 32) {
    streaming.actualizar(x, 1760);
    await asentar();
  }
  assert.ok(registro.soltados.includes("4_5"), "la columna 4 debió soltarse al alejarse");
  const fetchesAntesDeVolver = registro.fetches.length;
  for (let x = 2880; x >= 1760; x -= 32) {
    streaming.actualizar(x, 1760);
    await asentar();
  }
  assert.ok(registro.materializados.has("4_5"), "al volver, la columna 4 se re-materializa");
  const previos = new Set(registro.fetches.slice(0, fetchesAntesDeVolver));
  const refetches = registro.fetches.slice(fetchesAntesDeVolver).filter((k) => previos.has(k));
  assert.equal(refetches.length, 0, `sin refetch de sectores ya cacheados (hubo: ${refetches.join(", ")})`);
});

test("cada sector se fetchea como mucho una vez aunque el anillo se reevalúe muchas veces", async () => {
  const registro: Registro = { fetches: [], materializados: new Set(), soltados: [] };
  const streaming = crearStreaming(registro);
  for (let i = 0; i < 10; i++) {
    streaming.actualizar(1760 + (i % 2) * 20, 1760);
    await asentar();
  }
  const unicos = new Set(registro.fetches);
  assert.equal(registro.fetches.length, unicos.size, "ningún sector se pidió dos veces");
});
