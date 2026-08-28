// Tests de mundo/interiorColision.ts (docs/GDD_Sistema_Puertas.md): la
// rejilla de colisión de un interior bakeado tiene que dejar TODAS sus
// salas alcanzables desde el spawn — encontramos y arreglamos 3 bugs
// reales aquí (puertas de conexión nunca guardadas, colisión de clutter
// decorativo demasiado agresiva, spawn cayendo encima de un mueble) y
// este test es la garantía de que no vuelven. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cargarInterior } from "../src/mundo/interiorColision";
import { TIPO } from "../src/mundo/colisiones";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generarEdificio } = require("../../interiores/src/edificio");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cargarCatalogos } = require("../../interiores/src/catalogo");

const catalogos = cargarCatalogos();

// Tipos con varias salas por planta baja garantizadas (más probable que
// el flood-fill encuentre algo que romper) — cruza con lo que ya prueba
// interiores/test/catalogo.test.js.
const TIPOS_MULTISALA = ["casa_modesta", "casa_noble", "herreria", "posada", "taberna", "biblioteca_publica"];

function floodFillCuentaSalas(interior: ReturnType<typeof cargarInterior>, salasRaw: any[]): number {
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
  let salasAlcanzadas = 0;
  for (const sala of salasRaw) {
    let alcanzada = false;
    for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && !alcanzada; y++) {
      for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho; x++) {
        if (visitado[y * interior.ancho + x]) { alcanzada = true; break; }
      }
    }
    if (alcanzada) salasAlcanzadas++;
  }
  return salasAlcanzadas;
}

test("cargarInterior: TODAS las salas de la planta baja son alcanzables desde el spawn, en varios tipos de edificio y semillas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-"));
  try {
    let edificiosProbados = 0;
    for (const tipoEdificioId of TIPOS_MULTISALA) {
      for (const semilla of ["semilla-a", "semilla-b", "semilla-c"]) {
        const edificio = generarEdificio({ tipoEdificioId, catalogos, semilla });
        const plantaBaja = edificio.plantas.find((p: any) => p.rol === "planta_baja");
        if (!plantaBaja || plantaBaja.salas.length < 2) continue; // nada que probar si solo hay 1 sala

        const archivo = path.join(dir, `${tipoEdificioId}_${semilla}.json`);
        fs.writeFileSync(archivo, JSON.stringify(edificio));
        const interior = cargarInterior(archivo);
        const alcanzadas = floodFillCuentaSalas(interior, plantaBaja.salas);
        edificiosProbados++;
        assert.strictEqual(
          alcanzadas,
          plantaBaja.salas.length,
          `${tipoEdificioId}/${semilla}: solo ${alcanzadas}/${plantaBaja.salas.length} salas alcanzables desde el spawn`,
        );
      }
    }
    assert.ok(edificiosProbados >= 5, `esperaba varios edificios multi-sala para probar, hubo ${edificiosProbados}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior: el spawn nunca cae en una casilla sólida", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-spawn-"));
  try {
    for (const tipoEdificioId of TIPOS_MULTISALA) {
      const edificio = generarEdificio({ tipoEdificioId, catalogos, semilla: "test-spawn" });
      const archivo = path.join(dir, `${tipoEdificioId}.json`);
      fs.writeFileSync(archivo, JSON.stringify(edificio));
      const interior = cargarInterior(archivo);
      const idx = Math.floor(interior.spawnY) * interior.ancho + Math.floor(interior.spawnX);
      assert.notStrictEqual(interior.casillas[idx], TIPO.SOLIDO, `${tipoEdificioId}: spawn sobre una casilla sólida`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
