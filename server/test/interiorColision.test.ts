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

// Tipos con planta(s) alta(s)/bodega GARANTIZADAS (rangoPlantasAltas mínimo
// >= 1, o tieneBodega:true) — a diferencia de TIPOS_MULTISALA (que a veces
// sacan 0 plantas altas por azar), aquí SIEMPRE hay más de una planta que
// probar, así el test de escaleras=TP no depende de qué semilla le toque.
const TIPOS_MULTIPLANTA = ["castillo", "torre_mago", "faro", "torre_militar", "posada"];

test("cargarInterior: en un edificio multi-planta, TODAS las salas de CADA planta (no solo la baja) son alcanzables desde su propio spawn", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-plantas-"));
  try {
    let plantasProbadas = 0;
    for (const tipoEdificioId of TIPOS_MULTIPLANTA) {
      for (const semilla of ["semilla-a", "semilla-b", "semilla-c"]) {
        const edificio = generarEdificio({ tipoEdificioId, catalogos, semilla });
        const archivo = path.join(dir, `${tipoEdificioId}_${semilla}.json`);
        fs.writeFileSync(archivo, JSON.stringify(edificio));

        for (const planta of edificio.plantas) {
          if (planta.salas.length < 2) continue; // nada que probar si solo hay 1 sala
          const interior = cargarInterior(archivo, planta.nivel);
          const alcanzadas = floodFillCuentaSalas(interior, planta.salas);
          plantasProbadas++;
          assert.strictEqual(
            alcanzadas,
            planta.salas.length,
            `${tipoEdificioId}/${semilla} nivel ${planta.nivel} (${planta.rol}): solo ${alcanzadas}/${planta.salas.length} salas alcanzables`,
          );
        }
      }
    }
    assert.ok(plantasProbadas >= 10, `esperaba varias plantas multi-sala para probar, hubo ${plantasProbadas}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior: cada conector vertical tiene una casilla real, dentro de la rejilla, no sólida y con hueco a ambos lados", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-conectores-"));
  try {
    let conectoresProbados = 0;
    for (const tipoEdificioId of TIPOS_MULTIPLANTA) {
      for (const semilla of ["semilla-a", "semilla-b", "semilla-c"]) {
        const edificio = generarEdificio({ tipoEdificioId, catalogos, semilla });
        assert.ok(
          edificio.plantas.length >= 2,
          `${tipoEdificioId}/${semilla}: se esperaban >=2 plantas, hubo ${edificio.plantas.length}`,
        );
        assert.ok(
          edificio.conectoresVerticales.length >= edificio.plantas.length - 1,
          `${tipoEdificioId}/${semilla}: faltan conectores entre plantas (${edificio.conectoresVerticales.length} para ${edificio.plantas.length} plantas)`,
        );

        const archivo = path.join(dir, `${tipoEdificioId}_${semilla}.json`);
        fs.writeFileSync(archivo, JSON.stringify(edificio));

        for (const c of edificio.conectoresVerticales) {
          const [nivelAbajo, nivelArriba] = c.entreNiveles;
          for (const [nivel, posicion] of [
            [nivelAbajo, c.posicionAbajo],
            [nivelArriba, c.posicionArriba],
          ] as const) {
            const interior = cargarInterior(archivo, nivel);
            const [hw, hl] = c.huella;
            for (let y = 0; y < hl; y++) {
              for (let x = 0; x < hw; x++) {
                const idx = (posicion.y + y) * interior.ancho + (posicion.x + x);
                assert.ok(idx >= 0 && idx < interior.casillas.length, `${tipoEdificioId}/${semilla}: conector fuera de rejilla`);
                assert.notStrictEqual(
                  interior.casillas[idx],
                  TIPO.SOLIDO,
                  `${tipoEdificioId}/${semilla} nivel ${nivel}: conector cae en casilla sólida`,
                );
              }
            }
            conectoresProbados++;
          }
        }
      }
    }
    assert.ok(conectoresProbados >= 10, `esperaba varios conectores para probar, hubo ${conectoresProbados}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior: cada planta de un edificio multi-planta expone sus conectores con el nivel destino correcto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-nivel-destino-"));
  try {
    for (const tipoEdificioId of TIPOS_MULTIPLANTA) {
      const edificio = generarEdificio({ tipoEdificioId, catalogos, semilla: "semilla-destino" });
      const archivo = path.join(dir, `${tipoEdificioId}.json`);
      fs.writeFileSync(archivo, JSON.stringify(edificio));

      for (const planta of edificio.plantas) {
        const interior = cargarInterior(archivo, planta.nivel);
        assert.strictEqual(interior.rol, planta.rol);
        const nivelesEsperados = edificio.conectoresVerticales
          .filter((c: any) => c.entreNiveles.includes(planta.nivel))
          .map((c: any) => (c.entreNiveles[0] === planta.nivel ? c.entreNiveles[1] : c.entreNiveles[0]))
          .sort();
        const nivelesObtenidos = interior.conectores.map((c) => c.destinoNivel).sort();
        assert.deepStrictEqual(
          nivelesObtenidos,
          nivelesEsperados,
          `${tipoEdificioId} nivel ${planta.nivel}: conectores expuestos no coinciden con conectoresVerticales`,
        );
      }
    }
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

test("cargarInterior: salasPorTipo da una casilla pisable real por cada tipo de sala de la planta (vida en interiores)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-salas-"));
  try {
    const edificio = generarEdificio({ tipoEdificioId: "casa_modesta", catalogos, semilla: "salas-a" });
    const plantaBaja = edificio.plantas.find((p: any) => p.rol === "planta_baja");
    assert.ok(plantaBaja.salas.length >= 2, "esta prueba necesita un edificio con varias salas");

    const archivo = path.join(dir, "casa_modesta_salas-a.json");
    fs.writeFileSync(archivo, JSON.stringify(edificio));
    const interior = cargarInterior(archivo);

    const tiposReales = new Set(plantaBaja.salas.map((s: any) => s.tipoSalaId));
    assert.strictEqual(interior.salasPorTipo.size, tiposReales.size, "faltan o sobran tipos de sala");
    for (const tipoSalaId of tiposReales) {
      const puntos = interior.salasPorTipo.get(tipoSalaId as string);
      assert.ok(puntos && puntos.length > 0, `sin punto para la sala ${tipoSalaId}`);
      for (const p of puntos!) {
        assert.notStrictEqual(interior.casillas[p.y * interior.ancho + p.x], TIPO.SOLIDO, `punto de ${tipoSalaId} cae en sólido`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cargarInterior: objetosSueltos expone los ítems 'sobre' del bake (fase 2 de inventario, 'coger') con posición real del mueble host", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-interior-sueltos-"));
  try {
    // herreria/taberna colocan mesas de trabajo/encimeras con clutter "sobre"
    // real (clavos, jarra_agua, plato...) — mismo id que ya cruzamos con
    // items/catalogo/items.json en docs/GDD_Inventario.md §7.
    const edificio = generarEdificio({ tipoEdificioId: "herreria", catalogos, semilla: "sueltos-a" });
    const archivo = path.join(dir, "herreria_sueltos-a.json");
    fs.writeFileSync(archivo, JSON.stringify(edificio));
    const interior = cargarInterior(archivo);

    // recuento esperado directamente del JSON bakeado, sin pasar por cargarInterior:
    const plantaBaja = edificio.plantas.find((p: any) => p.rol === "planta_baja");
    let esperados = 0;
    for (const sala of plantaBaja.salas) {
      for (const item of sala.resultado.colocados) esperados += (item.sobre ?? []).length;
    }
    assert.ok(esperados > 0, "esta prueba necesita un edificio con clutter 'sobre' real");
    assert.strictEqual(interior.objetosSueltos.size, esperados);

    // cada entrada tiene instanceId único e itemId real; la posición es la
    // del MUEBLE host (puede ser sólido — no tiene casilla propia, se
    // interactúa por proximidad al host, no parado encima), pero debe caer
    // dentro de la rejilla de la planta.
    const vistos = new Set<string>();
    for (const [instanceId, o] of interior.objetosSueltos) {
      assert.ok(!vistos.has(instanceId), `instanceId repetido: ${instanceId}`);
      vistos.add(instanceId);
      assert.ok(o.itemId.length > 0);
      assert.ok(o.x >= 0 && o.x < interior.ancho && o.y >= 0 && o.y < interior.alto, `objeto suelto ${instanceId} fuera de la rejilla`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
