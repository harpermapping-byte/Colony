// Test del bug real cerrado el 2026-09-14 (investigación de "lag" con un
// perfil `--cpu-prof` REAL de producción, ver CLAUDE.md): `cargarMapaColision`
// releía y re-parseaba TODOS los sectores del bake (Vetrheim: 100 archivos,
// hasta ~170MB) EN CADA LLAMADA — cada vez que Colyseus creaba una room nueva
// para un mapa (incluida una room que se había vaciado y destruido por
// `autoDispose`, no solo el arranque del servidor), el proceso entero se
// congelaba ~1 SEGUNDO de forma síncrona (medido en el perfil real: 1.02s de
// trabajo concentrado en una única ráfaga). Cerrado con una caché por
// `rutaMapa` de la parte INMUTABLE del bake (terreno+portales+metadata) —
// este test verifica las propiedades que tienen que sostenerse a la vez:
// (1) la segunda llamada no vuelve a tocar el disco, (2) `casillas` sigue
// siendo una copia PROPIA e independiente por llamada (imprescindible:
// `construccion/construccion.ts` la muta por partida — compartir la misma
// instancia entre dos rooms distintas habría dejado construcciones fantasma
// o revertidas mal al demoler), y (3) `velocidad` SÍ se comparte a propósito
// (nunca se escribe en ningún sitio del servidor, confirmado por grep antes
// de hacerlo — ahorra la copia más pesada de las dos, un Float32Array,
// sin ningún riesgo real).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cargarMapaColision } from "../src/mundo/mapaColision";
import { TIPO } from "../src/mundo/colisiones";

const RAIZ_REPO = path.resolve(__dirname, "..", "..");
const RUTA_CATALOGO_BAKER = path.join(RAIZ_REPO, "baker", "catalogo");

function escribirMapaMinusculo(): string {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "colony-cache-mapa-"));
  const terreno = "0000" + "0000" + "0000" + "0000"; // todo césped
  fs.writeFileSync(
    path.join(carpeta, "indice.json"),
    JSON.stringify({
      version: 1,
      nombre: "cache-test",
      anchoChunks: 1,
      altoChunks: 1,
      tamanoChunk: 4,
      tamanoSectorChunks: 1,
      leyendaTerreno: ["cesped"],
    }),
  );
  fs.writeFileSync(
    path.join(carpeta, "sector_000_000.json"),
    JSON.stringify({ sectorX: 0, sectorY: 0, chunks: { "0_0": { terreno, tamano: 4, objetos: [] } } }),
  );
  return carpeta;
}

test("cargarMapaColision: cachea el parseo pesado por rutaMapa — la segunda llamada NO vuelve a leer el bake del disco", () => {
  const carpeta = escribirMapaMinusculo();
  const mapa1 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);

  // Si la segunda llamada necesitara releer los archivos, esto la haría
  // fallar con ENOENT — que NO falle es la prueba de que usó la caché.
  fs.rmSync(path.join(carpeta, "sector_000_000.json"));
  fs.rmSync(path.join(carpeta, "indice.json"));

  const mapa2 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.deepStrictEqual(Array.from(mapa2.casillas), Array.from(mapa1.casillas));
  assert.strictEqual(mapa2.spawnX, mapa1.spawnX);
  assert.strictEqual(mapa2.nombre, mapa1.nombre);
});

test("cargarMapaColision: `casillas` sigue siendo una copia PROPIA por llamada — mutar una room (construir/demoler) no contamina otra ya creada", () => {
  const carpeta = escribirMapaMinusculo();
  const mapa1 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  const mapa2 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);

  assert.notStrictEqual(mapa1.casillas, mapa2.casillas, "arrays de casillas independientes por llamada — la única que `construccion.ts` muta");

  const original = mapa2.casillas[0];
  mapa1.casillas[0] = TIPO.SOLIDO; // simula una construcción endureciendo su casilla en la room 1
  assert.strictEqual(mapa2.casillas[0], original, "la room 2 (creada antes) no ve la mutación de la room 1");
});

test("cargarMapaColision: `velocidad` SÍ se comparte entre llamadas a propósito — nunca se muta en ningún sitio del servidor (confirmado por grep antes de compartirla), compartirla evita duplicar el array más pesado de los dos (Float32Array) sin ningún riesgo de correctitud", () => {
  const carpeta = escribirMapaMinusculo();
  const mapa1 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  const mapa2 = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa1.velocidad, mapa2.velocidad, "misma instancia — es intencional, no un bug");
});
