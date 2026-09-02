// E2E de NPCs trabajadores contratables (docs/GDD_NPCs_Contratables.md,
// pedido 2026-09-01) contra el servidor REAL (Colyseus real, BD sqlite
// real, mapa demo). Dos arranques del servidor sobre la MISMA BD (igual que
// probar un reinicio real) porque el pago mensual se resuelve por DÍA DE
// MUNDO (30 min reales/día * 30 días = 15h reales — impracticable esperar
// en tiempo real): el primer arranque corre a la hora natural (para captar
// el día real de contratación), el segundo fuerza DIA_FORZADO a "+31 días"
// sobre ese mismo día para disparar el ciclo de pago sin BD nueva.
// Confirma:
//   A) el jarl coloca el reclutador (mismo mecanismo que un NPC tutorial).
//   B) reclutador:catalogo devuelve coste creciente por oficio.
//   C) contratar sin Farycoins suficientes se rechaza sin tocar nada.
//   D) contratar con fondos de sobra cobra el coste exacto y el trabajador
//      aparece YA en el mundo (state.npcs), con accion "trabajar" (sin mesa).
//   E) trabajador:listar lo devuelve; trabajador:despedir lo borra de BD y
//      del mundo (nunca vuelve).
//   F) un jugador sin ese trabajador no puede despedirlo ni asignarle nada.
//   G) segundo arranque, día de mundo +31 y saldo insuficiente: el tick de
//      payroll despide AUTOMÁTICAMENTE al trabajador contratado (desaparece
//      de state.npcs y de la BD) sin dejar Farycoins negativos.
//   node server/test/npcs_trabajadores.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "npcs_trabajadores_e2e.sqlite");
const PUERTO = 2604;
const JARL = "E2E-TrabajadoresJarl";
const OTRO = "E2E-TrabajadoresOtro";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl con 300 Farycoins, justo para 1 oficio pero no para 3)...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0,
      vida INTEGER NOT NULL DEFAULT 100,
      vida_max INTEGER NOT NULL DEFAULT 100,
      oficio_1 TEXT NOT NULL DEFAULT '',
      oficio_2 TEXT NOT NULL DEFAULT ''
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 150)").run(JARL, new Date().toISOString());
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (2, ?, ?, 150)").run(OTRO, new Date().toISOString());
  bd.close();
}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[srv:err] ${d}`));
  procesos.push(p);
  return p;
}
function matarTodo() {
  for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} try { p.kill("SIGKILL"); } catch {} }
  procesos.length = 0;
}
process.on("exit", matarTodo);

async function esperarPuerto(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
let diaContratacion = null;
try {
  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("2) arrancando servidor real (run 1, hora natural) sobre el mapa demo...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: JARL });
  await esperar(500);

  console.log("3) el jarl coloca el reclutador en su posición actual...");
  const colocados = [];
  room.onMessage("admin:npcTutorial:colocado", (m) => colocados.push(m));
  room.send("admin:npcTutorial:colocar", { tipoTutorial: "reclutador_trabajadores" });
  await esperar(400);
  if (colocados.length !== 1 || colocados[0].tipoTutorial !== "reclutador_trabajadores") {
    throw new Error(`FALLO: debería confirmar la colocación del reclutador, llegó ${JSON.stringify(colocados)}`);
  }
  console.log(`   OK: ${JSON.stringify(colocados[0])}`);

  console.log("4) reclutador:catalogo devuelve coste CRECIENTE por oficio adicional...");
  const catalogos = [];
  room.onMessage("reclutador:catalogo", (m) => catalogos.push(m));
  room.send("reclutador:catalogo");
  await esperar(300);
  // 12 oficios: los 10 de mesa/receta originales + "transporte" (fusionado
  // como oficio contratable normal, docs/GDD_NPCs_Contratables.md §Fusión
  // con transporte, 2026-09-01) + "tendero" (Mercado: tendero contratable,
  // rama paralela fusionada en main) — antes de eso el catálogo traía 10.
  if (catalogos.length !== 1 || catalogos[0].oficios.length !== 12) {
    throw new Error(`FALLO: catálogo debería traer los 12 oficios, llegó ${JSON.stringify(catalogos)}`);
  }
  const [c1, c2, c3] = catalogos[0].costePorCantidad;
  if (!(c1 < c2 && (c2 - c1) < (c3 - c2))) {
    throw new Error(`FALLO: el coste marginal debería crecer con cada oficio, llegó ${JSON.stringify(catalogos[0].costePorCantidad)}`);
  }
  console.log(`   OK: 1=${c1}, 2=${c2}, 3=${c3} (marginal creciente)`);

  console.log("5) contratar con 3 oficios (demasiado caro para 150 Farycoins) se rechaza sin tocar el saldo...");
  const erroresReclutador = [];
  room.onMessage("trabajador:error", (m) => erroresReclutador.push(m));
  room.send("reclutador:contratar", { oficios: ["herrero", "cocinero", "cazador"] });
  await esperar(400);
  if (!erroresReclutador.some((e) => /Farycoins/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazarse por Farycoins insuficientes, llegó ${JSON.stringify(erroresReclutador)}`);
  }
  const bdSaldoPrevio = new DatabaseSync(rutaBd);
  const saldoPrevio = Number(bdSaldoPrevio.prepare("SELECT farycoins FROM jugadores WHERE id = 1").get().farycoins);
  bdSaldoPrevio.close();
  if (saldoPrevio !== 150) throw new Error(`FALLO: el saldo no debería haber cambiado, quedó en ${saldoPrevio}`);
  console.log(`   OK: ${JSON.stringify(erroresReclutador[0])}, saldo intacto (${saldoPrevio})`);

  console.log("6) contratar con 1 oficio (cabe en el saldo) cobra el coste exacto y el trabajador aparece YA en el mundo...");
  const contratados = [];
  room.onMessage("reclutador:contratado", (m) => contratados.push(m));
  room.send("reclutador:contratar", { oficios: ["herrero"] });
  await esperar(500);
  if (contratados.length !== 1) throw new Error(`FALLO: debería confirmar la contratación, llegó ${JSON.stringify(contratados)}`);
  const trabajadorId = contratados[0].trabajador.id;
  diaContratacion = contratados[0].trabajador.fechaContratacionDia;
  if (contratados[0].saldoRestante !== 150 - c1) {
    throw new Error(`FALLO: el saldo restante debería ser ${150 - c1}, llegó ${contratados[0].saldoRestante}`);
  }
  const slotId = `trabajadorOficio_${trabajadorId}`;
  const npcEnMundo = room.state.npcs.get(slotId);
  if (!npcEnMundo || npcEnMundo.accion !== "trabajar") {
    throw new Error(`FALLO: el trabajador debería estar visible en state.npcs con accion "trabajar" (sin mesa todavía), llegó ${JSON.stringify(npcEnMundo)}`);
  }
  console.log(`   OK: trabajador #${trabajadorId} contratado por ${c1}, saldo restante ${contratados[0].saldoRestante}, visible en el mundo como ${slotId}`);

  console.log("7) trabajador:listar devuelve exactamente este trabajador, sin mesa ni receta...");
  const listados = [];
  room.onMessage("trabajador:listado", (m) => listados.push(m));
  room.send("trabajador:listar");
  await esperar(300);
  const listado = listados.at(-1);
  if (!listado || listado.trabajadores.length !== 1 || listado.trabajadores[0].id !== trabajadorId) {
    throw new Error(`FALLO: trabajador:listar debería devolver 1 trabajador, llegó ${JSON.stringify(listado)}`);
  }
  if (listado.trabajadores[0].construccionId !== null || listado.trabajadores[0].recetaId !== null) {
    throw new Error(`FALLO: recién contratado no debería tener mesa ni receta, llegó ${JSON.stringify(listado.trabajadores[0])}`);
  }
  console.log("   OK: listado exacto, sin mesa ni receta");

  console.log("8) un jugador SIN ese trabajador no puede despedirlo (no es suyo)...");
  const clienteOtro = new Client(`ws://localhost:${PUERTO}`);
  const roomOtro = await clienteOtro.joinOrCreate("hub", { name: OTRO });
  await esperar(400);
  const erroresOtro = [];
  roomOtro.onMessage("trabajador:error", (m) => erroresOtro.push(m));
  roomOtro.send("trabajador:despedir", { trabajadorId });
  await esperar(300);
  if (!erroresOtro.some((e) => /no es tuyo/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazarse por no ser el dueño, llegó ${JSON.stringify(erroresOtro)}`);
  }
  if (!room.state.npcs.get(slotId)) throw new Error("FALLO: el trabajador no debería haber desaparecido");
  console.log(`   OK: ${JSON.stringify(erroresOtro[0])}, el trabajador sigue en el mundo`);
  await roomOtro.leave();

  console.log("9) el dueño real SÍ puede despedirlo — desaparece de BD y del mundo, para siempre...");
  const despedidos = [];
  room.onMessage("trabajador:despedido", (m) => despedidos.push(m));
  room.send("trabajador:despedir", { trabajadorId });
  await esperar(400);
  if (despedidos.length !== 1 || despedidos[0].trabajadorId !== trabajadorId) {
    throw new Error(`FALLO: debería confirmar el despido, llegó ${JSON.stringify(despedidos)}`);
  }
  if (room.state.npcs.get(slotId)) throw new Error("FALLO: el trabajador debería haber desaparecido del mundo");
  const bdTrasDespido = new DatabaseSync(rutaBd);
  const filaTrasDespido = bdTrasDespido.prepare("SELECT * FROM npcs_trabajadores WHERE id = ?").get(trabajadorId);
  bdTrasDespido.close();
  if (filaTrasDespido) throw new Error(`FALLO: la fila debería haberse borrado, quedó ${JSON.stringify(filaTrasDespido)}`);
  console.log("   OK: borrado de BD y del mundo");

  await room.leave();
  matarTodo();
  await esperar(500);

  console.log("10) contrata un SEGUNDO trabajador (run nuevo) y deja el saldo a 0 para forzar el impago del mes siguiente...");
  // recarga el saldo del jarl (el trabajador #1 ya se llevó 100 en el paso 6) — simula que ganó más Farycoins mientras tanto.
  const bdRecarga = new DatabaseSync(rutaBd);
  bdRecarga.prepare("UPDATE jugadores SET farycoins = 150 WHERE id = 1").run();
  bdRecarga.close();
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  const cliente2 = new Client(`ws://localhost:${PUERTO}`);
  const room2 = await cliente2.joinOrCreate("hub", { name: JARL });
  await esperar(500);
  // el reclutador de la ronda 1 ya está persistido/recreado al arrancar — no hace falta volver a colocarlo.
  const contratados2 = [];
  const erroresTrabajador2 = [];
  room2.onMessage("reclutador:contratado", (m) => contratados2.push(m));
  room2.onMessage("trabajador:error", (m) => erroresTrabajador2.push(m));
  room2.send("reclutador:contratar", { oficios: ["herrero"] }); // saldo recargado a 150, cabe de sobra
  await esperar(500);
  if (contratados2.length !== 1) console.log(`   (debug) errores: ${JSON.stringify(erroresTrabajador2)}`);
  if (contratados2.length !== 1) throw new Error(`FALLO: debería contratar el segundo trabajador, llegó ${JSON.stringify(contratados2)}`);
  const trabajadorId2 = contratados2[0].trabajador.id;
  const slotId2 = `trabajadorOficio_${trabajadorId2}`;
  // vacía el saldo del jarl a 0 para que el pago del mes que viene sea imposible
  const bdVaciar = new DatabaseSync(rutaBd);
  bdVaciar.prepare("UPDATE jugadores SET farycoins = 0 WHERE id = 1").run();
  bdVaciar.close();
  await room2.leave();
  matarTodo();
  await esperar(500);

  console.log("11) tercer arranque, día de mundo forzado a +31 desde la contratación y saldo 0: el tick de payroll debe despedir automáticamente...");
  const diaPago = diaContratacion + 31;
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: JARL, DIA_FORZADO: String(diaPago) });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  const cliente3 = new Client(`ws://localhost:${PUERTO}`);
  const room3 = await cliente3.joinOrCreate("hub", { name: JARL });
  // el tick de payroll corre cada 10s (INTERVALO_TICK_TRABAJADOR_MS) — se espera algo más para dar margen.
  await esperar(13000);
  if (room3.state.npcs.get(slotId2)) {
    throw new Error("FALLO: el trabajador debería haber sido despedido automáticamente por impago");
  }
  const bdTrasImpago = new DatabaseSync(rutaBd);
  const filaTrasImpago = bdTrasImpago.prepare("SELECT * FROM npcs_trabajadores WHERE id = ?").get(trabajadorId2);
  const saldoFinal = Number(bdTrasImpago.prepare("SELECT farycoins FROM jugadores WHERE id = 1").get().farycoins);
  bdTrasImpago.close();
  if (filaTrasImpago) throw new Error(`FALLO: la fila debería haberse borrado por impago, quedó ${JSON.stringify(filaTrasImpago)}`);
  if (saldoFinal < 0) throw new Error(`FALLO: el saldo nunca debería quedar negativo, llegó a ${saldoFinal}`);
  console.log(`   OK: despedido automáticamente por impago (día ${diaPago}), saldo final ${saldoFinal} (nunca negativo)`);

  await room3.leave();

  console.log("\n✅ TODO OK: reclutador colocado por el jarl, catálogo con coste creciente, contratación cobra y hace aparecer al trabajador en el mundo, gating de dueño, despido manual persistente, y despido AUTOMÁTICO por impago del salario mensual sin dejar Farycoins negativos — todo contra el servidor real.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}

if (fallo) {
  console.error("\n❌ FALLO:", fallo.message || fallo);
  process.exit(1);
}
process.exit(0);
