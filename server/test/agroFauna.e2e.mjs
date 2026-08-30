// E2E de agro por distancia (docs/GDD_Combate.md §7bis, pedido 2026-08-30:
// "la orca/tiburón/depredador en agua debe funcionar como el depredador de
// tierra con triggers por distancia") — servidor Colyseus REAL. Siembra
// directamente una fila de `fauna_salvaje` (una orca, BD) muy cerca del
// spawn de test_mar_a (mismo mapa de prueba 100% agua de docs/GDD_Barcos.md)
// para que, al activarse su sector, quede dentro de su radioAgro (10) sin
// que el jugador haga NADA — ni combate:iniciar, ni acercarse a propósito.
//   1. Se une, espera a que la fauna salvaje active el sector (8s) y el
//      radar de agro (200ms) — sin mandar NINGÚN mensaje de combate.
//   2. Debe llegar portal:ir {tipo:"combate"} sin que el jugador lo pidiera.
//   node server/test/agroFauna.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "agroFauna_e2e.sqlite");
const PUERTO = 2602;
const NOMBRE = "E2E-Agro";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (una orca junto al spawn de test_mar_a)...");
{
  // necesitaComida/necesitaAgua (reproduccionFauna.ts) son "ahora - ultima >
  // ventana" — un valor de sobra en el FUTURO hace esa resta negativa
  // (nunca > ventana), "recién comida/bebida" sin tener que replicar aquí
  // el reloj de mundo real del servidor (tiempoMundo.ts, TS, no importable
  // tal cual desde este script .mjs plano).
  const ahora = 999999;

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
    CREATE TABLE IF NOT EXISTS fauna_salvaje (
      id TEXT PRIMARY KEY,
      mapa_id TEXT NOT NULL,
      sector_x INTEGER NOT NULL,
      sector_y INTEGER NOT NULL,
      especie_id TEXT NOT NULL,
      sexo TEXT NOT NULL,
      etapa TEXT NOT NULL DEFAULT 'adulto',
      estado TEXT NOT NULL DEFAULT 'vivo',
      x REAL NOT NULL,
      y REAL NOT NULL,
      ultima_comida REAL NOT NULL,
      ultima_bebida REAL NOT NULL,
      gestando_desde REAL,
      gestacion_duracion_dias REAL,
      nacio_en REAL,
      vida REAL NOT NULL DEFAULT 0,
      vida_max REAL NOT NULL DEFAULT 0,
      ataque REAL NOT NULL DEFAULT 0
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare(`
    INSERT INTO fauna_salvaje
      (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y, ultima_comida, ultima_bebida, vida, vida_max, ataque)
    VALUES
      ('test_mar_a:0:0:1', 'test_mar_a', 0, 0, 'orca', 'macho', 'adulto', 'vivo', 9.5, 8.5, ?, ?, 300, 300, 40)
  `).run(ahora, ahora);
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

const rutaMarA = join(raiz, "assets", "mapas", "test_mar_a");

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre test_mar_a (BD sembrada con la orca)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaMarA, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) join — SIN mandar ningún mensaje de combate, solo esperar...");
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  let portalRecibido = null;
  room.onMessage("portal:ir", (info) => { portalRecibido = info; });

  console.log("4) esperando activación de sector (8s) + radar de agro (200ms)...");
  const t0 = Date.now();
  let comenzarYaMandado = false;
  while (!portalRecibido && Date.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 300));
    // La orca abre la ventana de unión ella sola (bien) pero esa ventana
    // dura VENTANA_UNION_COMBATE_MS=60s de verdad — mismo atajo que
    // tendría un jugador real con prisa: combate:comenzarYa la cierra ya,
    // sin esperar el minuto entero solo para confirmar que se abrió.
    if (!comenzarYaMandado && room.state.combates.size > 0) {
      const [combateId] = [...room.state.combates.keys()];
      console.log(`   [debug] la orca abrió la ventana de unión ella sola (combateId=${combateId}) — combate:comenzarYa para no esperar 60s`);
      comenzarYaMandado = true;
      room.send("combate:comenzarYa", { combateId });
    }
  }
  if (!portalRecibido) {
    console.log(`   [debug] al fallar: state.fauna.size=${room.state.fauna.size}, state.combates.size=${room.state.combates.size}, jugador=`, room.state.players.get(room.sessionId));
  }

  if (!portalRecibido || portalRecibido.tipo !== "combate") {
    throw new Error(`FALLO: la orca no atacó por distancia sin que el jugador hiciera nada — portal:ir=${JSON.stringify(portalRecibido)}`);
  }
  console.log(`   OK: la orca disparó combate ella sola (portal:ir tipo=combate, combateId=${portalRecibido.combateId}) sin combate:iniciar del jugador`);

  await room.leave();
  console.log("\n=== E2E agro por distancia: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E agro por distancia: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
