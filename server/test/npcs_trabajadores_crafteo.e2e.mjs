// E2E del flujo COMPLETO de un NPC trabajador contratable con una mesa REAL
// (docs/GDD_NPCs_Contratables.md, pedido 2026-09-01 — la parte que el E2E
// original, npcs_trabajadores.e2e.mjs, dejó anotada como "no verificada en
// vivo": mesa real → asignar receta → tick de crafteo → producto real).
// Contra el servidor REAL (Colyseus real, BD sqlite real, mapa PRINCIPAL —
// mismo criterio que herreria.e2e.mjs) con una construcción "yunque_tocon"
// sembrada DIRECTO en BD como atajo de test (mismo patrón que ya usan
// herreria.e2e.mjs/alquimia.e2e.mjs/cocina.e2e.mjs para saltarse la UI de
// colocación estilo PZ, que ya se prueba en otro sitio — GDD_Construccion.md
// §1, no es el objetivo de ESTE E2E). Confirma:
//   1) el jarl coloca el reclutador y contrata un trabajador herrero.
//   2) trabajador:asignarMesa lo teleporta a la mesa sembrada (posición real
//      en state.npcs, sin mesa/receta todavía => accion "trabajar").
//   3) trabajador:asignarReceta con una receta de herrero válida para esa
//      mesa (clavos_hierro/yunque_tocon) deja accion "craftear" DE INMEDIATO
//      (antes de cualquier tick — es lo que dispara la pose "trabajando" del
//      rig en el cliente, docs/GDD_NPCs_Contratables.md §6).
//   4) una receta de un oficio que el trabajador NO tiene se rechaza.
//   5) el tick periódico (10s) craftea SOLO: consume el insumo del almacén
//      de la PROPIEDAD DE LA MESA (tenderete_items, nunca el inventario del
//      jugador) y, tras el tiempo de crafteo, deposita el resultado ahí
//      mismo — verificado leyendo la BD directamente.
//   node server/test/npcs_trabajadores_crafteo.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "npcs_trabajadores_crafteo_e2e.sqlite");
const PUERTO = 2606;
const JARL = "E2E-MesaCrafteoJarl"; // <=20 chars: Player.name se trunca a 20 (options.name.slice(0,20)) y JARL_NOMBRES debe coincidir EXACTO con ese nombre truncado
// Mismas coordenadas que herreria.e2e.mjs (ya verificadas libres/alcanzables
// desde el spawn real 1600.5,1600.5 del mapa principal, dentro de la parcela
// p_0001, RADIO_INTERACCION=2.2 — no hace falta caminar ni ser dueño real de
// la parcela para asignar una mesa, ver trabajadorPerteneceA/asignarMesa en
// RoomExteriorBase.ts).
const SPAWN = { x: 1600.5, y: 1600.5 };
const YUNQUE_XY = { x: 1600, y: 1601 };
const PARCELA_ID = "p_0001";
const LINGOTES_SEMBRADOS = 5;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl con Farycoins de sobra, yunque_tocon sembrado como construcción real, lingote_hierro en el almacén de su propiedad)...");
let idYunque;
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0,
      vida INTEGER NOT NULL DEFAULT 100,
      vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propiedad TEXT NOT NULL,
      objeto TEXT NOT NULL,
      categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL,
      rot INTEGER NOT NULL DEFAULT 0,
      variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT,
      creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenderete_items (
      tenderete_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 0,
      precio_farycoins INTEGER NOT NULL,
      PRIMARY KEY (tenderete_id, item_id)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 1000)").run(JARL, ahora);
  idYunque = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.prepare("INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES (?, 'lingote_hierro', ?, 0)").run(PARCELA_ID, LINGOTES_SEMBRADOS);
  bd.close();
}
console.log(`  yunque_tocon id=${idYunque}@(${YUNQUE_XY.x},${YUNQUE_XY.y}), almacén de "${PARCELA_ID}" con ${LINGOTES_SEMBRADOS} lingote_hierro`);

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

function leerBd() {
  const bd = new DatabaseSync(rutaBd);
  const stock = bd.prepare("SELECT item_id, cantidad FROM tenderete_items WHERE tenderete_id = ?").all(PARCELA_ID);
  bd.close();
  return Object.fromEntries(stock.map((s) => [s.item_id, Number(s.cantidad)]));
}

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre el mapa PRINCIPAL...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: JARL });
  await esperar(500);

  const colocados = [];
  const erroresAdmin = [];
  room.onMessage("admin:npcTutorial:colocado", (m) => colocados.push(m));
  room.onMessage("admin:error", (m) => erroresAdmin.push(m));
  console.log("3) el jarl coloca el reclutador en el spawn...");
  room.send("admin:npcTutorial:colocar", { tipoTutorial: "reclutador_trabajadores" });
  await esperar(400);
  if (colocados.length !== 1) throw new Error(`FALLO: debería confirmar la colocación del reclutador, llegó ${JSON.stringify(colocados)}, admin:error=${JSON.stringify(erroresAdmin)}`);
  console.log("   OK");

  console.log("4) contrata un trabajador herrero...");
  const contratados = [];
  const erroresTrabajador = [];
  room.onMessage("reclutador:contratado", (m) => contratados.push(m));
  room.onMessage("trabajador:error", (m) => erroresTrabajador.push(m));
  room.send("reclutador:contratar", { oficios: ["herrero"] });
  await esperar(500);
  if (contratados.length !== 1) throw new Error(`FALLO: debería contratar, llegó ${JSON.stringify(contratados)}, errores=${JSON.stringify(erroresTrabajador)}`);
  const trabajadorId = contratados[0].trabajador.id;
  const slotId = `trabajadorOficio_${trabajadorId}`;
  console.log(`   OK: trabajador #${trabajadorId}`);

  console.log("5) trabajador:asignarMesa lo teleporta a la mesa real sembrada — accion sigue 'trabajar' (sin receta todavía)...");
  const actualizados = [];
  room.onMessage("trabajador:actualizado", (m) => actualizados.push(m));
  room.send("trabajador:asignarMesa", { trabajadorId, construccionId: idYunque });
  await esperar(500);
  if (actualizados.length !== 1 || actualizados[0].trabajador.construccionId !== idYunque) {
    throw new Error(`FALLO: debería confirmar la mesa asignada, llegó ${JSON.stringify(actualizados)}`);
  }
  let npcEnMundo = room.state.npcs.get(slotId);
  if (!npcEnMundo) throw new Error("FALLO: el trabajador desapareció del mundo al asignar mesa");
  const distMesa = Math.hypot(npcEnMundo.x - (YUNQUE_XY.x + 0.5), npcEnMundo.y - (YUNQUE_XY.y + 0.5));
  if (distMesa > 0.01) throw new Error(`FALLO: el trabajador debería haber TELEPORTADO a la mesa exacta, quedó en (${npcEnMundo.x},${npcEnMundo.y})`);
  if (npcEnMundo.accion !== "trabajar") throw new Error(`FALLO: sin receta todavía debería seguir en accion "trabajar", llegó "${npcEnMundo.accion}"`);
  console.log(`   OK: teleportado a (${npcEnMundo.x},${npcEnMundo.y}), accion="${npcEnMundo.accion}"`);

  console.log("6) una receta de un oficio que NO tiene se rechaza (herrero no es cocinero)...");
  erroresTrabajador.length = 0;
  room.send("trabajador:asignarReceta", { trabajadorId, recetaId: "masa_pan" }); // receta de molinero, no de herrero
  await esperar(400);
  if (!erroresTrabajador.some((e) => /oficio/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazarse por oficio incompatible, llegó ${JSON.stringify(erroresTrabajador)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresTrabajador[0])}`);

  console.log("7) trabajador:asignarReceta con clavos_hierro (herrero, mesa yunque_tocon) deja accion 'craftear' DE INMEDIATO, antes de cualquier tick...");
  actualizados.length = 0;
  room.send("trabajador:asignarReceta", { trabajadorId, recetaId: "clavos_hierro" });
  await esperar(500);
  if (actualizados.length !== 1 || actualizados[0].trabajador.recetaId !== "clavos_hierro") {
    throw new Error(`FALLO: debería confirmar la receta asignada, llegó ${JSON.stringify(actualizados)}`);
  }
  npcEnMundo = room.state.npcs.get(slotId);
  if (!npcEnMundo || npcEnMundo.accion !== "craftear") {
    throw new Error(`FALLO: con mesa Y receta asignadas la accion debería ser "craftear" (dispara la pose "trabajando" del rig), llegó "${npcEnMundo?.accion}"`);
  }
  console.log(`   OK: accion="${npcEnMundo.accion}" — el cliente disparará la pose "trabajando" (npc.accion === "craftear")`);

  console.log("8) almacén sembrado con insumos ANTES de cualquier tick — todavía intacto (crafteo aún no ha corrido)...");
  const stockAntes = leerBd();
  if (stockAntes.lingote_hierro !== LINGOTES_SEMBRADOS) throw new Error(`FALLO: el insumo no debería tocarse hasta el próximo tick, quedó ${JSON.stringify(stockAntes)}`);
  console.log(`   OK: ${JSON.stringify(stockAntes)}`);

  console.log("9) esperando el tick de trabajadores (10s) arrancar el crafteo (consume el insumo AL INICIAR)...");
  await esperar(12000);
  const stockTrasArranque = leerBd();
  if ((stockTrasArranque.lingote_hierro ?? LINGOTES_SEMBRADOS) !== LINGOTES_SEMBRADOS - 1) {
    throw new Error(`FALLO: el tick debería haber consumido 1 lingote_hierro del almacén de la mesa al arrancar el crafteo, quedó ${JSON.stringify(stockTrasArranque)}`);
  }
  console.log(`   OK: insumo consumido del almacén de la MESA (nunca del inventario del jugador) — ${JSON.stringify(stockTrasArranque)}`);

  console.log("10) esperando el siguiente tick (>= tiempoBaseSeg=8s de clavos_hierro) recoger el resultado solo, sin intervención del jugador...");
  await esperar(15000);
  const stockFinal = leerBd();
  if ((stockFinal.clavos ?? 0) < 10) {
    throw new Error(`FALLO: debería haber depositado 10 clavos en el almacén de la mesa tras el crafteo automático, quedó ${JSON.stringify(stockFinal)}`);
  }
  console.log(`   OK: crafteo automático completo, sin que ningún jugador estuviera presente — ${JSON.stringify(stockFinal)}`);

  await room.leave();
  console.log("\n✅ TODO OK: mesa real sembrada → trabajador teleportado a ella → receta rechazada por oficio incompatible → receta válida dispara accion \"craftear\" de inmediato (pose \"trabajando\") → el tick craftea SOLO consumiendo/depositando en el almacén de la propiedad de la mesa, nunca en el inventario del jugador — todo contra el servidor real.");
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
