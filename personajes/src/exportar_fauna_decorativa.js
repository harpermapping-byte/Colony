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

// ¿Se agrupa en manada al vagabundear? (2026-09-09, pedido streamer: "la
// fauna decorativa se debe mover... los patrones de manada que ya
// pusimos") — MISMA regla exacta que `esGregario` en
// server/src/mundo/faunaSalvajeViva.ts (fauna VIVA), para que el
// movimiento cliente-only de la fauna decorativa se vea igual de creíble:
// nunca carnívoros ni especies peligrosas (esos vagabundean solos, no
// forman manada). La fauna decorativa nunca es "cría" (el bake solo coloca
// adultos), así que ese tercer caso de la regla del servidor no aplica aquí.
function esGregaria(especieId) {
  const especie = catalogos.animalesBaker[especieId];
  if (!especie) return false;
  return especie.dieta !== "carnivoro" && !especie.peligroso;
}

// ¿Especie acuática? (bug real reportado jugando 2026-09-09: "los peces se
// salen fuera del agua, solo pueden estar dentro del agua") — el vagabundeo
// de fauna decorativa (sectorVisual.ts::crearComprobadorTransitableFauna)
// usaba UN SOLO criterio de transitabilidad para toda especie (tierra sí,
// agua no), correcto para animales terrestres pero exactamente al revés
// para peces/fauna marina (`requiereAgua` en baker/catalogo/animales.json)
// — necesitan el criterio INVERTIDO (agua sí, tierra no). Se exporta aquí
// (no en el cliente) por el mismo motivo que `gregarioPorEspecie`: cero
// catálogo de `baker/` duplicado en el bundle del cliente.
function esAcuatica(especieId) {
  const especie = catalogos.animalesBaker[especieId];
  return !!especie?.requiereAgua;
}

function exportarPool() {
  const pool = {};
  const gregarioPorEspecie = {};
  const acuaticoPorEspecie = {};
  const especies = Object.keys(catalogos.animalesBaker).filter((k) => !k.startsWith("_"));
  for (const especieId of especies) {
    if (!catalogos.animalesRig[especieId]) continue; // defensivo: hoy las 189/189 especies tienen rig (ver CLAUDE.md 2026-09-08)
    const variantes = catalogos.animalesBaker[especieId].variantes || 1;
    pool[especieId] = [];
    for (let i = 0; i < variantes; i++) {
      const generado = generarAnimal(especieId, { catalogos, semilla: `fauna-decorativa-${especieId}-${i}` });
      pool[especieId].push({ ficha: generado.ficha, piezas: generado.piezas });
    }
    gregarioPorEspecie[especieId] = esGregaria(especieId);
    acuaticoPorEspecie[especieId] = esAcuatica(especieId);
  }
  return { pool, gregarioPorEspecie, acuaticoPorEspecie };
}

module.exports = { exportarPool };

if (require.main === module) {
  const { pool, gregarioPorEspecie, acuaticoPorEspecie } = exportarPool();
  const carpeta = path.join(__dirname, "..", "..", "assets", "animales");
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, "pool.json");
  fs.writeFileSync(
    ruta,
    JSON.stringify(
      { _nota: "Generado por personajes/src/exportar_fauna_decorativa.js — NO editar a mano.", pool, gregarioPorEspecie, acuaticoPorEspecie },
      redondear,
    ),
  );
  const totalEspecies = Object.keys(pool).length;
  const totalVariantes = Object.values(pool).reduce((n, v) => n + v.length, 0);
  const totalGregarias = Object.values(gregarioPorEspecie).filter(Boolean).length;
  const totalAcuaticas = Object.values(acuaticoPorEspecie).filter(Boolean).length;
  console.log(`${totalEspecies} especies x variantes reales -> ${totalVariantes} variantes totales (${totalGregarias} gregarias, ${totalAcuaticas} acuáticas) -> ${ruta}`);
}
