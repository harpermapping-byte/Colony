// E2E del cuartel de un asentamiento bandido (docs/GDD_Faccion_Bandidos.md
// §7bis/§7ter, pedido 2026-08-30). Contra el juego REAL: banquea un
// asentamiento_hostil pequeño (ciudades/ SIEMPRE incluye un edificio
// "campamento_hostil" obligatorio) y entra a su cuartel (InteriorRoom
// normal — NO DungeonRoom: un asentamiento_hostil bakeado vía ciudades/
// nunca marca sus puertas `esMazmorra:true`, ver baker/src/instanciasPOI.js).
// Comprueba la parte "en reposo" de la guarnición:
//   1. El cuartel puebla SOLO guardia+líder (3 de las 7 tropas iniciales) —
//      los reclutas están fuera, de patrulla (§7ter,
//      faccionBandidosPatrulla.e2e.mjs cubre el combate/muerte/conquista de
//      ESA mitad; el motor de finalizarMuerte es el mismo código compartido
//      así que no hace falta repetir el combate completo aquí también).
//   2. Reentrar a la MISMA sala (room nueva, la anterior se auto-dispone al
//      vaciarse) sigue reflejando la MISMA composición — sin cooldown ni
//      cupo aleatorio como una mazmorra normal.
//   node server/test/faccionBandidosCuartel.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_cuartel_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_cuartel_e2e.sqlite");
const PUERTO = 2599;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-cuartel-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);
const portalCuartel = (indice.portales || []).find((p) => p.tipo === "interior" && p.tipoEdificioId === "campamento_hostil");
if (!portalCuartel) throw new Error("el bake de prueba no trae ningún campamento_hostil (debería ser obligatorio en este tier)");
const edificio = portalCuartel.edificio;
console.log(`   cuartel encontrado: edificio="${edificio}"`);

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

let fallo = null;
try {
  console.log("2) arrancando servidor con BD temporal...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) uniéndose a la región (siembra el asentamiento+guarnición inicial de 7 tropas) y luego al cuartel...");
  const region = await client.joinOrCreate("region", { name: "E2E", mapaId });
  await esperar(500);

  const bd = new DatabaseSync(rutaBd);
  const tropasIniciales = bd.prepare("SELECT rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasIniciales.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada en BD (${tropasIniciales.length} tropas, se esperaban 7)`);
  const reclutas = tropasIniciales.filter((t) => t.rango === "recluta").length;
  const guardiaYLider = tropasIniciales.length - reclutas;
  if (reclutas !== 4 || guardiaYLider !== 3) throw new Error(`FALLO: composición inicial inesperada (${reclutas} recluta(s), ${guardiaYLider} guardia/líder)`);

  const cuartel = await client.joinOrCreate("interior", { name: "E2E", mapaId, edificio, nivel: 0 });
  await esperar(500);
  if (cuartel.state.enemigos.size !== guardiaYLider) {
    throw new Error(`FALLO: el cuartel pobló ${cuartel.state.enemigos.size} Enemigo(s), se esperaban ${guardiaYLider} (solo guardia+líder — los reclutas están de patrulla, §7ter)`);
  }
  const algunEsBoss = [...cuartel.state.enemigos.values()].some((e) => e.esBoss);
  if (!algunEsBoss) throw new Error("FALLO: ningún Enemigo del cuartel es esBoss=true (debería estar el líder)");
  console.log(`   OK: el cuartel pobló exactamente ${guardiaYLider} Enemigo(s) (guardia+líder, con el líder marcado esBoss) — ningún recluta aquí dentro`);

  await cuartel.leave();
  await region.leave();
  await esperar(3000); // margen de sobra para que Colyseus auto-disponga las rooms vacías

  console.log("4) volviendo a entrar al MISMO cuartel (room nueva) — misma composición, sin cooldown ni azar...");
  const region2 = await client.joinOrCreate("region", { name: "E2E-2", mapaId });
  await esperar(300);
  const cuartel2 = await client.joinOrCreate("interior", { name: "E2E-2", mapaId, edificio, nivel: 0 });
  await esperar(500);
  if (cuartel2.state.enemigos.size !== guardiaYLider) {
    throw new Error(`FALLO: al reentrar, state.enemigos.size=${cuartel2.state.enemigos.size}, se esperaban ${guardiaYLider} — ¿se coló el cooldown/azar de mazmorra normal?`);
  }
  console.log(`   OK: el cuartel reentrado refleja la misma composición real, sin cooldown ni repoblación al azar`);

  await cuartel2.leave();
  await region2.leave();
  bd.close();
  console.log("\n=== E2E cuartel bandido (guarnición en reposo): TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E cuartel bandido (guarnición en reposo): FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
