// Tests de persistencia de ganadería (server/src/datos/bd.ts, tabla
// animales_granja, docs/GDD_Ganaderia.md). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, AnimalGranjaFila } from "../src/datos/bd";

function filaDeEjemplo(overrides: Partial<AnimalGranjaFila> = {}): AnimalGranjaFila {
  return {
    id: "animal:vaca:1000:0",
    especieId: "vaca",
    mapaId: "hub",
    propiedadId: "p_0001",
    x: 10,
    y: 20,
    extra: { ultimoDiaEscapeChequeado: 5 },
    enVentaTenderoteId: null,
    enVentaPrecio: null,
    creadoEn: new Date(0).toISOString(),
    ...overrides,
  };
}

test("animales_granja: crear/listar por mapa hace roundtrip exacto (incluido extra JSON)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  await bd.crearAnimalGranjaBd(filaDeEjemplo({ id: "animal:oveja:1001:0", especieId: "oveja", mapaId: "otro_mapa" }));

  const delHub = await bd.listarAnimalesGranjaMapa("hub");
  assert.strictEqual(delHub.length, 1);
  assert.deepStrictEqual(delHub[0], filaDeEjemplo());

  const delOtro = await bd.listarAnimalesGranjaMapa("otro_mapa");
  assert.strictEqual(delOtro.length, 1);
  assert.strictEqual(delOtro[0].especieId, "oveja");
  await bd.cerrar();
});

test("animales_granja: actualizarExtra solo toca extra, el resto de campos no cambian", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  await bd.actualizarExtraAnimalGranja("animal:vaca:1000:0", { produccion: { leche: { stock: 2, ultimoCalculo: 5000 } }, ultimoDiaEscapeChequeado: 7 });

  const [fila] = await bd.listarAnimalesGranjaMapa("hub");
  assert.deepStrictEqual(fila.extra, { produccion: { leche: { stock: 2, ultimoCalculo: 5000 } }, ultimoDiaEscapeChequeado: 7 });
  assert.strictEqual(fila.propiedadId, "p_0001", "el resto de campos no cambia");
  await bd.cerrar();
});

test("animales_granja: borrar lo quita del todo (escape/sacrificio)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  await bd.borrarAnimalGranja("animal:vaca:1000:0");
  assert.deepStrictEqual(await bd.listarAnimalesGranjaMapa("hub"), []);
  await bd.cerrar();
});

test("animales_granja: fijarVenta lista/quita — false si el animal no pertenece a esa propiedad", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());

  const noEsSuyo = await bd.fijarVentaAnimalGranja("animal:vaca:1000:0", "p_9999", "tend_1", 100);
  assert.strictEqual(noEsSuyo, false);

  const ok = await bd.fijarVentaAnimalGranja("animal:vaca:1000:0", "p_0001", "tend_1", 100);
  assert.strictEqual(ok, true);
  const enVenta = await bd.listarAnimalesEnVentaTenderete("tend_1");
  assert.strictEqual(enVenta.length, 1);
  assert.strictEqual(enVenta[0].enVentaPrecio, 100);

  await bd.fijarVentaAnimalGranja("animal:vaca:1000:0", "p_0001", null, null);
  assert.deepStrictEqual(await bd.listarAnimalesEnVentaTenderete("tend_1"), []);
  await bd.cerrar();
});

test("comprarAnimalGranja: cobra al comprador, abona al vendedor, y reubica el animal — todo o nada", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  await bd.fijarVentaAnimalGranja("animal:vaca:1000:0", "p_0001", "tend_1", 150);

  const vendedor = await bd.obtenerOCrearJugador("Ragnar");
  await bd.ajustarFarycoins(vendedor.id, 500);
  const comprador = await bd.obtenerOCrearJugador("Lagertha");
  await bd.ajustarFarycoins(comprador.id, 200);

  const r = await bd.comprarAnimalGranja({
    id: "animal:vaca:1000:0", tenderoteId: "tend_1", propiedadDestino: "p_0002", mapaIdDestino: "hub",
    x: 30, y: 40, compradorNombre: "Lagertha", duenoNombre: "Ragnar",
  });
  assert.deepStrictEqual(r, { ok: true, especieId: "vaca", precioTotal: 150 });

  const [fila] = await bd.listarAnimalesGranjaMapa("hub");
  assert.strictEqual(fila.propiedadId, "p_0002");
  assert.strictEqual(fila.x, 30);
  assert.strictEqual(fila.y, 40);
  assert.strictEqual(fila.enVentaTenderoteId, null, "sale de la venta al comprarse");

  assert.strictEqual((await bd.obtenerOCrearJugador("Lagertha")).farycoins, 70); // 20 iniciales + 200 - 150
  assert.strictEqual((await bd.obtenerOCrearJugador("Ragnar")).farycoins, 670); // 20 iniciales + 500 + 150
  await bd.cerrar();
});

test("comprarAnimalGranja: sin Farycoins suficientes, falla y NO mueve el animal", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  await bd.fijarVentaAnimalGranja("animal:vaca:1000:0", "p_0001", "tend_1", 999);
  await bd.obtenerOCrearJugador("Lagertha"); // sin saldo

  const r = await bd.comprarAnimalGranja({
    id: "animal:vaca:1000:0", tenderoteId: "tend_1", propiedadDestino: "p_0002", mapaIdDestino: "hub",
    x: 30, y: 40, compradorNombre: "Lagertha", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, false);
  const [fila] = await bd.listarAnimalesGranjaMapa("hub");
  assert.strictEqual(fila.propiedadId, "p_0001", "no se movió");
  await bd.cerrar();
});

test("comprarAnimalGranja: ya no está en venta ahí (vendido/quitado justo antes) — falla sin cobrar", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());
  // nunca se listó en tend_1
  const comprador = await bd.obtenerOCrearJugador("Lagertha");
  await bd.ajustarFarycoins(comprador.id, 200);

  const r = await bd.comprarAnimalGranja({
    id: "animal:vaca:1000:0", tenderoteId: "tend_1", propiedadDestino: "p_0002", mapaIdDestino: "hub",
    x: 30, y: 40, compradorNombre: "Lagertha", duenoNombre: "Ragnar",
  });
  assert.deepStrictEqual(r, { ok: false, motivo: "ese animal ya no está en venta aquí" });
  assert.strictEqual((await bd.obtenerOCrearJugador("Lagertha")).farycoins, 220, "no se cobró nada (20 iniciales + 200)");
  await bd.cerrar();
});

test("transferirAnimalGranja: reubica sin Farycoins (traspaso de comercio) — false si ya no pertenece al origen esperado", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearAnimalGranjaBd(filaDeEjemplo());

  const falloOrigen = await bd.transferirAnimalGranja("animal:vaca:1000:0", "p_9999", "p_0002", "hub", 1, 1);
  assert.strictEqual(falloOrigen, false);

  const ok = await bd.transferirAnimalGranja("animal:vaca:1000:0", "p_0001", "p_0002", "hub", 30, 40);
  assert.strictEqual(ok, true);
  const [fila] = await bd.listarAnimalesGranjaMapa("hub");
  assert.strictEqual(fila.propiedadId, "p_0002");
  assert.strictEqual(fila.x, 30);
  await bd.cerrar();
});
