// Tests de la mazmorra REAL cargada por el servidor (docs/GDD_Bakeador_Dungeons.md)
// — la misma comprobación de flood-fill que ya blinda interiorColision.test.ts
// para edificios normales, aplicada a las mazmorras (salas grandes, forma
// orgánica de cueva, plantas conectadas por escaleras=TP). Ejecutar: npm test
// desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cargarInterior } from "../src/mundo/interiorColision";
import { TIPO } from "../src/mundo/colisiones";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generarMazmorra } = require("../../mazmorras/src/generarMazmorra");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cargarCatalogos } = require("../../interiores/src/catalogo");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tiposDungeon = require("../../mazmorras/catalogo/tipos_dungeon.json");

const catalogosInteriores = cargarCatalogos();
const catalogosMazmorra = { tiposDungeon };

// Una de cada estiloExterior/formaSala real para cubrir los dos motores de
// sala (rectangular de interiores/ vs orgánica de celular.js) y varias
// familias distintas del catálogo.
const TIPOS_MUESTRA = ["cueva_goblins", "cueva_aranas", "ruinas_templo_olvidado", "castillo_usurpado", "catacumbas", "guarida_lobos", "torre_nigromante"];

function floodFillCuentaSalas(interior: ReturnType<typeof cargarInterior>, salas: any[]): number {
  const visitado = new Uint8Array(interior.ancho * interior.alto);
  const inicio = { x: Math.floor(interior.spawnX), y: Math.floor(interior.spawnY) };
  if (interior.casillas[inicio.y * interior.ancho + inicio.x] === TIPO.SOLIDO) return 0;
  const cola: [number, number][] = [[inicio.x, inicio.y]];
  visitado[inicio.y * interior.ancho + inicio.x] = 1;
  while (cola.length) {
    const [x, y] = cola.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= interior.ancho || ny >= interior.alto) continue;
      const idx = ny * interior.ancho + nx;
      if (visitado[idx] || interior.casillas[idx] === TIPO.SOLIDO) continue;
      visitado[idx] = 1;
      cola.push([nx, ny]);
    }
  }
  let alcanzadas = 0;
  for (const sala of salas) {
    let alcanzada = false;
    for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && !alcanzada; y++) {
      for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho; x++) {
        if (visitado[y * interior.ancho + x]) { alcanzada = true; break; }
      }
    }
    if (alcanzada) alcanzadas++;
  }
  return alcanzadas;
}

test("cargarInterior (mazmorra): TODAS las salas de CADA planta son alcanzables desde el spawn, cueva orgánica y ruina/castillo rectangular", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-mazmorra-"));
  try {
    let plantasProbadas = 0;
    for (const tipoDungeonId of TIPOS_MUESTRA) {
      for (const semilla of ["s1", "s2", "s3"]) {
        const m = generarMazmorra({ tipoDungeonId, catalogosMazmorra, catalogosInteriores, semilla });
        const archivo = path.join(dir, `${tipoDungeonId}_${semilla}.json`);
        fs.writeFileSync(archivo, JSON.stringify(m));

        for (const planta of m.plantas) {
          const interior = cargarInterior(archivo, planta.nivel);
          const alcanzadas = floodFillCuentaSalas(interior, planta.salas);
          assert.strictEqual(
            alcanzadas, planta.salas.length,
            `${tipoDungeonId}/${semilla} nivel ${planta.nivel}: solo ${alcanzadas}/${planta.salas.length} salas alcanzables desde el spawn`,
          );
          plantasProbadas++;
        }
      }
    }
    assert.ok(plantasProbadas >= 15, `esperaba varias plantas probadas, hubo ${plantasProbadas}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior (mazmorra): expone spawnsEnemigos con al menos un slot de jefe por planta que lo tenga en el bake", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-mazmorra-spawns-"));
  try {
    const m = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla: "spawns-test" });
    const archivo = path.join(dir, "cueva.json");
    fs.writeFileSync(archivo, JSON.stringify(m));
    for (const planta of m.plantas) {
      const interior = cargarInterior(archivo, planta.nivel);
      assert.strictEqual(interior.spawnsEnemigos.length, planta.spawnsEnemigos.length);
      for (const s of interior.spawnsEnemigos) {
        const idx = s.y * interior.ancho + s.x;
        assert.notStrictEqual(interior.casillas[idx], TIPO.SOLIDO, `spawn en (${s.x},${s.y}) cae en casilla sólida`);
      }
      const bosses = planta.spawnsEnemigos.filter((s: any) => s.esBossSlot);
      assert.ok(bosses.length >= 1, `nivel ${planta.nivel}: sin slot de jefe`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior (mazmorra): escaleras=TP funcionan igual que en un edificio normal (multi-planta conectada)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-mazmorra-escaleras-"));
  try {
    const m = generarMazmorra({ tipoDungeonId: "castillo_usurpado", catalogosMazmorra, catalogosInteriores, semilla: "escaleras-test" });
    assert.ok(m.plantas.length >= 2, "esperaba varias plantas para probar escaleras");
    const archivo = path.join(dir, "castillo.json");
    fs.writeFileSync(archivo, JSON.stringify(m));
    for (const planta of m.plantas) {
      const interior = cargarInterior(archivo, planta.nivel);
      assert.strictEqual(interior.rol, planta.rol);
      const nivelesEsperados = m.conectoresVerticales
        .filter((c: any) => c.entreNiveles.includes(planta.nivel))
        .map((c: any) => (c.entreNiveles[0] === planta.nivel ? c.entreNiveles[1] : c.entreNiveles[0]))
        .sort();
      const nivelesObtenidos = interior.conectores.map((c) => c.destinoNivel).sort();
      assert.deepStrictEqual(nivelesObtenidos, nivelesEsperados);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
