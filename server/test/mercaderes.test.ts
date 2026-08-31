// Tests de mercaderes NPC por oficio (docs/GDD_Economia.md §9, pedido
// 2026-08-31): selección determinista de artículos por NPC, precios
// derivados de un precioBase único (±20%/-50%), y el reinicio de stock/
// presupuesto de compra DIARIO REAL (Date.now(), no día de mundo).
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatosSqlite as AlmacenDatos } from "../src/datos/bd";
import {
  cargarCatalogoMercaderes,
  esOficioMercader,
  elegirArticulosDeMercader,
  precioVentaMercader,
  precioCompraMercader,
  rangoStockMercader,
  limiteCompraDiarioMercader,
  stockAleatorioEnRango,
  MARGEN_VENTA_MERCADER,
  MARGEN_COMPRA_MERCADER,
} from "../src/mercado/catalogoMercaderes";

const catalogo = cargarCatalogoMercaderes();

test("esOficioMercader: true para un oficio con pool, false para uno sin pool o undefined", () => {
  assert.strictEqual(esOficioMercader("tendero", catalogo), true);
  assert.strictEqual(esOficioMercader("herrero", catalogo), true);
  assert.strictEqual(esOficioMercader("vagabundo", catalogo), false);
  assert.strictEqual(esOficioMercader(undefined, catalogo), false);
});

test("elegirArticulosDeMercader: determinista — mismo npcId+oficio siempre da la misma selección", () => {
  const entrada = catalogo.oficios["herrero"];
  const a = elegirArticulosDeMercader("rio-3|herrero_0", "herrero", entrada, catalogo.config);
  const b = elegirArticulosDeMercader("rio-3|herrero_0", "herrero", entrada, catalogo.config);
  assert.deepStrictEqual(a, b);
});

test("elegirArticulosDeMercader: dos NPC distintos del mismo oficio pueden diferir en su selección", () => {
  const entrada = catalogo.oficios["herrero"];
  const a = elegirArticulosDeMercader("rio-3|herrero_0", "herrero", entrada, catalogo.config);
  const b = elegirArticulosDeMercader("rio-3|herrero_1", "herrero", entrada, catalogo.config);
  assert.notDeepStrictEqual(a, b, "con distinta semilla, la selección no debería ser idéntica (probabilísticamente)");
});

test("elegirArticulosDeMercader: tamaño dentro de [itemsPorMercaderMin, itemsPorMercaderMax] acotado al tamaño real del pool", () => {
  for (const [oficio, entrada] of Object.entries(catalogo.oficios)) {
    const poolSize = Object.keys(entrada.pool).length;
    const min = Math.min(catalogo.config.itemsPorMercaderMin, poolSize);
    const max = Math.min(catalogo.config.itemsPorMercaderMax, poolSize);
    for (const npcId of ["a", "b", "c", "d", "e"]) {
      const seleccion = elegirArticulosDeMercader(npcId, oficio, entrada, catalogo.config);
      assert.ok(seleccion.length >= min && seleccion.length <= max, `${oficio}/${npcId}: ${seleccion.length} fuera de [${min},${max}]`);
      assert.ok(new Set(seleccion).size === seleccion.length, "sin duplicados");
      for (const itemId of seleccion) assert.ok(itemId in entrada.pool, `${itemId} no está en el pool de ${oficio}`);
    }
  }
});

test("precioVentaMercader/precioCompraMercader: derivan de precioBase con los márgenes pedidos (+20%/-50%)", () => {
  assert.strictEqual(MARGEN_VENTA_MERCADER, 1.2);
  assert.strictEqual(MARGEN_COMPRA_MERCADER, 0.5);
  assert.strictEqual(precioVentaMercader(10), 12);
  assert.strictEqual(precioCompraMercader(10), 5);
  assert.strictEqual(precioVentaMercader(5), 6);
  assert.strictEqual(precioCompraMercader(1), 1, "nunca redondea a 0 — precioCompra siempre cobra/paga al menos 1 si precioBase>=1");
});

test("rangoStockMercader/limiteCompraDiarioMercader: caen a los valores por defecto de config si el oficio no los sobreescribe", () => {
  const entrada = catalogo.oficios["tendero"];
  assert.deepStrictEqual(rangoStockMercader(entrada, catalogo.config), [catalogo.config.stockMinDefecto, catalogo.config.stockMaxDefecto]);
  assert.strictEqual(limiteCompraDiarioMercader(entrada, catalogo.config), catalogo.config.limiteCompraDiarioDefecto);
});

test("rangoStockMercader: un override por oficio gana al valor por defecto", () => {
  const entradaConOverride = { pool: { x: 1 }, stockMin: 2, stockMax: 9, limiteCompraDiario: 7 };
  assert.deepStrictEqual(rangoStockMercader(entradaConOverride, catalogo.config), [2, 9]);
  assert.strictEqual(limiteCompraDiarioMercader(entradaConOverride, catalogo.config), 7);
});

test("stockAleatorioEnRango: entero dentro de [min,max], respeta el rnd inyectado", () => {
  assert.strictEqual(stockAleatorioEnRango(5, 20, () => 0), 5);
  assert.strictEqual(stockAleatorioEnRango(5, 20, () => 0.999999999), 20);
  assert.strictEqual(stockAleatorioEnRango(10, 10, () => 0.5), 10, "min===max: siempre ese valor");
  for (let i = 0; i < 50; i++) {
    const v = stockAleatorioEnRango(3, 8, Math.random);
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 8, `${v} fuera de [3,8]`);
  }
});

test("fijarStockTenderete: FIJA la cantidad (no la suma, a diferencia de reponerStockTenderete)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.fijarStockTenderete("npc:rio-3|herrero_0", "hierro", 12, 3);
  let stock = await bd.listarStockTenderete("npc:rio-3|herrero_0");
  assert.strictEqual(stock.find((s) => s.itemId === "hierro")?.cantidad, 12);
  await bd.fijarStockTenderete("npc:rio-3|herrero_0", "hierro", 5, 3);
  stock = await bd.listarStockTenderete("npc:rio-3|herrero_0");
  assert.strictEqual(stock.find((s) => s.itemId === "hierro")?.cantidad, 5, "el segundo fijado REEMPLAZA, no suma (5, no 17)");
  await bd.cerrar();
});

test("resolverResetStockMercader: toca reiniciar la primera vez que se ve al NPC (tras crear su fila con resolverIngresoDiarioNpc)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|herrero_a", 10); // crea la fila, mismo contrato que en RoomExteriorBase
  const r = await bd.resolverResetStockMercader("npc:rio-3|herrero_a", 1_000_000, 24 * 3_600_000);
  assert.strictEqual(r, true);
  await bd.cerrar();
});

test("resolverResetStockMercader: dentro de la ventana (<24h reales) no vuelve a tocar reiniciar", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|herrero_b", 10);
  const ahora = 1_000_000;
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_b", ahora, 24 * 3_600_000), true);
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_b", ahora + 1000, 24 * 3_600_000), false, "1 segundo después, sigue dentro de la ventana");
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_b", ahora + 23 * 3_600_000, 24 * 3_600_000), false, "23h después, aún no toca");
  await bd.cerrar();
});

test("resolverResetStockMercader: pasadas >=24h REALES desde el último reinicio, vuelve a tocar (independiente del día de mundo)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|herrero_c", 10);
  const ahora = 1_000_000;
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_c", ahora, 24 * 3_600_000), true);
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_c", ahora + 24 * 3_600_000, 24 * 3_600_000), true, "exactamente 24h después: toca");
  await bd.cerrar();
});

test("resolverResetStockMercader: tras varios días sin visitas, un solo reinicio basta (no hay 'catch-up' acumulativo — es un reinicio absoluto, no un contador)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.resolverIngresoDiarioNpc("npc:rio-3|herrero_d", 10);
  const ahora = 1_000_000;
  await bd.resolverResetStockMercader("npc:rio-3|herrero_d", ahora, 24 * 3_600_000);
  const tresDiasDespues = ahora + 3 * 24 * 3_600_000;
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_d", tresDiasDespues, 24 * 3_600_000), true);
  // inmediatamente después, ya no vuelve a tocar (se marcó UNA vez, no una por cada día atrasado)
  assert.strictEqual(await bd.resolverResetStockMercader("npc:rio-3|herrero_d", tresDiasDespues + 1000, 24 * 3_600_000), false);
  await bd.cerrar();
});
