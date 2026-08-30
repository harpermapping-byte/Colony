#!/usr/bin/env node
// Genera DOS mapas de prueba MINIMOS (16x16 casillas, 100% agua) para
// probar de punta a punta el cruce de un borde mar_abierto en barco (docs/
// GDD_Barcos.md, pedido 2026-08-30). No usa el pipeline completo del
// bakeador (Perlin/hidrología/caminos/POIs no aportan nada aquí, y no hay
// forma barata de garantizar una franja de agua real hasta el borde con
// terreno procedural) — escribe directamente el índice + UN sector con la
// forma exacta que espera server/src/mundo/mapaColision.ts. Bake pequeño de
// prueba (CLAUDE.md: "los agentes solo hacen bakes pequeños de prueba"),
// no de producción.
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const ANCHO_CHUNKS = 1;
const ALTO_CHUNKS = 1;
const TAMANO_CHUNK = 16;
const TAMANO_SECTOR_CHUNKS = 1;

function escribirMapa(nombre, bordes) {
  const carpeta = path.join(RAIZ, "assets", "mapas", nombre);
  fs.mkdirSync(carpeta, { recursive: true });

  const indice = {
    version: 1,
    tamanoSectorChunks: TAMANO_SECTOR_CHUNKS,
    leyendaTerreno: ["agua"],
    nombre,
    semilla: `${nombre}-01`,
    anchoChunks: ANCHO_CHUNKS,
    altoChunks: ALTO_CHUNKS,
    tamanoChunk: TAMANO_CHUNK,
    biomasHabilitados: ["costa"],
    bordes,
  };
  fs.writeFileSync(path.join(carpeta, "indice.json"), JSON.stringify(indice, null, 2));

  const terreno = "0".repeat(TAMANO_CHUNK * TAMANO_CHUNK); // índice 0 = "agua" en leyendaTerreno
  const sector = { chunks: { "0_0": { terreno, tamano: TAMANO_CHUNK, objetos: [] } } };
  fs.writeFileSync(path.join(carpeta, "sector_000_000.json"), JSON.stringify(sector));

  console.log(`mapa de prueba "${nombre}" (${ANCHO_CHUNKS * TAMANO_CHUNK}x${ALTO_CHUNKS * TAMANO_CHUNK} casillas, 100% agua) -> ${carpeta}`);
}

escribirMapa("test_mar_a", {
  norte: { tipo: "cerrado", nombre: null },
  sur: { tipo: "cerrado", nombre: null },
  este: { tipo: "mar_abierto", nombre: "test_mar_b" },
  oeste: { tipo: "cerrado", nombre: null },
});
escribirMapa("test_mar_b", {
  norte: { tipo: "cerrado", nombre: null },
  sur: { tipo: "cerrado", nombre: null },
  este: { tipo: "cerrado", nombre: null },
  oeste: { tipo: "mar_abierto", nombre: "test_mar_a" },
});
