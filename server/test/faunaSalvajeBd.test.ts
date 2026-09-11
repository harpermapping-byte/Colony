// Tests de la persistencia de fauna salvaje (docs/GDD_Agentes_Moviles.md,
// pedido 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, FaunaSalvajeFila, FaunaHuevoFila } from "../src/datos/bd";

function individuo(overrides: Partial<FaunaSalvajeFila> = {}): FaunaSalvajeFila {
  return {
    id: "principal:0:0:0",
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    especieId: "lobo",
    sexo: "macho",
    etapa: "adulto",
    estado: "vivo",
    x: 12.5,
    y: 8.5,
    ultimaComida: 10,
    ultimaBebida: 10,
    gestandoDesde: null,
    gestacionDuracionDias: null,
    nacioEn: null,
    vida: 50,
    vidaMax: 50,
    ataque: 12,
    ...overrides,
  };
}

test("guardarFaunaIndividuo + listarFaunaSector: upsert por id, solo devuelve el sector pedido", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarFaunaIndividuo(individuo({ id: "a" }));
  await bd.guardarFaunaIndividuo(individuo({ id: "b", especieId: "oso_pardo" }));
  await bd.guardarFaunaIndividuo(individuo({ id: "c", sectorX: 1, sectorY: 0 })); // otro sector

  const filas = await bd.listarFaunaSector("principal", 0, 0);
  assert.strictEqual(filas.length, 2);
  assert.deepStrictEqual(
    filas.map((f) => f.id).sort(),
    ["a", "b"],
  );

  // upsert: guardar de nuevo con el mismo id actualiza, no duplica
  await bd.guardarFaunaIndividuo(individuo({ id: "a", estado: "muerto", x: 99 }));
  const filas2 = await bd.listarFaunaSector("principal", 0, 0);
  assert.strictEqual(filas2.length, 2);
  const a = filas2.find((f) => f.id === "a")!;
  assert.strictEqual(a.estado, "muerto");
  assert.strictEqual(a.x, 99);
  await bd.cerrar();
});

test("guardarFaunaIndividuo: conserva gestandoDesde/gestacionDuracionDias null y con valor", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarFaunaIndividuo(individuo({ id: "sin_gestar" }));
  await bd.guardarFaunaIndividuo(
    individuo({ id: "gestando", sexo: "hembra", gestandoDesde: 12.5, gestacionDuracionDias: 17.3 }),
  );
  const filas = await bd.listarFaunaSector("principal", 0, 0);
  const sinGestar = filas.find((f) => f.id === "sin_gestar")!;
  const gestando = filas.find((f) => f.id === "gestando")!;
  assert.strictEqual(sinGestar.gestandoDesde, null);
  assert.strictEqual(sinGestar.gestacionDuracionDias, null);
  assert.strictEqual(gestando.gestandoDesde, 12.5);
  assert.strictEqual(gestando.gestacionDuracionDias, 17.3);
  await bd.cerrar();
});

test("guardarFaunaIndividuo: conserva nacioEn (null en la población base, con valor en una cría)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarFaunaIndividuo(individuo({ id: "base" }));
  await bd.guardarFaunaIndividuo(individuo({ id: "cria", etapa: "cria", nacioEn: 8.25 }));
  const filas = await bd.listarFaunaSector("principal", 0, 0);
  assert.strictEqual(filas.find((f) => f.id === "base")!.nacioEn, null);
  assert.strictEqual(filas.find((f) => f.id === "cria")!.nacioEn, 8.25);
  await bd.cerrar();
});

test("huevos: guardar, listar por sector y borrar al eclosionar", async () => {
  const bd = new AlmacenDatos(":memory:");
  const huevo: FaunaHuevoFila = {
    id: "huevo:1",
    mapaId: "principal",
    sectorX: 2,
    sectorY: 3,
    especieMadreId: "gallina_salvaje",
    x: 5,
    y: 5,
    puestoEn: 10,
    duracionDias: 3,
  };
  await bd.guardarHuevo(huevo);
  await bd.guardarHuevo({ ...huevo, id: "huevo:2", sectorX: 0, sectorY: 0 }); // otro sector

  const delSector = await bd.listarHuevosSector("principal", 2, 3);
  assert.strictEqual(delSector.length, 1);
  assert.strictEqual(delSector[0].especieMadreId, "gallina_salvaje");

  await bd.borrarHuevo("huevo:1");
  assert.strictEqual((await bd.listarHuevosSector("principal", 2, 3)).length, 0);
  assert.strictEqual((await bd.listarHuevosSector("principal", 0, 0)).length, 1, "el otro sector no se toca");
  await bd.cerrar();
});

test("resolución de sector: null si nunca se resolvió, luego devuelve lo último guardado", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerUltimaResolucionSector("principal", 4, 4), null);
  await bd.marcarSectorResuelto("principal", 4, 4, 100.25);
  assert.strictEqual(await bd.obtenerUltimaResolucionSector("principal", 4, 4), 100.25);
  // upsert: una segunda marca reemplaza, no acumula
  await bd.marcarSectorResuelto("principal", 4, 4, 105.5);
  assert.strictEqual(await bd.obtenerUltimaResolucionSector("principal", 4, 4), 105.5);
  // otro sector sigue sin resolver
  assert.strictEqual(await bd.obtenerUltimaResolucionSector("principal", 4, 5), null);
  await bd.cerrar();
});

// Lote (docs/GDD_Rendimiento.md §7.3, playtest 2026-09-10): activar un sector
// persiste MILES de individuos de golpe; fila a fila con SQLite congelaba el
// servidor entero ~20s. El lote debe dar EXACTAMENTE el mismo resultado que
// la versión fila a fila (mismo upsert por id) y hacerlo en una transacción.
test("guardarFaunaIndividuos (lote): mismo upsert que fila a fila, el último duplicado del lote gana, lote vacío no rompe", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.guardarFaunaIndividuos([]);
  await bd.guardarFaunaIndividuos([
    individuo({ id: "a" }),
    individuo({ id: "b", especieId: "oso_pardo" }),
    individuo({ id: "c", sectorX: 1, sectorY: 0 }),
    individuo({ id: "a", estado: "muerto", x: 99 }), // duplicado dentro del mismo lote: gana el último
  ]);
  const filas = await bd.listarFaunaSector("principal", 0, 0);
  assert.deepStrictEqual(filas.map((f) => f.id).sort(), ["a", "b"]);
  assert.strictEqual(filas.find((f) => f.id === "a")!.estado, "muerto");
  assert.strictEqual(filas.find((f) => f.id === "a")!.x, 99);
  // segundo lote: actualiza sin duplicar (mismo criterio que guardarFaunaIndividuo)
  await bd.guardarFaunaIndividuos([individuo({ id: "b", vida: 7 })]);
  const filas2 = await bd.listarFaunaSector("principal", 0, 0);
  assert.strictEqual(filas2.length, 2);
  assert.strictEqual(filas2.find((f) => f.id === "b")!.vida, 7);
  await bd.cerrar();
});

test("guardarFaunaIndividuos (lote): 3000 individuos en una BD de ARCHIVO real caben en una sola transacción (sin un fsync por fila)", async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const ruta = join(tmpdir(), `colony-fauna-lote-${process.pid}-${Date.now()}.sqlite`);
  const bd = new AlmacenDatos(ruta);
  const filas = Array.from({ length: 3000 }, (_, i) => individuo({ id: `principal:4:6:${i}`, sectorX: 4, sectorY: 6, x: i % 320, y: Math.floor(i / 320) }));
  const t0 = performance.now();
  await bd.guardarFaunaIndividuos(filas);
  const ms = performance.now() - t0;
  const leidas = await bd.listarFaunaSector("principal", 4, 6);
  assert.strictEqual(leidas.length, 3000);
  // Fila a fila (una transacción implícita con fsync cada una) son varios
  // SEGUNDOS en este mismo tamaño — el lote tiene que quedar muy por debajo.
  assert.ok(ms < 1500, `el lote de 3000 tardó ${ms.toFixed(0)}ms (esperado < 1500ms)`);
  await bd.cerrar();
  rmSync(ruta, { force: true });
  rmSync(ruta + "-wal", { force: true });
  rmSync(ruta + "-shm", { force: true });
});
