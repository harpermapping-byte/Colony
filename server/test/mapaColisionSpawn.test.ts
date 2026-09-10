// Tests de la prioridad del punto de aparición en cargarMapaColision
// (docs/GDD_Bakeador_POIs.md §14): `indice.spawn` (la puerta del asentamiento
// civil más cercano, escrita por baker/src/generar.js) manda sobre
// `indice.ciudad` (el CENTRO de la capital, terreno sólido), y ambos sobre
// el centro geométrico del mapa. Se usa un mapa minúsculo escrito en una
// carpeta temporal en vez del demo real: así la prueba controla exactamente
// dónde hay suelo pisable y dónde roca, sin depender de un bake.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cargarMapaColision } from "../src/mundo/mapaColision";

const RAIZ_REPO = path.resolve(__dirname, "..", "..");
const RUTA_CATALOGO_BAKER = path.join(RAIZ_REPO, "baker", "catalogo");

// Mapa 1x1 chunks de 4 casillas: todo césped salvo la fila 0, que es roca
// inaccesible (índice 1 de la leyenda). Cada test escribe su propio índice
// (con/sin `spawn`/`ciudad`) sobre el mismo sector.
function escribirMapaMinusculo(indiceExtra: Record<string, unknown>): string {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "colony-spawn-"));
  const terreno = "1111" + "0000" + "0000" + "0000";
  fs.writeFileSync(
    path.join(carpeta, "indice.json"),
    JSON.stringify({
      version: 1,
      nombre: "spawn-test",
      anchoChunks: 1,
      altoChunks: 1,
      tamanoChunk: 4,
      tamanoSectorChunks: 1,
      leyendaTerreno: ["cesped", "roca_inaccesible"],
      ...indiceExtra,
    }),
  );
  fs.writeFileSync(
    path.join(carpeta, "sector_000_000.json"),
    JSON.stringify({ sectorX: 0, sectorY: 0, chunks: { "0_0": { terreno, tamano: 4, objetos: [] } } }),
  );
  return carpeta;
}

test("cargarMapaColision: `spawn` del índice manda sobre `ciudad` (aparecer en la puerta, no en el centro sólido de la capital)", () => {
  const carpeta = escribirMapaMinusculo({ ciudad: { x: 1, y: 1 }, spawn: { x: 3, y: 3 } });
  const mapa = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa.spawnX, 3.5);
  assert.strictEqual(mapa.spawnY, 3.5);
});

test("cargarMapaColision: sin `spawn`, sigue valiendo `ciudad` (bakes anteriores a 2026-09-10 no cambian de comportamiento)", () => {
  const carpeta = escribirMapaMinusculo({ ciudad: { x: 1, y: 2 } });
  const mapa = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa.spawnX, 1.5);
  assert.strictEqual(mapa.spawnY, 2.5);
});

test("cargarMapaColision: sin `spawn` ni `ciudad`, cae al centro geométrico del mapa", () => {
  const carpeta = escribirMapaMinusculo({});
  const mapa = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa.spawnX, 2.5);
  assert.strictEqual(mapa.spawnY, 2.5);
});

test("cargarMapaColision: un `spawn` que cae en roca se corrige a la casilla pisable más cercana, igual que siempre hizo `ciudad`", () => {
  // (2,0) es roca inaccesible; toda la fila 1 es césped. La búsqueda va por
  // anillos (Chebyshev) y devuelve la primera pisable del anillo 1, no
  // necesariamente la euclídea más cercana — lo que importa es que NO se
  // quede en la roca y que no se vaya más lejos de un anillo.
  const carpeta = escribirMapaMinusculo({ spawn: { x: 2, y: 0 } });
  const mapa = cargarMapaColision(carpeta, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa.spawnY, 1.5, "baja a la fila de césped");
  assert.ok([1.5, 2.5, 3.5].includes(mapa.spawnX), `adyacente a la roca pedida, sale ${mapa.spawnX}`);
});
