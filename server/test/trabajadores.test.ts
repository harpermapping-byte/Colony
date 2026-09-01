// Tests de NPCs trabajadores contratables (docs/GDD_NPCs_Contratables.md,
// pedido 2026-09-01): coste de contratación creciente por oficio, salario
// mensual, cálculo perezoso del día de pago (payroll en bloque + despido
// por antigüedad cuando no alcanza), y persistencia en BD (sqlite en
// memoria, mismo patrón que economia.test.ts/mercaderes.test.ts).
import { test } from "node:test";
import * as assert from "node:assert";
import {
  costeContratacionTrabajador,
  salarioMensualTrabajador,
  oficiosValidos,
  puedeOperarOficio,
  resolverPayroll,
  DIAS_POR_MES_TRABAJADOR,
  COSTE_BASE_OFICIO_TRABAJADOR,
} from "../src/construccion/trabajadores";
import { AlmacenDatosSqlite as AlmacenDatos } from "../src/datos/bd";

// --- coste de contratación ---

test("costeContratacionTrabajador: 1 oficio cuesta el base, más oficios cuesta más que lineal (marginal creciente)", () => {
  const c1 = costeContratacionTrabajador(1);
  const c2 = costeContratacionTrabajador(2);
  const c3 = costeContratacionTrabajador(3);
  assert.strictEqual(c1, COSTE_BASE_OFICIO_TRABAJADOR);
  assert.ok(c2 > c1 * 2 - 1, "el 2º oficio no puede ser más barato que el 1º (progresión creciente)");
  const marginal2 = c2 - c1;
  const marginal3 = c3 - c2;
  assert.ok(marginal3 > marginal2, `el coste marginal del 3er oficio (${marginal3}) debe superar al del 2º (${marginal2})`);
});

test("oficiosValidos: rechaza vacío, duplicados y oficios fuera del catálogo cerrado; acepta subconjuntos reales", () => {
  assert.strictEqual(oficiosValidos([]), false);
  assert.strictEqual(oficiosValidos(["herrero", "herrero"]), false);
  assert.strictEqual(oficiosValidos(["mago"]), false);
  assert.strictEqual(oficiosValidos(["herrero"]), true);
  assert.strictEqual(oficiosValidos(["herrero", "cocinero", "curandero"]), true);
});

test("puedeOperarOficio: solo con el oficio de la receta entre los suyos", () => {
  assert.strictEqual(puedeOperarOficio(["herrero", "cocinero"], "herrero"), true);
  assert.strictEqual(puedeOperarOficio(["herrero", "cocinero"], "joyero"), false);
});

// --- salario y payroll ---

test("salarioMensualTrabajador escala con el número de oficios", () => {
  assert.ok(salarioMensualTrabajador(2) > salarioMensualTrabajador(1));
});

test("resolverPayroll: no toca pagar antes de cumplirse el ciclo", () => {
  const r = resolverPayroll([{ id: 1, oficios: ["herrero"], fechaContratacionDia: 0, ultimoPagoDia: 0 }], DIAS_POR_MES_TRABAJADOR - 1, 1000);
  assert.strictEqual(r.tocaPagar, false);
  assert.strictEqual(r.aDespedir.length, 0);
});

test("resolverPayroll: con saldo de sobra, paga a TODOS de golpe y no despide a nadie", () => {
  const trabajadores = [
    { id: 1, oficios: ["herrero"], fechaContratacionDia: 0, ultimoPagoDia: 0 },
    { id: 2, oficios: ["cocinero", "cazador"], fechaContratacionDia: 5, ultimoPagoDia: 0 },
  ];
  const r = resolverPayroll(trabajadores, DIAS_POR_MES_TRABAJADOR, 100000);
  assert.strictEqual(r.tocaPagar, true);
  assert.strictEqual(r.aDespedir.length, 0);
  assert.strictEqual(r.aPagar.length, 2);
  assert.strictEqual(r.costeTotal, salarioMensualTrabajador(1) + salarioMensualTrabajador(2));
});

test("resolverPayroll: el ANCLA es el ultimoPagoDia MÁS ANTIGUO del grupo — un trabajador contratado luego se pliega al ciclo", () => {
  const trabajadores = [
    { id: 1, oficios: ["herrero"], fechaContratacionDia: 0, ultimoPagoDia: 0 },
    { id: 2, oficios: ["cocinero"], fechaContratacionDia: 25, ultimoPagoDia: 25 }, // contratado tarde, ultimoPagoDia propio más reciente
  ];
  // día 30: el trabajador 1 lleva 30 días desde su último pago (cumple el ciclo);
  // el 2 solo lleva 5, pero se paga igual porque el grupo se sincroniza al más antiguo.
  const r = resolverPayroll(trabajadores, DIAS_POR_MES_TRABAJADOR, 100000);
  assert.strictEqual(r.tocaPagar, true);
  assert.strictEqual(r.aPagar.length, 2);
});

test("resolverPayroll: sin fondos para todos, despide a los MÁS RECIENTES primero hasta que el resto quepa", () => {
  const trabajadores = [
    { id: 1, oficios: ["herrero"], fechaContratacionDia: 0, ultimoPagoDia: 0 }, // más antiguo — se protege
    { id: 2, oficios: ["cocinero"], fechaContratacionDia: 1, ultimoPagoDia: 0 },
    { id: 3, oficios: ["cazador"], fechaContratacionDia: 2, ultimoPagoDia: 0 }, // más reciente — el primero en caer
  ];
  const salarioUno = salarioMensualTrabajador(1);
  // saldo alcanza para 2, no para los 3
  const r = resolverPayroll(trabajadores, DIAS_POR_MES_TRABAJADOR, salarioUno * 2);
  assert.strictEqual(r.tocaPagar, true);
  assert.strictEqual(r.aPagar.length, 2, "quedan los 2 más antiguos");
  assert.deepStrictEqual(r.aPagar.map((t) => t.id).sort(), [1, 2]);
  assert.deepStrictEqual(r.aDespedir.map((t) => t.id), [3], "el más reciente (id 3) es el único despedido");
  assert.strictEqual(r.costeTotal, salarioUno * 2);
});

test("resolverPayroll: si ni siquiera alcanza para el más antiguo, se despide a todos y no se cobra nada", () => {
  const trabajadores = [
    { id: 1, oficios: ["herrero"], fechaContratacionDia: 0, ultimoPagoDia: 0 },
    { id: 2, oficios: ["cocinero"], fechaContratacionDia: 1, ultimoPagoDia: 0 },
  ];
  const r = resolverPayroll(trabajadores, DIAS_POR_MES_TRABAJADOR, 0);
  assert.strictEqual(r.tocaPagar, true);
  assert.strictEqual(r.aPagar.length, 0);
  assert.strictEqual(r.aDespedir.length, 2);
  assert.strictEqual(r.costeTotal, 0);
});

// --- persistencia BD (sqlite en memoria) ---

test("BD: contratar/asignar mesa/asignar receta/listar/despedir un trabajador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const dueno = await bd.obtenerOCrearJugador("Ragnar");
  const fila = await bd.contratarNpcTrabajador({
    mapaId: "capital", duenoId: dueno.id, nombre: "Bjorn", oficios: ["herrero", "cocinero"], x: 10, y: 20, diaActual: 5,
  });
  assert.strictEqual(fila.construccionId, null);
  assert.strictEqual(fila.recetaId, null);
  assert.deepStrictEqual(fila.oficios, ["herrero", "cocinero"]);
  assert.strictEqual(fila.fechaContratacionDia, 5);
  assert.strictEqual(fila.ultimoPagoDia, 5);

  const okMesa = await bd.asignarMesaNpcTrabajador(fila.id, 42, 11, 22);
  assert.strictEqual(okMesa, true);
  const okReceta = await bd.asignarRecetaNpcTrabajador(fila.id, "espada_hierro");
  assert.strictEqual(okReceta, true);

  const [recargado] = await bd.listarNpcsTrabajadoresDeJugador(dueno.id);
  assert.strictEqual(recargado.construccionId, 42);
  assert.strictEqual(recargado.x, 11);
  assert.strictEqual(recargado.y, 22);
  assert.strictEqual(recargado.recetaId, "espada_hierro");

  const delMapa = await bd.listarNpcsTrabajadoresDeMapa("capital");
  assert.strictEqual(delMapa.length, 1);

  await bd.marcarPagoNpcTrabajador([fila.id], 35);
  const [pagado] = await bd.listarNpcsTrabajadoresDeJugador(dueno.id);
  assert.strictEqual(pagado.ultimoPagoDia, 35);

  const despedido = await bd.despedirNpcTrabajador(fila.id);
  assert.strictEqual(despedido, true);
  assert.strictEqual((await bd.listarNpcsTrabajadoresDeJugador(dueno.id)).length, 0);
  // despedir de nuevo el mismo id ya no encuentra fila
  assert.strictEqual(await bd.despedirNpcTrabajador(fila.id), false);

  await bd.cerrar();
});

test("BD: el pago/despido de un trabajador nunca deja Farycoins negativos (ajustarFarycoins compare-and-swap)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const dueno = await bd.obtenerOCrearJugador("Ragnar"); // nace con 20
  const saldo = await bd.obtenerFarycoins(dueno.id);
  const debito = await bd.ajustarFarycoins(dueno.id, -(saldo + 1000));
  assert.strictEqual(debito.ok, false, "restar más de lo que hay se rechaza entero, nunca deja negativo");
  assert.strictEqual(await bd.obtenerFarycoins(dueno.id), saldo);
  await bd.cerrar();
});
