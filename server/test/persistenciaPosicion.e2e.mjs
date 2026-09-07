// E2E de persistencia de posición al desconectar/F5 (docs/GDD_Mecanicas.md,
// pedido streamer 2026-09-07: "si te sales o haces F5 mantienes tu
// posición... se guarda la posición de los jugadores") contra el servidor
// REAL sobre el mapa demo:
//   1) jugador se une, camina lejos del spawn, se desconecta (room.leave()
//      dispara onLeave de verdad, no un kill brusco del proceso).
//   2) el mismo nombre vuelve a unirse — debe aparecer en la ÚLTIMA
//      posición, no en el spawn del mapa.
//   3) un nombre NUEVO (nunca guardado) sí aparece en el spawn normal —
//      confirma que resolverSpawnGuardado no rompe el caso de siempre.
//   node server/test/persistenciaPosicion.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "persistencia_posicion_e2e.sqlite");
const PUERTO = 2602;
const NOMBRE = "E2E-Posicion";
const NOMBRE_NUEVO = "E2E-PosicionNueva";

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

async function esperarPuerto(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function andarHasta(room, jugador, destino, radio = 1.0) {
  let pasos = 0;
  let dist = Math.hypot(destino.x - jugador.x, destino.y - jugador.y);
  while (dist > radio && pasos < 400) {
    room.send("input", { x: Math.sign(destino.x - jugador.x), y: Math.sign(destino.y - jugador.y) });
    await esperar(120);
    dist = Math.hypot(destino.x - jugador.x, destino.y - jugador.y);
    pasos++;
  }
  room.send("input", { x: 0, y: 0 });
  await esperar(150); // deja que el último input se procese en el servidor antes de leer x/y
  return dist;
}

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("1) arrancando servidor real sobre el mapa demo...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("2) primera sesión: se une, camina lejos del spawn, y se desconecta...");
  const cliente1 = new Client(`ws://localhost:${PUERTO}`);
  const room1 = await cliente1.joinOrCreate("hub", { name: NOMBRE });
  await esperar(500);
  const spawnReal = { x: room1.state.players.get(room1.sessionId).x, y: room1.state.players.get(room1.sessionId).y };
  console.log(`   spawn real del mapa: ${JSON.stringify(spawnReal)}`);
  const destino = { x: spawnReal.x + 8, y: spawnReal.y + 8 };
  const distCaminada = await andarHasta(room1, room1.state.players.get(room1.sessionId), destino);
  const posFinal = { x: room1.state.players.get(room1.sessionId).x, y: room1.state.players.get(room1.sessionId).y };
  const seAlejo = Math.hypot(posFinal.x - spawnReal.x, posFinal.y - spawnReal.y) > 4;
  if (!seAlejo) throw new Error(`FALLO: el jugador no se alejó lo suficiente del spawn para que el test sea significativo (pos final=${JSON.stringify(posFinal)}, dist recorrida real=${distCaminada.toFixed(2)})`);
  console.log(`   OK: se alejó a ${JSON.stringify(posFinal)}`);
  await room1.leave();
  await esperar(600); // margen real para que onLeave (async, guardarPosicionDe con await a BD) termine antes de reconectar

  console.log("3) segunda sesión, MISMO nombre: debe aparecer en la posición guardada, no en el spawn...");
  const cliente2 = new Client(`ws://localhost:${PUERTO}`);
  const room2 = await cliente2.joinOrCreate("hub", { name: NOMBRE });
  await esperar(500);
  const posReconexion = { x: room2.state.players.get(room2.sessionId).x, y: room2.state.players.get(room2.sessionId).y };
  const distAPosGuardada = Math.hypot(posReconexion.x - posFinal.x, posReconexion.y - posFinal.y);
  if (distAPosGuardada > 0.01) {
    throw new Error(`FALLO: debería reaparecer en ${JSON.stringify(posFinal)}, apareció en ${JSON.stringify(posReconexion)} (dist=${distAPosGuardada.toFixed(3)})`);
  }
  console.log(`   OK: reapareció exactamente donde se desconectó (${JSON.stringify(posReconexion)})`);
  await room2.leave();
  await esperar(300);

  console.log("4) nombre NUEVO (nunca guardado): debe aparecer en el spawn normal del mapa, no romperse...");
  const cliente3 = new Client(`ws://localhost:${PUERTO}`);
  const room3 = await cliente3.joinOrCreate("hub", { name: NOMBRE_NUEVO });
  await esperar(500);
  const posNueva = { x: room3.state.players.get(room3.sessionId).x, y: room3.state.players.get(room3.sessionId).y };
  const distAlSpawn = Math.hypot(posNueva.x - spawnReal.x, posNueva.y - spawnReal.y);
  if (distAlSpawn > 0.01) {
    throw new Error(`FALLO: un jugador nuevo debería aparecer en el spawn ${JSON.stringify(spawnReal)}, apareció en ${JSON.stringify(posNueva)}`);
  }
  console.log(`   OK: jugador nuevo apareció en el spawn normal (${JSON.stringify(posNueva)})`);
  await room3.leave();

  console.log("\n✅ TODO OK: la posición se guarda al desconectar y se restaura al mismo mapa; un jugador nuevo sigue cayendo al spawn normal.");
} catch (e) {
  fallo = e;
  console.error("❌", e.message || e);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
