// E2E de barcos y navegación marítima (docs/GDD_Barcos.md, pedido
// 2026-08-30) contra el servidor REAL — mismo patrón que monturas.e2e.mjs:
// siembra la BD sqlite temporal con un barco YA colocado (crafteo/colocar en
// sí ya está cubierto por tests puros de inventario/bd) y arranca el
// servidor sobre DOS mapas de prueba mínimos y 100% agua (assets/mapas/
// test_mar_a/test_mar_b, generados por baker/src/generar_mapas_prueba_barcos.js)
// para poder cruzar de verdad un borde mar_abierto sin depender de que el
// mapa demo tenga una franja de agua real hasta el borde.
//   1. Al entrar a test_mar_a, el barco sembrado debe aparecer YA en
//      state.barcos.
//   2. barco:montar sin barcoId (auto-apuntado) fusiona: Player.barcoId/
//      barcoCapitan se rellenan, el barco SIGUE en state.barcos (a
//      diferencia de una mascota, nunca desaparece: varias plazas).
//   3. Pilotando, se mueve real (más rápido que a pie) y SOLO por agua.
//   4. Al llegar al borde este (mar_abierto -> test_mar_b) y mandar
//      mapa:viajarVecino, llega un portal:ir {tipo:"hub", mapaId:"test_mar_b"}.
//   5. Uniéndose de verdad a "hub_mapa" con ese mapaId, el barco reaparece
//      anclado ahí (BD actualizada) — el jugador llega a pie (sin
//      re-embarcar automático, simplificación documentada en el GDD).
//   node server/test/barcos.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "barcos_e2e.sqlite");
const PUERTO = 2601;
const NOMBRE = "E2E-Barco";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador + barco_1 colocado en test_mar_a, cerca del borde este)...");
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
    CREATE TABLE IF NOT EXISTS barcos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jugador_id INTEGER NOT NULL,
      tipo_id TEXT NOT NULL,
      mapa_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      creado_en TEXT NOT NULL
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO barcos (jugador_id, tipo_id, mapa_id, x, y, creado_en) VALUES (1, 'barco_1', 'test_mar_a', 10, 8, ?)").run(new Date().toISOString());
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
  console.log("2) arrancando servidor real sobre test_mar_a (BD sembrada)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaMarA, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) join — el barco sembrado debe aparecer YA en state.barcos...");
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  let barcos = [...room.state.barcos.values()];
  if (barcos.length !== 1 || barcos[0].tipoId !== "barco_1") {
    throw new Error(`FALLO: no apareció el barco sembrado, llegó ${JSON.stringify(barcos.map((b) => ({ tipoId: b.tipoId, x: b.x, y: b.y })))}`);
  }
  console.log("   OK: el barco sembrado aparece anclado en test_mar_a");

  console.log("4) barco:montar sin barcoId (auto-apuntado)...");
  const erroresBarco = [];
  room.onMessage("barco:error", (m) => erroresBarco.push(m));
  room.send("barco:montar", {});
  await new Promise((r) => setTimeout(r, 400));
  if (erroresBarco.length > 0) throw new Error(`FALLO: barco:montar rechazado, ${JSON.stringify(erroresBarco)}`);
  let jugador = room.state.players.get(room.sessionId);
  if (!jugador.barcoId || !jugador.barcoCapitan) throw new Error(`FALLO: no se fusionó como capitán (barcoId=${jugador.barcoId}, barcoCapitan=${jugador.barcoCapitan})`);
  if (room.state.barcos.size !== 1) throw new Error("FALLO: el barco no debería desaparecer de state.barcos al montarlo (varias plazas, a diferencia de una mascota)");
  console.log(`   OK: capitán del barco ${jugador.barcoId}, sigue visible en state.barcos`);

  console.log("5) pilotando hacia el este, cruza el mapa 100% agua (16 casillas) hasta el borde...");
  const x0 = jugador.x;
  room.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 1500));
  room.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const distancia = jugador.x - x0;
  if (distancia < 3) throw new Error(`FALLO: el barco apenas se movió (${distancia.toFixed(2)} casillas en 1.5s) — ¿velocidadBarco/agua-only rotos?`);
  if (jugador.x < 13.5) throw new Error(`FALLO: no llegó cerca del borde este (x=${jugador.x.toFixed(2)}, hace falta >=13.5 de 16 casillas de ancho)`);
  console.log(`   OK: recorrió ${distancia.toFixed(2)} casillas, x=${jugador.x.toFixed(2)} (cerca del borde este)`);

  console.log("6) mapa:viajarVecino en el borde — debe llegar portal:ir hacia test_mar_b...");
  let portalRecibido = null;
  room.onMessage("portal:ir", (info) => { portalRecibido = info; });
  room.send("mapa:viajarVecino");
  await new Promise((r) => setTimeout(r, 500));
  if (!portalRecibido || portalRecibido.tipo !== "hub" || portalRecibido.mapaId !== "test_mar_b") {
    throw new Error(`FALLO: no llegó el portal:ir esperado, llegó ${JSON.stringify(portalRecibido)}`);
  }
  console.log("   OK: portal:ir {tipo:'hub', mapaId:'test_mar_b'} recibido");
  await room.leave();

  console.log("7) uniéndose de verdad a hub_mapa/test_mar_b — el barco debe reaparecer anclado ahí...");
  const room2 = await client.joinOrCreate("hub_mapa", { name: NOMBRE, mapaId: "test_mar_b" });
  await new Promise((r) => setTimeout(r, 700));
  barcos = [...room2.state.barcos.values()];
  if (barcos.length !== 1 || barcos[0].tipoId !== "barco_1") {
    throw new Error(`FALLO: el barco no reapareció en test_mar_b, llegó ${JSON.stringify(barcos.map((b) => ({ tipoId: b.tipoId, x: b.x, y: b.y })))}`);
  }
  jugador = room2.state.players.get(room2.sessionId);
  if (jugador.barcoId) throw new Error("FALLO: no debería re-embarcar automático al llegar (simplificación documentada — llega a pie)");
  console.log(`   OK: el barco quedó anclado en test_mar_b (${barcos[0].x.toFixed(2)},${barcos[0].y.toFixed(2)}), el jugador llega a pie sin re-embarcar`);
  await room2.leave();

  console.log("8) comprobando en BD que el barco cambió de mapa_id de verdad...");
  const bdFinal = new DatabaseSync(rutaBd);
  const fila = bdFinal.prepare("SELECT mapa_id FROM barcos").get();
  bdFinal.close();
  if (fila.mapa_id !== "test_mar_b") throw new Error(`FALLO: la fila de BD sigue en mapa_id=${fila.mapa_id}, esperaba test_mar_b`);
  console.log("   OK: BD persiste el nuevo mapa_id");

  console.log("\n=== E2E barcos: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E barcos: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
