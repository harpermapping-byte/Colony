// E2E de "qué pasa si pasan muchos turnos" (pedido del streamer 2026-08-30,
// verificación explícita de docs/GDD_Faccion_Bandidos.md §6): adelanta 300
// pulsos REALES de `ejecutarTickEconomia` (sin esperar 10 min reales entre
// cada uno, server parado mientras tanto para no escribir dos procesos a la
// vez sobre el mismo sqlite) sobre un asentamiento bandido de prueba y
// comprueba:
//   1. La economía SUBE de nivel de verdad con el tiempo (nivelMuralla y
//      nivelEquipo llegan a su tope) y luego se ESTANCA sin romperse (sin
//      bucle infinito, sin números negativos, 300 pulsos en fracción de
//      segundo).
//   2. Nadie muere ni se duplica solo por pasar turnos — la economía nunca
//      toca `tropas_asentamiento` (7 tropas antes y después, ni una más).
//   3. Ese nivelEquipo YA ALTO se nota jugando de verdad: la guarnición del
//      cuartel Y la patrulla de fuera escalan sus stats con el mismo
//      FACTOR_POR_NIVEL_EQUIPO (server/src/mundo/guarnicionBandida.ts).
//   node server/test/faccionBandidosEconomiaLarga.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_economia_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_economia_larga_e2e.sqlite");
const PUERTO = 2603;
const NUM_TICKS = 300;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-economia-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);
const portalCuartel = (indice.portales || []).find((p) => p.tipo === "interior" && p.tipoEdificioId === "campamento_hostil");
if (!portalCuartel) throw new Error("el bake de prueba no trae ningún campamento_hostil");
const edificio = portalCuartel.edificio;

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

let fallo = null;
try {
  console.log("2) arrancando servidor con BD temporal (tick de economía apagado — se adelanta a mano abajo)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  let client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) primera entrada (siembra el asentamiento + guarnición inicial de 7 tropas)...");
  const region0 = await client.joinOrCreate("region", { name: "E2E-seed", mapaId });
  await esperar(500);

  const bd0 = new DatabaseSync(rutaBd);
  const tropasAntes = bd0.prepare("SELECT rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasAntes.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada (${tropasAntes.length} tropas, se esperaban 7)`);
  const asentamientoAntes = bd0.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  if (asentamientoAntes.nivel_muralla !== 1 || asentamientoAntes.nivel_equipo !== 1) {
    throw new Error(`FALLO: asentamiento recién sembrado debería empezar en nivel 1/1 (llegó ${asentamientoAntes.nivel_muralla}/${asentamientoAntes.nivel_equipo})`);
  }
  bd0.close();
  console.log(`   OK: sembrado en nivel_muralla=1, nivel_equipo=1, 7 tropas vivas`);

  await region0.leave();
  matarTodo(); // servidor parado del todo: nadie más escribe en el sqlite mientras se adelantan los pulsos
  await esperar(1000);

  console.log(`4) adelantando ${NUM_TICKS} pulsos REALES de ejecutarTickEconomia (sin esperar 10 min reales entre cada uno)...`);
  const t0Ticks = Date.now();
  execFileSync("npx", ["tsx", "test/_ejecutarTicksEconomia.ts", rutaBd, String(NUM_TICKS)], { cwd: dirServidor, stdio: "inherit" });
  const msTicks = Date.now() - t0Ticks;
  console.log(`   OK: ${NUM_TICKS} pulsos aplicados en ${msTicks}ms — sin bucle infinito ni cuelgue`);

  const bd1 = new DatabaseSync(rutaBd);
  const asentamientoTrasTicks = bd1.prepare("SELECT * FROM asentamientos WHERE id = ?").get(mapaId);
  if (asentamientoTrasTicks.nivel_muralla !== 2) throw new Error(`FALLO: nivel_muralla no llegó a su tope (2) tras ${NUM_TICKS} pulsos — quedó en ${asentamientoTrasTicks.nivel_muralla}`);
  if (asentamientoTrasTicks.nivel_equipo !== 3) throw new Error(`FALLO: nivel_equipo no llegó a su tope (3) tras ${NUM_TICKS} pulsos — quedó en ${asentamientoTrasTicks.nivel_equipo}`);
  if (asentamientoTrasTicks.comida < 0 || asentamientoTrasTicks.madera < 0 || asentamientoTrasTicks.piedra < 0 || asentamientoTrasTicks.hierro < 0) {
    throw new Error(`FALLO: algún recurso quedó negativo: ${JSON.stringify(asentamientoTrasTicks)}`);
  }
  console.log(`   OK: la ciudad se desarrolló de verdad — nivel_muralla=2 (tope), nivel_equipo=3 (tope), recursos: ${JSON.stringify({ comida: asentamientoTrasTicks.comida, madera: asentamientoTrasTicks.madera, piedra: asentamientoTrasTicks.piedra, hierro: asentamientoTrasTicks.hierro })}`);

  const tropasTrasTicks = bd1.prepare("SELECT rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasTrasTicks.length !== 7 || tropasTrasTicks.some((t) => t.estado !== "vivo")) {
    throw new Error(`FALLO: pasar turnos NO debería tocar tropas_asentamiento — quedaron ${JSON.stringify(tropasTrasTicks)}`);
  }
  console.log(`   OK: pasar 300 turnos no crea, mata ni duplica ninguna tropa — sigue habiendo exactamente 7 vivas`);
  bd1.close();

  console.log("5) reentrando al servidor YA con la economía madura — la guarnición/patrulla deben notarlo en sus stats...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  client = new Client(`ws://localhost:${PUERTO}`);

  const region = await client.joinOrCreate("region", { name: "E2E", mapaId });
  await esperar(500);
  const cuartel = await client.joinOrCreate("interior", { name: "E2E", mapaId, edificio, nivel: 0 });
  await esperar(500);

  // guarnicionBandida.ts: FACTOR_POR_NIVEL_EQUIPO[3] = 1.6, STATS_POR_RANGO.guardia.vida=50, .lider.vida=90
  const vidasGuardiaLider = [...cuartel.state.enemigos.values()].map((e) => e.vidaMax).sort((a, b) => a - b);
  const esperadas = [Math.round(50 * 1.6), Math.round(50 * 1.6), Math.round(90 * 1.6)].sort((a, b) => a - b);
  if (JSON.stringify(vidasGuardiaLider) !== JSON.stringify(esperadas)) {
    throw new Error(`FALLO: la guarnición del cuartel no escaló al nivelEquipo=3 real — vidaMax vistas ${JSON.stringify(vidasGuardiaLider)}, se esperaban ${JSON.stringify(esperadas)}`);
  }
  console.log(`   OK: la guarnición del cuartel escaló de verdad con nivelEquipo=3 (vidaMax: ${JSON.stringify(vidasGuardiaLider)}, factor x1.6)`);

  const hostiles = [...region.state.npcs.values()].filter((n) => n.hostil);
  const vidasPatrulla = hostiles.map((n) => n.vidaMax);
  const esperadaRecluta = Math.round(25 * 1.6);
  if (hostiles.length !== 4 || vidasPatrulla.some((v) => v !== esperadaRecluta)) {
    throw new Error(`FALLO: la patrulla de reclutas no escaló al nivelEquipo=3 real — vidaMax vistas ${JSON.stringify(vidasPatrulla)}, se esperaban 4x${esperadaRecluta}`);
  }
  console.log(`   OK: la patrulla de reclutas (${hostiles.length}) también escaló de verdad con nivelEquipo=3 (vidaMax=${esperadaRecluta} cada uno, factor x1.6)`);

  await cuartel.leave();
  await region.leave();
  console.log("\n=== E2E economía a largo plazo (muchos turnos): TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E economía a largo plazo (muchos turnos): FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
