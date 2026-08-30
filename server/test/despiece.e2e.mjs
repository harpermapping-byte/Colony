// E2E del rediseño de caza (docs/GDD_Caza.md, 2026-08-30 octava pasada)
// contra el servidor REAL: sembrada la BD con un jugador curtidor que ya
// lleva un cuchillo_desollar + un cadáver entero (cadaver_carne_caza_mayor_
// cuero_grueso_grande) en el cuerpo, confirma:
//   A) iniciar "despiezar" en el sitio (sin construccionId) arranca de verdad
//      (terminaEn en el futuro), y recolectar ANTES de que termine es un
//      no-op amable (todavía en el inventario, nada entregado).
//   B) sin herramienta / sin oficio curtidor, iniciar se rechaza con el
//      motivo correcto (gating intacto tras el rediseño).
// El resultado REAL tras esperar el tiempo completo (~60s en el sitio) ya
// está cubierto exhaustivamente por tests puros (despiece.test.ts) — este
// E2E solo verifica el cableado real (mensajes, nombres, sin crashes).
//   node server/test/despiece.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "despiece_e2e.sqlite");
const PUERTO = 2602;
const NOMBRE_CON_TODO = "E2E-Curtidor";
const NOMBRE_SIN_CUCHILLO = "E2E-SinCuchillo";
const CADAVER_ID = "cadaver_carne_caza_mayor_cuero_grueso_grande";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (2 jugadores; ambos con el cadáver, solo uno con cuchillo_desollar)...");
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
    CREATE TABLE IF NOT EXISTS inventarios (
      jugador_id INTEGER NOT NULL,
      contenedor_id TEXT NOT NULL,
      ancho INTEGER NOT NULL,
      alto INTEGER NOT NULL,
      siguiente_id INTEGER NOT NULL DEFAULT 1,
      items TEXT NOT NULL,
      PRIMARY KEY (jugador_id, contenedor_id)
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE_CON_TODO, new Date().toISOString());
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (2, ?, ?)").run(NOMBRE_SIN_CUCHILLO, new Date().toISOString());
  const itemsConTodo = JSON.stringify([
    { id: 1, itemId: "cuchillo_desollar", cantidad: 1, x: 0, y: 0, rot: 0 },
    { id: 2, itemId: CADAVER_ID, cantidad: 1, x: 1, y: 0, rot: 0 },
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 3, ?)").run(itemsConTodo);
  const itemsSinCuchillo = JSON.stringify([{ id: 1, itemId: CADAVER_ID, cantidad: 1, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (2, 'cuerpo', 8, 6, 2, ?)").run(itemsSinCuchillo);
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
  console.log("2) arrancando servidor real sobre el mapa demo...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("3) jugador SIN cuchillo (con oficio curtidor) intenta procesar su cadáver...");
  const clienteB = new Client(`ws://localhost:${PUERTO}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: NOMBRE_SIN_CUCHILLO });
  await esperar(400);
  roomB.send("oficio:elegir", { oficio: "curtidor" });
  await esperar(200);
  const erroresB = [];
  roomB.onMessage("cadaver:error", (m) => erroresB.push(m));
  roomB.send("cadaver:procesarIniciar", { instanciaId: 1, verbo: "despiezar" });
  await esperar(400);
  if (erroresB.length !== 1 || !/cuchillo/.test(erroresB[0].motivo)) {
    throw new Error(`FALLO: sin cuchillo debería rechazarse pidiendo un cuchillo de desollar, llegó ${JSON.stringify(erroresB)}`);
  }
  console.log(`   OK: rechazado sin cuchillo — ${JSON.stringify(erroresB[0])}`);
  await roomB.leave();

  console.log("4) jugador CON cuchillo+cadáver+oficio curtidor arranca 'despiezar' en el sitio...");
  const clienteA = new Client(`ws://localhost:${PUERTO}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: NOMBRE_CON_TODO });
  await esperar(400);
  roomA.send("oficio:elegir", { oficio: "curtidor" });
  await esperar(200);

  const erroresA = [];
  roomA.onMessage("cadaver:error", (m) => erroresA.push(m));
  let iniciado = null;
  roomA.onMessage("cadaver:procesarIniciado", (m) => { iniciado = m; });
  const antesDeIniciar = Date.now();
  roomA.send("cadaver:procesarIniciar", { instanciaId: 2, verbo: "despiezar" });
  await esperar(500);
  if (erroresA.length !== 0) throw new Error(`FALLO: no debería rechazarse, llegó ${JSON.stringify(erroresA)}`);
  if (!iniciado) throw new Error("FALLO: nunca llegó cadaver:procesarIniciado");
  if (iniciado.enMesa !== false) throw new Error(`FALLO: sin construccionId debería ser 'en el sitio' (enMesa:false), llegó ${JSON.stringify(iniciado)}`);
  if (iniciado.terminaEn <= antesDeIniciar) throw new Error("FALLO: terminaEn debería estar en el futuro");
  const duracionSeg = (iniciado.terminaEn - antesDeIniciar) / 1000;
  if (duracionSeg < 50 || duracionSeg > 70) throw new Error(`FALLO: despiezar en el sitio debería tardar ~60s (20s base x3), llegó ${duracionSeg}s`);
  console.log(`   OK: iniciado en el sitio, dura ~${duracionSeg.toFixed(1)}s (3x el tiempo de mesa, como se pidió)`);

  console.log("5) recolectar ANTES de que termine es un no-op amable (todavía en el inventario)...");
  let procesadoLlego = false;
  roomA.onMessage("cadaver:procesado", () => { procesadoLlego = true; });
  roomA.send("cadaver:procesarRecolectar");
  await esperar(400);
  if (procesadoLlego) throw new Error("FALLO: no debería entregar nada todavía, el tiempo no ha pasado");
  const jugadorA = roomA.state.players.get(roomA.sessionId);
  const tieneCadaverTodavia = [...jugadorA.inventario.cuerpo.items].some((it) => it.itemId === CADAVER_ID);
  if (!tieneCadaverTodavia) throw new Error("FALLO: el cadáver debería seguir en el inventario, no se recolectó nada aún");
  console.log("   OK: recolectar antes de tiempo no entrega nada, el cadáver sigue en el inventario");

  console.log("6) un segundo 'procesarIniciar' mientras el primero está en curso se rechaza (sin cola, como crafteo)...");
  const erroresSegundoIntento = [];
  roomA.onMessage("cadaver:error", (m) => erroresSegundoIntento.push(m));
  roomA.send("cadaver:procesarIniciar", { instanciaId: 2, verbo: "desollar" });
  await esperar(400);
  if (!erroresSegundoIntento.some((e) => /en proceso/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazar un segundo procesado mientras el primero sigue en curso, llegó ${JSON.stringify(erroresSegundoIntento)}`);
  }
  console.log("   OK: sin cola — un cadáver procesándose a la vez, igual que crafteo");

  await roomA.leave();
  console.log("\n✅ TODO OK: cableado real del rediseño de caza verificado contra el servidor real.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
}
if (fallo) { console.error(fallo); process.exit(1); }
