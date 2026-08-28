"use strict";
// Exporta TODOS los modelos de un JSON generado (edificios_generados.json,
// modelos_generados.json...) a .glb, uno por clave, con el nombre que ya
// espera el cliente (client/src/render3d/assetCatalog.ts):
//   <id>_<NN>.glb   si la clave lleva "_NN" al final (variante numerada)
//   <id>.glb        si no (una única variante) -> se guarda como <id>_01.glb
//
//   node exportar_lote.js <archivoModelos.json> <carpetaSalida>
//
// Uso normal ahora mismo (enganche rápido, sin pasar por el flujo de
// aprobación pieza a pieza — decisión explícita del streamer: esto es para
// tener algo jugable en las pruebas, no el arte final del juego):
//   node generar_edificio.js todo && node exportar_lote.js edificios_generados.json ../assets/edificios
//   node generar_modelos.js        && node exportar_lote.js modelos_generados.json ../assets/interiores

const fs = require("fs");
const path = require("path");
const { exportarModelo } = require("./exportar_glb");

function nombreSalida(clave) {
  const m = clave.match(/^(.*)_(\d{2})$/);
  if (m) return `${m[1]}_${m[2]}.glb`;
  return `${clave}_01.glb`;
}

function exportarLote(archivoModelos, carpetaSalida) {
  const modelos = require(path.resolve(archivoModelos));
  fs.mkdirSync(carpetaSalida, { recursive: true });
  const resumen = [];
  for (const [clave, modelo] of Object.entries(modelos)) {
    const archivo = nombreSalida(clave);
    const rutaSalida = path.join(carpetaSalida, archivo);
    // unit = 1 casilla de mundo / subdivisiones de vóxel de ESTE modelo —
    // generar_modelos.js varía `resolucion` pieza a pieza (resolverU),
    // así que el 0.1 fijo de exportar_glb.js (pensado para U=10 de
    // edificios) desescalaría cualquier mueble con más o menos detalle.
    const unit = 1 / (modelo.resolucion || 10);
    const stats = exportarModelo(modelo, clave, rutaSalida, unit);
    resumen.push({ clave, archivo, ...stats });
  }
  return resumen;
}

module.exports = { exportarLote, nombreSalida };

if (require.main === module) {
  const [archivoModelos, carpetaSalida] = process.argv.slice(2);
  if (!archivoModelos || !carpetaSalida) {
    console.log("Uso: node exportar_lote.js <archivoModelos.json> <carpetaSalida>");
    process.exit(1);
  }
  const resumen = exportarLote(archivoModelos, carpetaSalida);
  const kb = Math.round(resumen.reduce((a, r) => a + r.bytes, 0) / 1024);
  console.log(`Exportados ${resumen.length} .glb a ${carpetaSalida} (${kb} KB total)`);
}
