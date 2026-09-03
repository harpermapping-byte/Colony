// Tests de reventa/oferta de inmueble entre jugadores (docs/GDD_Propiedades.md
// §7, pedido 2026-09-03: "solo el jarl puede revocar y reasignar" era el
// hueco real — el dueño ahora puede ofrecer/vender directamente a otro
// jugador, sin pasar por el jarl).
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatosSqlite as AlmacenDatos } from "../src/datos/bd";

test("crearOfertaInmueble + obtenerOfertaInmueble: guarda quién ofrece y por cuánto", async () => {
  const bd = new AlmacenDatos(":memory:");
  const vendedor = await bd.obtenerOCrearJugador("Vendedor");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, comprador.id, 100);
  const oferta = await bd.obtenerOfertaInmueble("i_aldea:casa_01", comprador.id);
  assert.deepStrictEqual(oferta, { ofertadoPorId: vendedor.id, precioFarycoins: 100, creadoEn: oferta!.creadoEn });
  await bd.cerrar();
});

test("crearOfertaInmueble es upsert: reofrecer a la misma persona actualiza el precio, no duplica fila", async () => {
  const bd = new AlmacenDatos(":memory:");
  const vendedor = await bd.obtenerOCrearJugador("Vendedor");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, comprador.id, 100);
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, comprador.id, 150);
  const oferta = await bd.obtenerOfertaInmueble("i_aldea:casa_01", comprador.id);
  assert.strictEqual(oferta!.precioFarycoins, 150);
  const recibidas = await bd.listarOfertasRecibidas(comprador.id);
  assert.strictEqual(recibidas.length, 1, "sin duplicados");
  await bd.cerrar();
});

test("listarOfertasRecibidas / listarOfertasHechas: resuelven el nombre del otro jugador, no solo el id", async () => {
  const bd = new AlmacenDatos(":memory:");
  const vendedor = await bd.obtenerOCrearJugador("Vendedor");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, comprador.id, 100);

  const recibidas = await bd.listarOfertasRecibidas(comprador.id);
  assert.strictEqual(recibidas.length, 1);
  assert.strictEqual(recibidas[0].ofertadoPorNombre, "Vendedor");
  assert.strictEqual(recibidas[0].propiedadId, "i_aldea:casa_01");

  const hechas = await bd.listarOfertasHechas(vendedor.id);
  assert.strictEqual(hechas.length, 1);
  assert.strictEqual(hechas[0].destinatarioNombre, "Comprador");
  await bd.cerrar();
});

test("transferirPropiedad: mueve Farycoins comprador->vendedor y el dueño de verdad, sin comisión del jarl", async () => {
  const bd = new AlmacenDatos(":memory:");
  const anterior = process.env.JARL_NOMBRES;
  process.env.JARL_NOMBRES = "Streamer"; // configurado, pero la reventa P2P no debe tocarlo
  try {
    const vendedor = await bd.obtenerOCrearJugador("Vendedor");
    const comprador = await bd.obtenerOCrearJugador("Comprador");
    await bd.ajustarFarycoins(comprador.id, 500);
    await bd.comprarOAlquilar({
      id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
      jugadorNombre: "Vendedor", modo: "compra", precioFarycoins: 0, periodoHoras: null,
    });

    const r = await bd.transferirPropiedad("i_aldea:casa_01", "Vendedor", "Comprador", 200);
    assert.strictEqual(r.ok, true);

    const prop = await bd.obtenerPropiedad("i_aldea:casa_01");
    assert.strictEqual(prop!.dueno, "Comprador");
    assert.strictEqual(await bd.obtenerFarycoins(comprador.id), 20 + 500 - 200);
    assert.strictEqual(await bd.obtenerFarycoins(vendedor.id), 20 + 200);
    const jarl = await bd.obtenerOCrearJugador("Streamer");
    assert.strictEqual(jarl.farycoins, 20, "la reventa P2P no reparte nada al jarl, a diferencia de comprarOAlquilar");
  } finally {
    if (anterior === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = anterior;
    await bd.cerrar();
  }
});

test("transferirPropiedad: limpia TODAS las ofertas pendientes sobre esa propiedad al completarse (aunque sean de otro destinatario)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const vendedor = await bd.obtenerOCrearJugador("Vendedor");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  const otro = await bd.obtenerOCrearJugador("Otro");
  await bd.ajustarFarycoins(comprador.id, 500);
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Vendedor", modo: "compra", precioFarycoins: 0, periodoHoras: null,
  });
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, comprador.id, 200);
  await bd.crearOfertaInmueble("i_aldea:casa_01", vendedor.id, otro.id, 999);

  await bd.transferirPropiedad("i_aldea:casa_01", "Vendedor", "Comprador", 200);

  assert.strictEqual(await bd.obtenerOfertaInmueble("i_aldea:casa_01", comprador.id), null);
  assert.strictEqual(await bd.obtenerOfertaInmueble("i_aldea:casa_01", otro.id), null);
  await bd.cerrar();
});

test("transferirPropiedad: falla si el vendedor ya no es el dueño (perdió la carrera), reembolsa al comprador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const vendedorOriginal = await bd.obtenerOCrearJugador("VendedorOriginal");
  const otroComprador = await bd.obtenerOCrearJugador("OtroComprador");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  await bd.ajustarFarycoins(comprador.id, 500);
  await bd.ajustarFarycoins(otroComprador.id, 500);
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "VendedorOriginal", modo: "compra", precioFarycoins: 0, periodoHoras: null,
  });
  // el jarl (o cualquier otra vía) le cambia el dueño antes de que se complete esta venta
  await bd.transferirPropiedad("i_aldea:casa_01", "VendedorOriginal", "OtroComprador", 1);

  const r = await bd.transferirPropiedad("i_aldea:casa_01", "VendedorOriginal", "Comprador", 200);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(await bd.obtenerFarycoins(comprador.id), 20 + 500, "reembolsado íntegro, nunca llegó a cobrarse de verdad");
  await bd.cerrar();
});

test("transferirPropiedad: rechaza sin fondos suficientes", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Vendedor");
  await bd.obtenerOCrearJugador("Comprador"); // solo 20 de saldo inicial
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Vendedor", modo: "compra", precioFarycoins: 0, periodoHoras: null,
  });
  const r = await bd.transferirPropiedad("i_aldea:casa_01", "Vendedor", "Comprador", 200);
  assert.strictEqual(r.ok, false);
  if (!r.ok) assert.match(r.motivo, /Farycoins/);
  await bd.cerrar();
});

test("transferirPropiedad: rechaza un alquiler (solo se revende lo comprado)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Comprador");
  await bd.ajustarFarycoins(comprador.id, 500);
  await bd.comprarOAlquilar({
    id: "h_aldea:taberna:0:1", tipo: "habitacion", asentamiento: "aldea",
    jugadorNombre: "Inquilino", modo: "alquiler", precioFarycoins: 10, periodoHoras: 24,
  });
  const r = await bd.transferirPropiedad("h_aldea:taberna:0:1", "Inquilino", "Comprador", 200);
  assert.strictEqual(r.ok, false);
  if (!r.ok) assert.match(r.motivo, /alquiler/);
  await bd.cerrar();
});

test("transferirPropiedad: no puedes comprarte tu propia propiedad", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Vendedor");
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Vendedor", modo: "compra", precioFarycoins: 0, periodoHoras: null,
  });
  const r = await bd.transferirPropiedad("i_aldea:casa_01", "Vendedor", "Vendedor", 1);
  assert.strictEqual(r.ok, false);
  await bd.cerrar();
});
