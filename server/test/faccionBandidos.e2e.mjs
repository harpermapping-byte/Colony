// E2E de la facción bandida (docs/GDD_Faccion_Bandidos.md fase 1) contra el
// juego REAL: banquea un asentamiento_hostil pequeño de prueba, arranca el
// servidor Colyseus con una BD sqlite temporal, se une por WebSocket (sin
// navegador — Colyseus puro) y comprueba en la BD, desde FUERA de la room:
//   1. Al entrar, RegionRoom siembra la fila de `asentamientos` (idempotente).
//   2. El tick periódico real (`clock.setInterval`) llama a
//      ejecutarTickEconomia y persiste — no solo lo hace `calcularTick` en
//      aislado (eso ya lo cubre economiaAsentamientos.test.ts).
// TICK_ECONOMIA_MS acelera el pulso para que el test no tarde los 75s
// reales de producción (mismo criterio que HORA_FORZADA).
//   node --experimental-sqlite server/test/faccionBandidos.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, rmSync, unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_e2e.sqlite");
const PUERTO = 2598;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-faccion-1", rutaMapa], {
  cwd: raiz,
  stdio: "inherit",
});
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);

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

let fallo = null;
try {
  console.log("2) arrancando servidor con BD temporal y tick acelerado (2s)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO),
    BD_RUTA: rutaBd,
    TICK_ECONOMIA_MS: "2000",
  });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) uniéndose a la región bandida...");
  const room = await client.joinOrCreate("region", { name: "E2E", mapaId });
  await new Promise((r) => setTimeout(r, 800));

  const bd = new DatabaseSync(rutaBd);
  const sembrada = bd.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  if (!sembrada) throw new Error("FALLO: RegionRoom no sembró la fila de asentamientos al cargar un tier asentamiento_hostil");
  if (sembrada.bando !== "bandido") throw new Error(`FALLO: bando inesperado "${sembrada.bando}"`);
  console.log("   OK: asentamiento sembrado", JSON.stringify(sembrada));

  console.log("4) insertando una tropa de prueba y esperando 2 pulsos reales del tick...");
  bd.prepare("INSERT INTO tropas_asentamiento (id, asentamiento_id, rango, estado) VALUES (?, ?, 'guardia', 'vivo')")
    .run(`${mapaId}:e2e0`, mapaId);
  await new Promise((r) => setTimeout(r, 4500)); // >2 pulsos de 2s

  const trasTick = bd.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  console.log("   estado tras el tick:", JSON.stringify(trasTick));
  if (!(Number(trasTick.madera) >= 3)) {
    throw new Error(`FALLO: el tick periódico real no produjo madera (madera=${trasTick.madera}) — el clock.setInterval no está corriendo o no persiste`);
  }
  console.log(`   OK: el tick real corrió y persistió en SQLite (madera=${trasTick.madera}, piedra=${trasTick.piedra}, hierro=${trasTick.hierro})`);

  bd.close();
  await room.leave();
  console.log("\n=== E2E facción bandida: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E facción bandida: FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
  if (existsSync(rutaMapa)) rmSync(rutaMapa, { recursive: true, force: true });
}
process.exit(fallo ? 1 : 0);
