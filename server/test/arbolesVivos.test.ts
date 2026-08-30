// Tests de persistencia de crecimiento de bosques (server/src/datos/bd.ts,
// tablas arboles_vivos/arboles_sector_resuelto, docs/GDD_Bosques.md).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, ArbolVivoFila } from "../src/datos/bd";

function filaDeEjemplo(overrides: Partial<ArbolVivoFila> = {}): ArbolVivoFila {
  return {
    id: "arbol:hub:0:0:brote:100:1",
    mapaId: "hub",
    sectorX: 0,
    sectorY: 0,
    especieId: "pino",
    x: 5,
    y: 5,
    etapa: "joven",
    origen: "propagacion",
    diaPlantado: 100,
    estado: "vivo",
    ...overrides,
  };
}

test("arboles_vivos: crear/listar por sector hace roundtrip exacto", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarArbolVivo(filaDeEjemplo());
  await bd.guardarArbolVivo(filaDeEjemplo({ id: "arbol:hub:0:0:brote:100:2", x: 6, sectorX: 1 }));

  const delSector0 = await bd.listarArbolesVivosSector("hub", 0, 0);
  assert.strictEqual(delSector0.length, 1);
  assert.deepStrictEqual(delSector0[0], filaDeEjemplo());

  const delSector1 = await bd.listarArbolesVivosSector("hub", 1, 0);
  assert.strictEqual(delSector1.length, 1);
  assert.strictEqual(delSector1[0].x, 6);
});

test("arboles_vivos: guardarArbolVivo es upsert — misma id actualiza etapa/estado, no duplica fila", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarArbolVivo(filaDeEjemplo());
  await bd.guardarArbolVivo(filaDeEjemplo({ etapa: "adulto" }));

  const filas = await bd.listarArbolesVivosSector("hub", 0, 0);
  assert.strictEqual(filas.length, 1, "no duplica, actualiza la misma fila");
  assert.strictEqual(filas[0].etapa, "adulto");
});

test("arboles_vivos: un árbol de origen bake talado se persiste con diaPlantado null", async () => {
  const bd = new AlmacenDatos(":memory:");
  const taladoBake = filaDeEjemplo({
    id: "arbol:hub:0:0:0", origen: "bake", etapa: "adulto", diaPlantado: null, estado: "talado",
  });
  await bd.guardarArbolVivo(taladoBake);

  const filas = await bd.listarArbolesVivosSector("hub", 0, 0);
  assert.deepStrictEqual(filas[0], taladoBake);
});

test("arboles_sector_resuelto: sin resolver devuelve null, luego marcarSectorBosqueResuelto persiste el día y es upsert", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerUltimaResolucionSectorBosque("hub", 2, 3), null);

  await bd.marcarSectorBosqueResuelto("hub", 2, 3, 150);
  assert.strictEqual(await bd.obtenerUltimaResolucionSectorBosque("hub", 2, 3), 150);

  await bd.marcarSectorBosqueResuelto("hub", 2, 3, 200);
  assert.strictEqual(await bd.obtenerUltimaResolucionSectorBosque("hub", 2, 3), 200, "upsert: no crea una segunda fila, actualiza el valor");

  // otro sector no se ve afectado
  assert.strictEqual(await bd.obtenerUltimaResolucionSectorBosque("hub", 9, 9), null);
});
