// Genera client/test/siluetaTestSector.json — un sector AISLADO (mismo
// patrón que nieveAislado.ts) con UN asentamiento real (silueta+puerta,
// docs/GDD_Bakeador_POIs.md §13ter) para verificar visualmente sin
// necesitar servidor de juego ni un bake completo — replica EXACTAMENTE
// la transformación de baker/src/generar.js (per-chunk push de "e") para
// que el resultado sea indistinguible de un bake real. `siluetaAislada.ts`
// (companion, cargado por siluetaAislada.html) lo consume.
//
//   node client/test/generarSiluetaTestSector.js [tier]   (por defecto aldea_pequena)
//   npx vite --port 5209   (desde client/)
//   abrir http://localhost:5209/test/siluetaAislada.html?vista=cerca
//
// El JSON generado NO se comitea (siempre desechable, regenerar cuando
// haga falta) — ver .gitignore. ESM (no CommonJS): `client/package.json`
// tiene `"type":"module"`, así que este archivo `.js` SIEMPRE se carga
// como módulo ES sin importar desde qué carpeta se invoque `node` — un
// `require()` de nivel superior aquí revienta siempre con
// "require is not defined in ES module scope".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generarInstanciasPOI } from "../../baker/src/instanciasPOI.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tier = process.argv[2] || "aldea_pequena";
  const carpetaSalida = fs.mkdtempSync(path.join(os.tmpdir(), "silueta_test_sector_"));
  const catalogoPOIs = { pradera: [{ id: "poi_test", categoria: "asentamiento", tier }] };
  const pois = [{ id: "poi_test", x: 600, y: 600, bioma: "pradera" }];

  const { portales, objetosPorPOI } = await generarInstanciasPOI({
    pois, carpetaSalida, semillaMundo: "vista-seed-" + tier, catalogoPOIs,
    onProgreso: (m) => console.log(m),
  });

  const TAM = 500; // un solo chunk contiene toda la ciudad (hasta capital, 184x184) + margen de sobra
  const objetos = [];
  for (const info of objetosPorPOI.values()) {
    objetos.push({
      i: info.objeto.i, t: info.objeto.t, va: info.objeto.va, ro: info.objeto.ro, es: info.objeto.es,
      w: info.objeto.w, h: info.objeto.h,
      x: Math.floor(info.x), y: Math.floor(info.y),
      dx: info.x - Math.floor(info.x), dy: info.y - Math.floor(info.y),
    });
  }
  const portal = portales[0];

  const salida = {
    indice: {
      version: 1, nombre: "test-silueta", semilla: "x",
      anchoChunks: 1, altoChunks: 1, tamanoChunk: TAM, tamanoSectorChunks: 1,
      leyendaTerreno: ["cesped"],
    },
    sector: {
      sectorX: 0, sectorY: 0,
      chunks: { "0_0": { terreno: "0".repeat(TAM * TAM), tamano: TAM, objetos } },
    },
    portal,
    centroCiudad: { x: 600, y: 600 },
  };

  const outPath = path.join(__dirname, "siluetaTestSector.json");
  fs.writeFileSync(outPath, JSON.stringify(salida));
  console.log("Escrito:", outPath, "tier:", tier, "objetos:", objetos.length, "portal:", JSON.stringify(portal));
  fs.rmSync(carpetaSalida, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
