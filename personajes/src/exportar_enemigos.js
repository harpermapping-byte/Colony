"use strict";

// Exporta un POOL de variantes ya vestidas/con vóxeles resueltos de CADA
// enemigo de personajes/catalogo/enemigos.json a assets/enemigos/pool.json
// — mismo criterio de "generar una vez, el cliente solo lee" que
// exportar_demo.js/poblacion/exportarAsentamiento.js: la mazmorra decide en
// RUNTIME qué enemigo aparece dónde (docs/GDD_Bakeador_Dungeons.md §4.2),
// pero el ASPECTO de cada variante se genera aquí, offline, una vez.
//   node personajes/src/exportar_enemigos.js [numeroVariantes=4]

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarEnemigo } = require("./generarEnemigo");
const { cargarCatalogos: cargarCatalogosRopa } = require("../../ropa/src/catalogo");
const { generarPrenda } = require("../../ropa/src/generarPrenda");

const catalogos = cargarCatalogos();
const catalogosRopa = cargarCatalogosRopa();

// Mismo criterio que exportar_demo.js: material preferido del "oficio" (aquí
// no hay profesión real, así que cualquier prenda usa su primer material
// compatible — un enemigo no necesita vestuario de gremio).
function resolverMaterial(prendaId) {
  const prenda = catalogosRopa.prendas[prendaId];
  return prenda.materialesCompatibles[0];
}

const soloCampoCliente = ({ x, y, z, tam, color, pivote }) => ({ x, y, z, tam, color, pivote });
const redondear = (_clave, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v);

function exportarVariante(enemigoId, semilla) {
  const generado = generarEnemigo(enemigoId, { catalogos, semilla });
  if (generado.tipoRig === "animal") {
    return { tipoRig: "animal", ficha: generado.ficha, piezas: generado.piezas };
  }
  const ropa = (generado.ficha.ropa || []).map((prendaId) => {
    const materialId = resolverMaterial(prendaId);
    const prenda = generarPrenda(prendaId, {
      catalogos: catalogosRopa, semilla, materialId, morfologia: generado.ficha.morfologia,
    });
    return { prendaId, materialId, voxeles: prenda.voxeles.map(soloCampoCliente) };
  });
  return {
    tipoRig: "npc",
    ficha: generado.ficha,
    voxelesCabeza: generado.voxelesCabeza.map(soloCampoCliente),
    ropa,
  };
}

function exportarPool(numeroVariantes = 4) {
  const pool = {};
  for (const enemigoId of Object.keys(catalogos.enemigos).filter((k) => !k.startsWith("_"))) {
    pool[enemigoId] = [];
    for (let i = 0; i < numeroVariantes; i++) {
      pool[enemigoId].push(exportarVariante(enemigoId, `enemigo-pool-${enemigoId}-${i}`));
    }
  }
  return pool;
}

module.exports = { exportarPool };

if (require.main === module) {
  const numeroVariantes = Number(process.argv[2]) || 4;
  const pool = exportarPool(numeroVariantes);
  const carpeta = path.join(__dirname, "..", "..", "assets", "enemigos");
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, "pool.json");
  fs.writeFileSync(
    ruta,
    JSON.stringify({ _nota: "Generado por personajes/src/exportar_enemigos.js — NO editar a mano.", variantesPorEnemigo: numeroVariantes, pool }, redondear),
  );
  const totalTipos = Object.keys(pool).length;
  console.log(`${totalTipos} tipos de enemigo x ${numeroVariantes} variantes -> ${ruta}`);
}
