"use strict";
// Bakeador de texturas — docs/GDD_Bakeador_Texturas.md. Lee terrenos.json
// (suelo exterior) y materiales.json (paredes/suelo de interiores), genera
// N variantes tileables por id (familias.js) y las escribe a
// assets/terrenos/<id>_NN.png y assets/materiales/<id>_NN.png — MISMA
// convención de nombre que ya usa el resto del proyecto (`<categoria>/<id>_<NN>.ext`).
//
// "Generar una vez, nunca en directo" (CLAUDE.md): esto es un paso de bake
// offline como cualquier otro, no corre en el servidor. Determinista por
// semilla: misma semilla + mismo catálogo = mismos PNG byte a byte.
//
//   node texturas/src/index.js               # bakea todo lo mapeado en las dos listas
//   node texturas/src/index.js --resolucion 256 --variantes 6

const fs = require("fs");
const path = require("path");
const { codificarPNG } = require("../../baker/src/png");
const { FAMILIAS } = require("./familias");
const { EXCLUIDOS, MAPEO_TERRENOS, MAPEO_MATERIALES } = require("./mapeoCatalogo");

const RAIZ = path.join(__dirname, "..", "..");
const RESOLUCION_DEFECTO = 128; // px por casilla — ver GDD_Bakeador_Texturas.md "por qué 128"
const VARIANTES_DEFECTO = 4;
const SEMILLA_BASE = "texturas-v1"; // cambiar esta cadena regenera TODAS las texturas con otro aspecto (mismo criterio que semilla de mundo)

function bufferDePintar(N, pintar) {
  const rgba = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r, g, b] = pintar(x, y);
      const i = (y * N + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/**
 * @param {Record<string,string>} mapeo - id -> nombre de familia
 * @param {Record<string,{colorDebug?:string}>} catalogo - terrenos.json o materiales.json ya cargado
 * @param {string} carpetaSalida - assets/terrenos o assets/materiales
 */
function bakearGrupo(mapeo, catalogo, carpetaSalida, opciones) {
  fs.mkdirSync(carpetaSalida, { recursive: true });
  const resumen = [];
  for (const [id, datos] of Object.entries(catalogo)) {
    if (id.startsWith("_") || EXCLUIDOS.has(id)) continue;
    const nombreFamilia = mapeo[id];
    if (!nombreFamilia) {
      console.warn(`  [aviso] "${id}" no tiene familia asignada en mapeoCatalogo.js — se omite (añádelo o inclúyelo en EXCLUIDOS si es a propósito, ej. líquidos)`);
      continue;
    }
    const familiaFn = FAMILIAS[nombreFamilia];
    if (!familiaFn) throw new Error(`familia "${nombreFamilia}" (para "${id}") no existe en familias.js`);
    const colorBase = datos.colorDebug || "#8a8a8a";
    const familia = familiaFn(opciones.resolucion, colorBase, `${SEMILLA_BASE}:${id}`);
    for (let v = 0; v < opciones.variantes; v++) {
      const pintar = familia.variante(v);
      const nombreArchivo = `${id}_${String(v + 1).padStart(2, "0")}.png`;
      const rgba = bufferDePintar(opciones.resolucion, pintar);
      fs.writeFileSync(path.join(carpetaSalida, nombreArchivo), codificarPNG(opciones.resolucion, opciones.resolucion, rgba));
    }
    resumen.push({ id, familia: nombreFamilia, variantes: opciones.variantes });
  }
  return resumen;
}

function main() {
  const args = process.argv.slice(2);
  const leerOpcion = (nombre, porDefecto) => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : porDefecto;
  };
  const opciones = {
    resolucion: leerOpcion("resolucion", RESOLUCION_DEFECTO),
    variantes: leerOpcion("variantes", VARIANTES_DEFECTO),
  };

  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "catalogo", "terrenos.json"), "utf8"));
  const materiales = JSON.parse(fs.readFileSync(path.join(RAIZ, "interiores", "catalogo", "materiales.json"), "utf8"));

  console.log(`Bakeando texturas (${opciones.resolucion}x${opciones.resolucion}px, ${opciones.variantes} variantes/id)...`);
  const rTerrenos = bakearGrupo(MAPEO_TERRENOS, terrenos, path.join(RAIZ, "assets", "terrenos"), opciones);
  console.log(`  ${rTerrenos.length} terreno(s) -> assets/terrenos/ (${rTerrenos.length * opciones.variantes} PNG)`);
  const rMateriales = bakearGrupo(MAPEO_MATERIALES, materiales, path.join(RAIZ, "assets", "materiales"), opciones);
  console.log(`  ${rMateriales.length} material(es) -> assets/materiales/ (${rMateriales.length * opciones.variantes} PNG)`);
  console.log("Hecho.");
}

if (require.main === module) main();

module.exports = { bakearGrupo, bufferDePintar };
