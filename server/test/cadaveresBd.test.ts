// Tests de la persistencia de cadáveres (docs/GDD_Agentes_Moviles.md,
// pedido 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, CadaverFila } from "../src/datos/bd";
import { crearContenedor } from "../src/inventario/inventario";

function cadaverFila(overrides: Partial<CadaverFila> = {}): CadaverFila {
  return {
    id: "cadaver:1",
    mapaId: "principal",
    tipoOrigen: "animal",
    especieOrigenId: "lobo",
    x: 10.5,
    y: 20.5,
    muertoEn: 30,
    contenedor: crearContenedor(4, 3),
    ...overrides,
  };
}

test("crearCadaverBd + listarCadaveresMapa: se guarda y se lee entero, incluido el contenedor", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila());
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].id, "cadaver:1");
  assert.strictEqual(filas[0].tipoOrigen, "animal");
  assert.strictEqual(filas[0].especieOrigenId, "lobo");
  assert.strictEqual(filas[0].x, 10.5);
  assert.strictEqual(filas[0].muertoEn, 30);
  assert.deepStrictEqual(filas[0].contenedor, crearContenedor(4, 3));
  await bd.cerrar();
});

test("listarCadaveresMapa: solo devuelve los del mapa pedido", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila({ id: "a", mapaId: "principal" }));
  await bd.crearCadaverBd(cadaverFila({ id: "b", mapaId: "otra_region" }));
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].id, "a");
  await bd.cerrar();
});

test("actualizarContenedorCadaver: cambia solo el contenedor, el resto de campos no se toca", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila());
  const nuevo = crearContenedor(4, 3);
  nuevo.items.push({ id: 1, itemId: "arcilla", cantidad: 3, x: 0, y: 0, rot: 0 });
  await bd.actualizarContenedorCadaver("cadaver:1", nuevo);
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas[0].contenedor.items.length, 1);
  assert.strictEqual(filas[0].contenedor.items[0].itemId, "arcilla");
  assert.strictEqual(filas[0].especieOrigenId, "lobo", "el resto de campos sigue igual");
  await bd.cerrar();
});

test("borrarCadaver: desaparece de la lista (al cumplirse el día de decadencia)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila());
  await bd.borrarCadaver("cadaver:1");
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas.length, 0);
  await bd.cerrar();
});

test("crearCadaverBd + listarCadaveresMapa: datosVisual se guarda y se lee igual (identidad visual, pedido 2026-09-01)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const datosVisual = JSON.stringify({ equipo: { torso: "armadura_cuero" } });
  await bd.crearCadaverBd(cadaverFila({ id: "v", datosVisual }));
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas[0].datosVisual, datosVisual);
  await bd.cerrar();
});

test("crearCadaverBd: sin datosVisual explícito, se guarda y lee como cadena vacía", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila());
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas[0].datosVisual, "");
  await bd.cerrar();
});

test("cadáveres de distinto tipoOrigen (animal/npc/jugador) se guardan y leen igual", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCadaverBd(cadaverFila({ id: "a", tipoOrigen: "animal", especieOrigenId: "lobo" }));
  await bd.crearCadaverBd(cadaverFila({ id: "n", tipoOrigen: "npc", especieOrigenId: "guardia" }));
  await bd.crearCadaverBd(cadaverFila({ id: "j", tipoOrigen: "jugador", especieOrigenId: "Ragnar" }));
  const filas = await bd.listarCadaveresMapa("principal");
  assert.strictEqual(filas.length, 3);
  assert.strictEqual(filas.find((f) => f.id === "n")!.tipoOrigen, "npc");
  assert.strictEqual(filas.find((f) => f.id === "j")!.especieOrigenId, "Ragnar");
  await bd.cerrar();
});
