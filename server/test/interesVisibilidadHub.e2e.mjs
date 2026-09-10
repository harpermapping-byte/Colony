// E2E de visibilidad mutua con interest-management (docs/GDD_Rendimiento.md
// §5/§7): 4 clientes colyseus.js puros (SIN navegador) entran al Hub del
// MAPA PRINCIPAL en el mismo spawn y cada uno debe ver a los 4 en
// `state.players` en pocos segundos — aísla el servidor (StateView por
// distancia, `actualizarVistaDeInteres`) de la lentitud de 4 navegadores de
// WebGL por software, que en el playtest multijugador (2026-09-10) dejó
// vistas inconsistentes (T1 veía a T1/T3/T4, T2 solo a T1/T2) sin poder
// distinguir "el servidor no los mete en la vista" de "la página está tan
// saturada que aún no ha decodificado los patches".
//   node server/test/interesVisibilidadHub.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "interes_visibilidad_e2e.sqlite");
const PUERTO = 2614;
const NOMBRES = ["Vis1", "Vis2", "Vis3", "Vis4"];

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

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

async function esperarPuerto(url, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const nombresVisibles = (room) => [...room.state.players.values()].map((p) => p.name).sort();

async function esperarQueVea(room, esperados, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const vistos = nombresVisibles(room);
    if (esperados.every((n) => vistos.includes(n))) return vistos;
    await esperar(250);
  }
  return nombresVisibles(room);
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log(`${ok ? "OK" : "FALLO"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
  if (!ok) fallos++;
}

const rutaPrincipal = join(raiz, "assets", "mapas", "principal");
try {
  console.log("1) servidor real sobre el mapa principal...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaPrincipal, BD_RUTA: rutaBd, JARL_NOMBRES: "Vis1" }); // Vis1 jarl: admin:debug:teleport real en el paso 4
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("2) entran 4 clientes uno tras otro (mismo spawn) — cada uno debe ver a los 4...");
  const rooms = [];
  for (const nombre of NOMBRES) {
    const cliente = new Client(`ws://localhost:${PUERTO}`);
    rooms.push(await cliente.joinOrCreate("hub", { name: nombre }));
    await esperar(300);
  }
  const idsRoom = new Set(rooms.map((r) => r.roomId));
  comprobar("los 4 clientes caen en la MISMA room de Hub", idsRoom.size === 1, [...idsRoom].join(","));
  for (let i = 0; i < rooms.length; i++) {
    const vistos = await esperarQueVea(rooms[i], NOMBRES);
    comprobar(`${NOMBRES[i]} ve a los 4 en state.players`, NOMBRES.every((n) => vistos.includes(n)), vistos.join(","));
  }

  console.log("3) un cliente se va: los otros 3 deben dejar de verlo (y seguir viéndose entre sí)...");
  await rooms[3].leave();
  await esperar(1500);
  for (let i = 0; i < 3; i++) {
    const vistos = nombresVisibles(rooms[i]);
    comprobar(`${NOMBRES[i]} ya no ve a Vis4 y sigue viendo a los otros 2`, !vistos.includes("Vis4") && ["Vis1", "Vis2", "Vis3"].every((n) => vistos.includes(n)), vistos.join(","));
  }

  console.log("4) un cliente se aleja >85 casillas (histéresis de salida) — los demás deben dejar de verlo; al volver, verlo de nuevo...");
  const yo = rooms[0].state.players.get(rooms[0].sessionId);
  const origen = { x: yo.x, y: yo.y };
  rooms[0].send("admin:debug:teleport", { x: origen.x + 120, y: origen.y }); // solo si Vis1 es jarl — si no, el servidor lo ignora y esta parte se salta
  await esperar(2500);
  const seMovio = Math.abs(rooms[0].state.players.get(rooms[0].sessionId).x - origen.x) > 100;
  if (!seMovio) {
    console.log("   (Vis1 no es jarl: teleport ignorado, se salta la comprobación de distancia — arranca el servidor con JARL_NOMBRES=Vis1 para cubrirla)");
  } else {
    const vistosLejos = nombresVisibles(rooms[1]);
    comprobar("Vis2 deja de ver a Vis1 a 120 casillas", !vistosLejos.includes("Vis1"), vistosLejos.join(","));
    rooms[0].send("admin:debug:teleport", { x: origen.x, y: origen.y });
    const vistosVuelta = await esperarQueVea(rooms[1], ["Vis1"]);
    comprobar("Vis2 vuelve a ver a Vis1 al volver al spawn", vistosVuelta.includes("Vis1"), vistosVuelta.join(","));
  }

  for (const r of rooms.slice(0, 3)) await r.leave().catch(() => {});
} catch (e) {
  fallos++;
  console.error("❌", e?.stack || e);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
console.log(fallos === 0 ? "\n✅ interesVisibilidadHub.e2e: TODO OK" : `\n❌ interesVisibilidadHub.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
