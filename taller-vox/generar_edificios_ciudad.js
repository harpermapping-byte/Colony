"use strict";
// Puente ciudades/ → taller-vox: genera el .glb de CADA edificio de una
// ciudad ya bakeada siguiendo su plan de suelo real (clave `edificios` del
// indice.json, exportada por ciudades/src/index.js): mismo w/h con jitter,
// mismas alas L/T/U en su posición exacta, mismas plantas que el interior
// anidado y la MISMA semilla (semillaInterior) — fachada, forma e interior
// nacen del mismo tiro de dados.
//
//   node taller-vox/generar_edificios_ciudad.js <carpetaCiudad> [carpetaSalida]
//
// Salida por defecto: <carpetaCiudad>/edificios_glb/<id>.glb — carpeta de
// PREVISUALIZACIÓN a revisar con el usuario. Los .glb NO se suben a
// assets/ sin pasar el flujo de aprobación pactado (ver CLAUDE.md).

const fs = require("fs");
const path = require("path");
const { generarEdificio } = require("./generar_edificio");
const { exportarModelo } = require("./exportar_glb");

function generarEdificiosCiudad(carpetaCiudad, carpetaSalida) {
  const indice = JSON.parse(fs.readFileSync(path.join(carpetaCiudad, "indice.json"), "utf8"));
  if (!Array.isArray(indice.edificios) || !indice.edificios.length) {
    throw new Error(
      "el indice.json no trae la clave `edificios` (plan de suelo) — rebakear la ciudad con ciudades/src/index.js actual"
    );
  }
  const salida = carpetaSalida || path.join(carpetaCiudad, "edificios_glb");
  fs.mkdirSync(salida, { recursive: true });

  const resumen = [];
  for (const ed of indice.edificios) {
    // plantas del INTERIOR anidado, no una tirada nueva: el .glb debe tener
    // los mismos pisos que el interior al que da acceso su portal
    let plantasAltas;
    const rutaInterior = path.join(carpetaCiudad, "interiores", `${ed.id}.json`);
    if (fs.existsSync(rutaInterior)) {
      const interior = JSON.parse(fs.readFileSync(rutaInterior, "utf8"));
      if (Array.isArray(interior.plantas)) plantasAltas = interior.plantas.length - 1;
    }
    const modelo = generarEdificio(ed.tipo, 1, {
      semilla: ed.semilla, w: ed.w, h: ed.h, piezas: ed.piezas, plantasAltas,
    });
    const rutaGlb = path.join(salida, `${ed.id}.glb`);
    const stats = exportarModelo(modelo, ed.id, rutaGlb);
    resumen.push({ id: ed.id, tipo: ed.tipo, w: ed.w, h: ed.h, alas: ed.piezas.length - 1, ...stats });
  }
  return { salida, resumen };
}

module.exports = { generarEdificiosCiudad };

if (require.main === module) {
  const [carpetaCiudad, carpetaSalida] = process.argv.slice(2);
  if (!carpetaCiudad) {
    console.log("Uso: node taller-vox/generar_edificios_ciudad.js <carpetaCiudad> [carpetaSalida]");
    process.exit(1);
  }
  const { salida, resumen } = generarEdificiosCiudad(carpetaCiudad, carpetaSalida);
  const enL = resumen.filter((r) => r.alas > 0).length;
  const kb = Math.round(resumen.reduce((a, r) => a + r.bytes, 0) / 1024);
  console.log(`${resumen.length} edificios (${enL} con alas), ${kb} KB en total -> ${salida}`);
  for (const r of resumen) console.log(`  ${r.id} (${r.tipo}) ${r.w}x${r.h}${r.alas ? ` +${r.alas} ala(s)` : ""} · ${r.triangulos} tris`);
}
