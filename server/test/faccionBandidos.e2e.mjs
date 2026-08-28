// E2E de la facción bandida (docs/GDD_Faccion_Bandidos.md §6) contra el
// juego REAL: banquea un asentamiento_hostil pequeño de prueba, arranca el
// servidor Colyseus con una BD sqlite temporal, se une por WebSocket (sin
// navegador — Colyseus puro) y comprueba en la BD, desde FUERA de la room:
//   1. Al entrar, RegionRoom llama a asegurarAsentamientoBandido: se siembra
//      la fila de `asentamientos` + la guarnición inicial fija (1 líder + 2
//      guardias + 4 reclutas = 7 tropas vivas), idempotente en visitas
//      siguientes.
//   2. El tick GLOBAL de economía (server/src/index.ts, UNA vez por
//      proceso — no por room) llama de verdad a `ejecutarTickEconomia` y
//      persiste — no solo lo hace `calcularTick` en aislado (eso ya lo
//      cubre economiaAsentamientos.test.ts).
// TICK_ECONOMIA_MS acelera el pulso para que el test no tarde los 10 min
// reales de producción (mismo criterio que HORA_FORZADA).
//   node server/test/faccionBandidos.e2e.mjs
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
  console.log("2) arrancando servidor con BD temporal y tick global acelerado (2s)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO),
    BD_RUTA: rutaBd,
    TICK_ECONOMIA_MS: "2000",
  });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) uniéndose a la región bandida (descubrimiento)...");
  const room = await client.joinOrCreate("region", { name: "E2E", mapaId });
  await new Promise((r) => setTimeout(r, 800));

  const bd = new DatabaseSync(rutaBd);
  const sembrada = bd.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  if (!sembrada) throw new Error("FALLO: RegionRoom no sembró la fila de asentamientos al cargar un tier asentamiento_hostil");
  if (sembrada.bando !== "bandido") throw new Error(`FALLO: bando inesperado "${sembrada.bando}"`);
  console.log("   OK: asentamiento sembrado", JSON.stringify(sembrada));

  const tropas = bd.prepare("SELECT rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  const vivas = tropas.filter((t) => t.estado === "vivo");
  if (vivas.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada (${vivas.length} tropas vivas, se esperaban 7: 1 líder + 2 guardias + 4 reclutas)`);
  const porRango = Object.fromEntries(["lider", "guardia", "recluta"].map((r) => [r, vivas.filter((t) => t.rango === r).length]));
  if (porRango.lider !== 1 || porRango.guardia !== 2 || porRango.recluta !== 4) {
    throw new Error(`FALLO: composición de guarnición inesperada: ${JSON.stringify(porRango)}`);
  }
  console.log("   OK: guarnición inicial sembrada", JSON.stringify(porRango));

  console.log("4) esperando 2 pulsos reales del tick GLOBAL (index.ts, no por room)...");
  await new Promise((r) => setTimeout(r, 4500)); // >2 pulsos de 2s

  const trasTick = bd.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  console.log("   estado tras el tick:", JSON.stringify(trasTick));
  // 7 tropas vivas * 3 madera/tropa/tick = 21 madera mínimo tras 1 pulso.
  if (!(Number(trasTick.madera) >= 21)) {
    throw new Error(`FALLO: el tick global real no produjo madera (madera=${trasTick.madera}, se esperaban >=21 con 7 tropas) — el setInterval de index.ts no está corriendo o no persiste`);
  }
  console.log(`   OK: el tick global real corrió y persistió en SQLite (madera=${trasTick.madera}, piedra=${trasTick.piedra}, hierro=${trasTick.hierro})`);

  console.log("5) segunda entrada a la MISMA región: la guarnición NO se duplica...");
  const room2 = await client.joinOrCreate("region", { name: "E2E-2", mapaId });
  await new Promise((r) => setTimeout(r, 500));
  const tropasTras2a = bd.prepare("SELECT COUNT(*) AS n FROM tropas_asentamiento WHERE asentamiento_id = ?").get(mapaId);
  if (Number(tropasTras2a.n) !== 7) throw new Error(`FALLO: idempotencia rota — la segunda entrada duplicó tropas (${tropasTras2a.n} filas, se esperaban 7)`);
  console.log("   OK: sigue habiendo exactamente 7 filas de tropa — asegurarAsentamientoBandido es idempotente");
  await room2.leave();

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
