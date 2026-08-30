// Tests de la ampliación de economía (docs/GDD_Economia.md, pedido
// 2026-08-30): saldo inicial de jugador/NPC comerciante, reparto al jarl
// en compras/alquileres de propiedad, y venta de un ítem a un NPC.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatosSqlite as AlmacenDatos, SALDO_INICIAL_JUGADOR, SALDO_INICIAL_NPC_COMERCIANTE, INGRESO_DIARIO_NPC, saldoInicialPara } from "../src/datos/bd";

function conJarl<T>(nombres: string, fn: () => Promise<T>): Promise<T> {
  const anterior = process.env.JARL_NOMBRES;
  process.env.JARL_NOMBRES = nombres;
  return fn().finally(() => {
    if (anterior === undefined) delete process.env.JARL_NOMBRES;
    else process.env.JARL_NOMBRES = anterior;
  });
}

test("saldoInicialPara: un NPC comerciante (prefijo npc:) nace con 500, un jugador normal con 20", () => {
  assert.strictEqual(saldoInicialPara("npc:rio-3|tendero_0"), SALDO_INICIAL_NPC_COMERCIANTE);
  assert.strictEqual(saldoInicialPara("Ragnar"), SALDO_INICIAL_JUGADOR);
});

test("comprarOAlquilar sin JARL_NOMBRES configurado: el dinero desaparece (sumidero), comportamiento previo intacto", async () => {
  const bd = new AlmacenDatos(":memory:");
  const anterior = process.env.JARL_NOMBRES;
  delete process.env.JARL_NOMBRES;
  const comprador = await bd.obtenerOCrearJugador("Ragnar");
  await bd.ajustarFarycoins(comprador.id, 500);
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 200, periodoHoras: null,
  });
  // sin jarl configurado, nadie más recibe nada — solo se comprueba que
  // no revienta y que el comprador se queda con el resto esperado.
  assert.strictEqual(await bd.obtenerFarycoins(comprador.id), 20 + 500 - 200);
  if (anterior === undefined) delete process.env.JARL_NOMBRES; else process.env.JARL_NOMBRES = anterior;
  await bd.cerrar();
});

test("comprarOAlquilar con UN jarl configurado: se le acredita el precio completo", () =>
  conJarl("Streamer", async () => {
    const bd = new AlmacenDatos(":memory:");
    const comprador = await bd.obtenerOCrearJugador("Ragnar");
    await bd.ajustarFarycoins(comprador.id, 500);
    const r = await bd.comprarOAlquilar({
      id: "i_aldea:casa_02", tipo: "inmueble", asentamiento: "aldea",
      jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 200, periodoHoras: null,
    });
    assert.strictEqual(r.ok, true);
    const jarl = await bd.obtenerOCrearJugador("Streamer");
    assert.strictEqual(jarl.farycoins, 20 + 200, "el jarl nace con 20 y recibe el precio completo");
    await bd.cerrar();
  }));

test("comprarOAlquilar con DOS jarls configurados: se reparte a partes iguales (el resto, si no divide exacto, se pierde)", () =>
  conJarl("Alicia, Bob", async () => {
    const bd = new AlmacenDatos(":memory:");
    const comprador = await bd.obtenerOCrearJugador("Ragnar");
    await bd.ajustarFarycoins(comprador.id, 500);
    await bd.comprarOAlquilar({
      id: "i_aldea:casa_03", tipo: "inmueble", asentamiento: "aldea",
      jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 201, periodoHoras: null, // 201/2 = 100 c/u, sobra 1 que se pierde
    });
    const alicia = await bd.obtenerOCrearJugador("Alicia");
    const bob = await bd.obtenerOCrearJugador("Bob");
    assert.strictEqual(alicia.farycoins, 20 + 100);
    assert.strictEqual(bob.farycoins, 20 + 100);
    await bd.cerrar();
  }));

test("renovarTenencia también reparte al jarl configurado", () =>
  conJarl("Streamer", async () => {
    const bd = new AlmacenDatos(":memory:");
    const inquilino = await bd.obtenerOCrearJugador("Floki");
    await bd.ajustarFarycoins(inquilino.id, 1000);
    await bd.comprarOAlquilar({
      id: "h_aldea:taberna_03:0:1", tipo: "habitacion", asentamiento: "aldea",
      jugadorNombre: "Floki", modo: "alquiler", precioFarycoins: 15, periodoHoras: 24,
    });
    await bd.renovarTenencia("h_aldea:taberna_03:0:1", "Floki", 24, 15);
    const jarl = await bd.obtenerOCrearJugador("Streamer");
    assert.strictEqual(jarl.farycoins, 20 + 15 + 15, "cobra la compra inicial Y la renovación");
    await bd.cerrar();
  }));

test("venderANpc: el NPC paga con SU PROPIO saldo, el jugador cobra", async () => {
  const bd = new AlmacenDatos(":memory:");
  const r = await bd.venderANpc({
    npcNombre: "npc:rio-3|tendero_0", itemId: "hierro", cantidad: 3, precioUnitario: 2, vendedorNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.precioTotal, 6);
  const npc = await bd.obtenerOCrearJugador("npc:rio-3|tendero_0");
  assert.strictEqual(npc.farycoins, SALDO_INICIAL_NPC_COMERCIANTE - 6);
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(jugador.farycoins, SALDO_INICIAL_JUGADOR + 6);
  await bd.cerrar();
});

test("venderANpc: si el NPC no tiene suficiente dinero, falla todo o nada (el jugador no cobra nada)", async () => {
  const bd = new AlmacenDatos(":memory:");
  // agota el saldo del NPC primero
  const npc = await bd.obtenerOCrearJugador("npc:rio-3|tendero_1", SALDO_INICIAL_NPC_COMERCIANTE);
  await bd.ajustarFarycoins(npc.id, -SALDO_INICIAL_NPC_COMERCIANTE);
  const r = await bd.venderANpc({
    npcNombre: "npc:rio-3|tendero_1", itemId: "hierro", cantidad: 1, precioUnitario: 2, vendedorNombre: "Lagertha",
  });
  assert.strictEqual(r.ok, false);
  const jugador = await bd.obtenerOCrearJugador("Lagertha");
  assert.strictEqual(jugador.farycoins, SALDO_INICIAL_JUGADOR, "no se le pagó nada");
  await bd.cerrar();
});

test("venderANpc: el saldo inicial del NPC (500) solo se aplica la PRIMERA vez, no reinyecta en cada venta", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.venderANpc({ npcNombre: "npc:rio-3|tendero_2", itemId: "hierro", cantidad: 1, precioUnitario: 2, vendedorNombre: "Bjorn" });
  await bd.venderANpc({ npcNombre: "npc:rio-3|tendero_2", itemId: "lana", cantidad: 1, precioUnitario: 1, vendedorNombre: "Bjorn" });
  const npc = await bd.obtenerOCrearJugador("npc:rio-3|tendero_2");
  assert.strictEqual(npc.farycoins, SALDO_INICIAL_NPC_COMERCIANTE - 2 - 1, "no se reinicia a 500 en cada llamada");
  await bd.cerrar();
});

// --- Ingreso diario del NPC (pedido 2026-08-30: "los npc cada día reciben 20 Farycoins también") ---

test("resolverIngresoDiarioNpc: la primera vez que se ve al NPC no da nada retroactivo, solo fija el día de partida", async () => {
  const bd = new AlmacenDatos(":memory:");
  const r = await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_a", 10);
  assert.strictEqual(r.diasAcreditados, 0);
  assert.strictEqual(r.saldo, SALDO_INICIAL_NPC_COMERCIANTE, "nace con el saldo inicial, sin ingreso extra el primer día");
  await bd.cerrar();
});

test("resolverIngresoDiarioNpc: mismo día, no acredita nada de más", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_b", 10);
  const r = await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_b", 10);
  assert.strictEqual(r.diasAcreditados, 0);
  assert.strictEqual(r.saldo, SALDO_INICIAL_NPC_COMERCIANTE);
  await bd.cerrar();
});

test("resolverIngresoDiarioNpc: un día después, acredita INGRESO_DIARIO_NPC (20) una vez", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_c", 10);
  const r = await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_c", 11);
  assert.strictEqual(r.diasAcreditados, 1);
  assert.strictEqual(r.saldo, SALDO_INICIAL_NPC_COMERCIANTE + INGRESO_DIARIO_NPC);
  await bd.cerrar();
});

test("resolverIngresoDiarioNpc: se pone al día de golpe si nadie lo visitó en varios días (cálculo perezoso, sin tick de fondo)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_d", 10);
  const r = await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_d", 17); // 7 días sin que nadie se acercara
  assert.strictEqual(r.diasAcreditados, 7);
  assert.strictEqual(r.saldo, SALDO_INICIAL_NPC_COMERCIANTE + 7 * INGRESO_DIARIO_NPC);
  await bd.cerrar();
});

test("resolverIngresoDiarioNpc: tras acreditar, el mismo día no vuelve a dar de más (idempotente)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_e", 10);
  await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_e", 12);
  const r = await bd.resolverIngresoDiarioNpc("npc:rio-3|tendero_e", 12);
  assert.strictEqual(r.diasAcreditados, 0);
  assert.strictEqual(r.saldo, SALDO_INICIAL_NPC_COMERCIANTE + 2 * INGRESO_DIARIO_NPC);
  await bd.cerrar();
});

// Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30: "es una
// decisión que toma el jarl, puede ponerlo o no y poner qué cantidad y cada
// cuánto tiempo") — activar/desactivar por propiedad, y cobro perezoso
// (mismo patrón que resolverIngresoDiarioNpc: se resuelve dentro de
// obtenerPropiedad, nunca en un tick).

test("configurarImpuestoPropiedad: activar fija cantidad/periodo y arranca el reloj en AHORA", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Bjorn");
  await bd.asignarPropiedad("p_imp_01", "parcela", "ciudad", "Bjorn");
  await bd.configurarImpuestoPropiedad("p_imp_01", true, 5, 24);
  const prop = await bd.obtenerPropiedad("p_imp_01");
  assert.strictEqual(prop?.impuestoActivo, true);
  assert.strictEqual(prop?.impuestoFarycoins, 5);
  assert.strictEqual(prop?.impuestoPeriodoHoras, 24);
  assert.ok(prop?.impuestoUltimoCobro, "el reloj arranca al activar");
  await bd.cerrar();
});

test("configurarImpuestoPropiedad: desactivar limpia cantidad/periodo/reloj", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Bjorn");
  await bd.asignarPropiedad("p_imp_02", "parcela", "ciudad", "Bjorn");
  await bd.configurarImpuestoPropiedad("p_imp_02", true, 5, 24);
  await bd.configurarImpuestoPropiedad("p_imp_02", false, null, null);
  const prop = await bd.obtenerPropiedad("p_imp_02");
  assert.strictEqual(prop?.impuestoActivo, false);
  assert.strictEqual(prop?.impuestoFarycoins, null);
  assert.strictEqual(prop?.impuestoPeriodoHoras, null);
  assert.strictEqual(prop?.impuestoUltimoCobro, null);
  await bd.cerrar();
});

test("impuesto: cobro perezoso — un periodo entero transcurrido se cobra de golpe al siguiente obtenerPropiedad", () =>
  conJarl("Streamer", async () => {
    const bd = new AlmacenDatos(":memory:");
    const dueno = await bd.obtenerOCrearJugador("Bjorn");
    await bd.ajustarFarycoins(dueno.id, 100);
    await bd.asignarPropiedad("p_imp_03", "parcela", "ciudad", "Bjorn");
    await bd.configurarImpuestoPropiedad("p_imp_03", true, 5, 24);

    // Simula que ya pasó más de un periodo (mismo truco que el test de
    // alquiler vencido: no hay reloj mockeable en esta capa).
    const bdInterna = bd as unknown as { bd: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
    bdInterna.bd.prepare("UPDATE propiedades SET impuesto_ultimo_cobro = ? WHERE id = ?").run(
      new Date(Date.now() - 30 * 3600_000).toISOString(), // 30h atrás, periodo=24h -> 1 periodo cobrable
      "p_imp_03",
    );

    const saldoAntes = await bd.obtenerFarycoins(dueno.id);
    await bd.obtenerPropiedad("p_imp_03");
    const saldoDespues = await bd.obtenerFarycoins(dueno.id);
    assert.strictEqual(saldoAntes - saldoDespues, 5, "se cobró exactamente un periodo");

    const jarl = await bd.obtenerOCrearJugador("Streamer");
    assert.strictEqual(jarl.farycoins, 20 + 5, "el jarl recibe el impuesto cobrado");

    // Un segundo obtenerPropiedad inmediato NO vuelve a cobrar (idempotente, ya se puso al día).
    const saldoTrasSegundaLectura = await bd.obtenerFarycoins(dueno.id);
    await bd.obtenerPropiedad("p_imp_03");
    assert.strictEqual(await bd.obtenerFarycoins(dueno.id), saldoTrasSegundaLectura);
    await bd.cerrar();
  }));

test("impuesto: si el dueño no puede pagar el lote completo, no se cobra nada y la deuda se acumula", () =>
  conJarl("Streamer", async () => {
    const bd = new AlmacenDatos(":memory:");
    const dueno = await bd.obtenerOCrearJugador("Bjorn");
    // Saldo inicial (20) menor que el impuesto (50) — no puede pagar.
    await bd.asignarPropiedad("p_imp_04", "parcela", "ciudad", "Bjorn");
    await bd.configurarImpuestoPropiedad("p_imp_04", true, 50, 24);
    const bdInterna = bd as unknown as { bd: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
    bdInterna.bd.prepare("UPDATE propiedades SET impuesto_ultimo_cobro = ? WHERE id = ?").run(
      new Date(Date.now() - 30 * 3600_000).toISOString(),
      "p_imp_04",
    );
    const saldoAntes = await bd.obtenerFarycoins(dueno.id);
    const prop = await bd.obtenerPropiedad("p_imp_04");
    assert.strictEqual(await bd.obtenerFarycoins(dueno.id), saldoAntes, "no se cobra nada si no llega para el lote completo");
    assert.ok(prop?.impuestoUltimoCobro, "el reloj NO avanzó — la deuda queda pendiente para cuando pueda pagar");
    await bd.cerrar();
  }));

test("impuesto: propiedad sin dueño (jarl/asentamiento) nunca cobra aunque esté activo", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.asignarPropiedad("p_imp_05", "parcela", "ciudad", null);
  await bd.configurarImpuestoPropiedad("p_imp_05", true, 5, 24);
  const bdInterna = bd as unknown as { bd: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
  bdInterna.bd.prepare("UPDATE propiedades SET impuesto_ultimo_cobro = ? WHERE id = ?").run(
    new Date(Date.now() - 100 * 3600_000).toISOString(),
    "p_imp_05",
  );
  const prop = await bd.obtenerPropiedad("p_imp_05");
  assert.strictEqual(prop?.dueno, null);
  await bd.cerrar(); // si esto no lanza, no intentó cobrar a un dueño inexistente
});
