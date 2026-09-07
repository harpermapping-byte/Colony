"use strict";
// Exporta naturaleza_generada.json (generar_naturaleza.js todo) a .glb,
// separando por catálogo de origen (vegetacion.json vs rocas.json) porque
// el cliente los lee de DOS carpetas de assets distintas
// (assets/vegetacion/, assets/rocas/) — a diferencia de muebles/edificios,
// que van todos a una única carpeta.
//
//   node exportar_naturaleza.js

const fs = require("fs");
const path = require("path");
const { exportarModelo } = require("./exportar_glb");

const vegetacion = require("../baker/catalogo/vegetacion.json");
const rocas = require("../baker/catalogo/rocas.json");
const modelos = require("./naturaleza_generada.json");

const idsVegetacion = new Set(Object.keys(vegetacion).filter((k) => !k.startsWith("_")));
const idsRocas = new Set(Object.keys(rocas).filter((k) => !k.startsWith("_")));

function nombreSalida(clave) {
  const m = clave.match(/^(.*)_(\d{2})$/);
  return m ? `${m[1]}_${m[2]}.glb` : `${clave}_01.glb`;
}

function exportarA(carpetaSalida, filtro) {
  fs.mkdirSync(carpetaSalida, { recursive: true });
  let n = 0;
  let bytes = 0;
  for (const [clave, modelo] of Object.entries(modelos)) {
    const idBase = clave.replace(/_\d{2}$/, "");
    if (!filtro(idBase)) continue;
    const archivo = nombreSalida(clave);
    const unit = 1 / (modelo.resolucion || 10);
    const stats = exportarModelo(modelo, clave, path.join(carpetaSalida, archivo), unit, false);
    bytes += stats.bytes;
    n++;
  }
  return { n, bytes };
}

const vegRes = exportarA(path.join(__dirname, "..", "assets", "vegetacion"), (id) => idsVegetacion.has(id));
const rocaRes = exportarA(path.join(__dirname, "..", "assets", "rocas"), (id) => idsRocas.has(id));
console.log(`vegetacion: ${vegRes.n} .glb (${Math.round(vegRes.bytes / 1024)} KB) -> assets/vegetacion/`);
console.log(`rocas: ${rocaRes.n} .glb (${Math.round(rocaRes.bytes / 1024)} KB) -> assets/rocas/`);
const total = Object.keys(modelos).length;
const cubiertos = vegRes.n + rocaRes.n;
if (cubiertos !== total) {
  console.warn(`AVISO: ${total - cubiertos} de ${total} modelos generados no encajaron en ningún catálogo (¿id nuevo sin migrar?)`);
}
