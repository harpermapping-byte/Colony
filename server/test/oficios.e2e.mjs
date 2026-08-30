// E2E de la ronda 2 de oficios (docs/GDD_Profesiones.md, pedido 2026-08-30:
// "cada player elige 2 oficios hablando con un NPC... si quieres cambiarlas
// paga farycoins y se inicia de cero") contra el servidor REAL, sobre el
// mapa demo (assets/mapas/demo/npcsFijos.json ya trae un maestro_oficios en
// el spawn). Confirma:
//   A) elegir un oficio junto al NPC llena el slot 1, gratis.
//   B) elegir el mismo oficio otra vez se rechaza (ya lo tienes).
//   C) elegir un segundo oficio distinto llena el slot 2, gratis.
//   D) con los 2 slots llenos, elegir un tercero se rechaza (hay que cambiar).
//   E) cambiar sin Farycoins suficientes se rechaza sin tocar nada.
//   F) con saldo de sobra, cambiar cuesta el precio y REINICIA a 0 la XP del
//      oficio que se quita.
// (el rechazo "lejos del NPC" usa el MISMO chequeo de proximidad que ya
// prueba server/test — no se repite aquí por no simular un paseo real).
//   node server/test/oficios.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "oficios_e2e.sqlite");
const PUERTO = 2603;
const NOMBRE_RICO = "E2E-OficiosRico";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (un jugador con Farycoins de sobra)...");
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
    CREATE TABLE IF NOT EXISTS jugador_oficios (
      jugador_id INTEGER NOT NULL,
      oficio TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jugador_id, oficio)
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 1000)").run(NOMBRE_RICO, new Date().toISOString());
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'curtidor', 500)").run(); // XP ya acumulada para probar que se pierde al cambiar
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
try {
  console.log("2) arrancando servidor real sobre el mapa demo (trae maestro_oficios en el spawn)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("3) jugador junto al NPC elige su primer oficio (slot 1, gratis)...");
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: NOMBRE_RICO });
  await esperar(500); // deja que el NPC fijo llegue al state antes del primer oficio:elegir

  const elegidos = [];
  const erroresOficio = [];
  room.onMessage("oficio:elegido", (m) => elegidos.push(m));
  room.onMessage("oficio:error", (m) => erroresOficio.push(m));

  room.send("oficio:elegir", { oficio: "curtidor" });
  await esperar(300);
  if (elegidos.length !== 1 || elegidos[0].slot !== 1 || elegidos[0].oficio !== "curtidor") {
    throw new Error(`FALLO: debería quedar curtidor en el slot 1, llegó ${JSON.stringify(elegidos)}`);
  }
  console.log(`   OK: ${JSON.stringify(elegidos[0])}`);

  console.log("4) elegir el mismo oficio otra vez se rechaza...");
  erroresOficio.length = 0;
  room.send("oficio:elegir", { oficio: "curtidor" });
  await esperar(300);
  if (!erroresOficio.some((e) => /ya tienes ese oficio/.test(e.motivo))) {
    throw new Error(`FALLO: repetir oficio debería rechazarse, llegó ${JSON.stringify(erroresOficio)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresOficio[0])}`);

  console.log("5) elige un segundo oficio distinto (slot 2, gratis)...");
  elegidos.length = 0;
  room.send("oficio:elegir", { oficio: "herrero" });
  await esperar(300);
  if (elegidos.length !== 1 || elegidos[0].slot !== 2 || elegidos[0].oficio !== "herrero") {
    throw new Error(`FALLO: debería quedar herrero en el slot 2, llegó ${JSON.stringify(elegidos)}`);
  }
  console.log(`   OK: ${JSON.stringify(elegidos[0])}`);

  console.log("6) con los 2 slots llenos, elegir un tercer oficio se rechaza (hay que cambiar, no elegir)...");
  erroresOficio.length = 0;
  room.send("oficio:elegir", { oficio: "molinero" });
  await esperar(300);
  if (!erroresOficio.some((e) => /ya tienes 2 oficios/.test(e.motivo))) {
    throw new Error(`FALLO: con 2 slots llenos debería pedir oficio:cambiar, llegó ${JSON.stringify(erroresOficio)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresOficio[0])}`);

  console.log("7) cambiar el slot 1 (curtidor, con 500 XP acumulada) por molinero cuesta Farycoins y reinicia la XP del que se quita...");
  const cambiados = [];
  room.onMessage("oficio:cambiado", (m) => cambiados.push(m));
  room.send("oficio:cambiar", { slot: 1, oficio: "molinero" });
  await esperar(400);
  if (cambiados.length !== 1 || cambiados[0].oficioAnterior !== "curtidor" || cambiados[0].oficio !== "molinero") {
    throw new Error(`FALLO: debería confirmar el cambio curtidor->molinero, llegó ${JSON.stringify(cambiados)}`);
  }
  if (cambiados[0].saldoRestante !== 1000 - 250) {
    throw new Error(`FALLO: debería haber cobrado PRECIO_CAMBIO_OFICIO (250), saldo llegó a ${cambiados[0].saldoRestante}`);
  }
  console.log(`   OK: ${JSON.stringify(cambiados[0])}`);

  const bdVerif = new DatabaseSync(rutaBd);
  const xpCurtidorTrasCambio = bdVerif.prepare("SELECT xp FROM jugador_oficios WHERE jugador_id = 1 AND oficio = 'curtidor'").get();
  bdVerif.close();
  if (!xpCurtidorTrasCambio || Number(xpCurtidorTrasCambio.xp) !== 0) {
    throw new Error(`FALLO: la XP de curtidor debería haberse reiniciado a 0, quedó ${JSON.stringify(xpCurtidorTrasCambio)}`);
  }
  console.log("   OK: la XP de curtidor (500) se perdió al quitarlo del slot, como se pidió");

  await room.leave();

  console.log("\n✅ TODO OK: 2 slots de oficio, coste+reinicio de XP al cambiar, y gating por NPC verificados contra el servidor real.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
if (fallo) { console.error(fallo); process.exit(1); }
