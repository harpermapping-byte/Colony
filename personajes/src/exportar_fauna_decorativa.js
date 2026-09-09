"use strict";

// Exporta un POOL de variantes de vóxeles ya resueltas de CADA especie de
// fauna DECORATIVA (baker/catalogo/animales.json) a assets/animales/pool.json
// — mismo criterio "generar una vez, el cliente solo lee" que
// exportar_enemigos.js/exportarAsentamiento.js. Distinto de la fauna VIVA
// simulada (server/src/mundo/faunaSalvajeSector.ts + client animalVoxel.ts,
// que generan/consumen por individuo): esto es la decoración de fondo que
// coloca baker/src/decoracion.js (obj.t==="a" en el sector bakeado, SOLO
// posición/especie/variante — sin vóxeles propios), así que necesita un
// pool compartido indexado por especie+variante para que sectorVisual.ts
// pueda materializarla sin generar nada en vivo.
//
// El número de variantes por especie es el mismo campo `variantes` que ya
// vive en animales.json (pensado para nombrar `<especie>_NN.glb`, nunca
// usado hasta ahora porque nunca hubo arte real) — un `obj.va` bakeado
// siempre cae dentro de rango, sin módulo ni fallback.
//   node personajes/src/exportar_fauna_decorativa.js

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarAnimal } = require("./generarAnimal");

const catalogos = cargarCatalogos();

const redondear = (_clave, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v);

function exportarPool() {
  const pool = {};
  const especies = Object.keys(catalogos.animalesBaker).filter((k) => !k.startsWith("_"));
  for (const especieId of especies) {
    if (!catalogos.animalesRig[especieId]) continue; // defensivo: hoy las 189/189 especies tienen rig (ver CLAUDE.md 2026-09-08)
    const variantes = catalogos.animalesBaker[especieId].variantes || 1;
    pool[especieId] = [];
    for (let i = 0; i < variantes; i++) {
      const generado = generarAnimal(especieId, { catalogos, semilla: `fauna-decorativa-${especieId}-${i}` });
      pool[especieId].push({ ficha: generado.ficha, piezas: generado.piezas });
    }
  }
  return pool;
}

module.exports = { exportarPool };

if (require.main === module) {
  const pool = exportarPool();
  const carpeta = path.join(__dirname, "..", "..", "assets", "animales");
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, "pool.json");
  fs.writeFileSync(
    ruta,
    JSON.stringify({ _nota: "Generado por personajes/src/exportar_fauna_decorativa.js — NO editar a mano.", pool }, redondear),
  );
  const totalEspecies = Object.keys(pool).length;
  const totalVariantes = Object.values(pool).reduce((n, v) => n + v.length, 0);
  console.log(`${totalEspecies} especies x variantes reales -> ${totalVariantes} variantes totales -> ${ruta}`);
}
