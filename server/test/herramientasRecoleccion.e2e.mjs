// E2E del gating de herramienta por tier al recolectar (docs/GDD_Profesiones.md
// §0, pedido 2026-08-30) contra el servidor REAL sobre el mapa demo, que SÍ
// tiene 2 recolectables reales (comprobado directamente con cargarMapaColision):
// flor_medicinal en (14,20) y hierba_aromatica en (14,33) — curandero tier 3
// y tier 1 respectivamente. Dos jugadores (BD sqlite sembrada ANTES de
// arrancar, mismo patrón que persistenciaEquipo.e2e.mjs):
//   A) sin ninguna herramienta -> coger sobre flor_medicinal debe RECHAZARSE
//      con el motivo de "necesitas herramienta de curandero", y el nodo
//      sigue en el mapa (nunca se confirma el candidato).
//   B) con "tijera_herbolario_fina" (curandero tier 3) en el cuerpo -> coger
//      sobre ESE MISMO nodo debe funcionar de verdad: entra al inventario,
//      el nodo desaparece del mundo.
//   node server/test/herramientasRecoleccion.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "herramientas_recoleccion_e2e.sqlite");
const PUERTO = 2601;
const NOMBRE_A = "E2E-SinHerramienta";
const NOMBRE_B = "E2E-ConHerramienta";
const NOMBRE_C = "E2E-Picapedrero";
const FLOR = { x: 14, y: 20 }; // flor_medicinal, curandero tier 3 (ver mapaColision.ts)
const ROCA = { x: 33, y: 17 }; // piedra_comun, picapedrero tier 1 — recolectable REAL desde que rocas.json ganó desaparaceAlRecolectar (2026-08-30, "igual que tala un árbol"); la más cercana al spawn (30.5,18.5) de las 3 del demo — sin pathfinding real en este E2E (mismo criterio naive que faccionBandidosPatrulla.e2e.mjs), así que se evitan las que quedan más lejos por si hay obstáculos de por medio

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (2 jugadores; B ya lleva tijera_herbolario_fina en el cuerpo)...");
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
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE_A, new Date().toISOString());
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (2, ?, ?)").run(NOMBRE_B, new Date().toISOString());
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (3, ?, ?)").run(NOMBRE_C, new Date().toISOString());
  const itemsB = JSON.stringify([{ id: 1, itemId: "tijera_herbolario_fina", cantidad: 1, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (2, 'cuerpo', 8, 6, 2, ?)").run(itemsB);
  const itemsC = JSON.stringify([{ id: 1, itemId: "pico_minero_hierro", cantidad: 1, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (3, 'cuerpo', 8, 6, 2, ?)").run(itemsC);
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

async function andarHasta(room, jugador, destino, radio = 1.8) {
  let pasos = 0;
  let dist = Math.hypot(destino.x - jugador.x, destino.y - jugador.y);
  while (dist > radio && pasos < 400) {
    room.send("input", { x: Math.sign(destino.x - jugador.x), y: Math.sign(destino.y - jugador.y) });
    await esperar(120);
    dist = Math.hypot(destino.x - jugador.x, destino.y - jugador.y);
    pasos++;
  }
  room.send("input", { x: 0, y: 0 });
  return dist;
}

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre el mapa demo (tiene flor_medicinal real en 14,20)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("3) jugador A (sin herramienta) camina hasta flor_medicinal e intenta coger...");
  const clienteA = new Client(`ws://localhost:${PUERTO}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: NOMBRE_A });
  await esperar(500);
  const jugadorA = roomA.state.players.get(roomA.sessionId);
  const distA = await andarHasta(roomA, jugadorA, FLOR);
  if (distA > 2.2) throw new Error(`FALLO: A no llegó cerca de flor_medicinal (dist=${distA.toFixed(2)})`);

  const erroresA = [];
  roomA.onMessage("coger:error", (m) => erroresA.push(m));
  roomA.send("coger");
  await esperar(400);
  if (erroresA.length !== 1) throw new Error(`FALLO: se esperaba exactamente 1 coger:error sin herramienta, llegaron ${erroresA.length}: ${JSON.stringify(erroresA)}`);
  if (!/curandero/.test(erroresA[0].motivo) || !/tier 3/.test(erroresA[0].motivo)) {
    throw new Error(`FALLO: el motivo debería pedir herramienta de curandero tier 3, llegó: ${JSON.stringify(erroresA[0])}`);
  }
  if ([...jugadorA.inventario.cuerpo.items].length !== 0) throw new Error("FALLO: A no debería haber cogido nada");
  console.log(`   OK: coger sin herramienta rechazado — ${JSON.stringify(erroresA[0])}`);
  await roomA.leave();

  console.log("4) jugador B (con tijera_herbolario_fina, tier 3) camina hasta el MISMO nodo y coge de verdad...");
  const clienteB = new Client(`ws://localhost:${PUERTO}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: NOMBRE_B });
  await esperar(500);
  const jugadorB = roomB.state.players.get(roomB.sessionId);
  const itemsInicialesB = [...jugadorB.inventario.cuerpo.items];
  if (itemsInicialesB.length !== 1 || itemsInicialesB[0].itemId !== "tijera_herbolario_fina") {
    throw new Error(`FALLO: B no cargó la tijera sembrada en BD, llegó ${JSON.stringify(itemsInicialesB)}`);
  }
  const distB = await andarHasta(roomB, jugadorB, FLOR);
  if (distB > 2.2) throw new Error(`FALLO: B no llegó cerca de flor_medicinal (dist=${distB.toFixed(2)})`);

  const erroresB = [];
  roomB.onMessage("coger:error", (m) => erroresB.push(m));
  let quitadoDelMundo = false;
  roomB.onMessage("mundo:objetoQuitado", () => { quitadoDelMundo = true; });
  roomB.send("coger");
  await esperar(500);
  if (erroresB.length !== 0) throw new Error(`FALLO: coger con la herramienta correcta no debería fallar, llegó ${JSON.stringify(erroresB)}`);
  if (!quitadoDelMundo) throw new Error("FALLO: el nodo debería haber desaparecido del mundo (mundo:objetoQuitado)");
  const itemsFinalesB = [...jugadorB.inventario.cuerpo.items];
  if (!itemsFinalesB.some((it) => it.itemId === "flor_medicinal")) {
    throw new Error(`FALLO: flor_medicinal debería estar en el inventario de B, llegó ${JSON.stringify(itemsFinalesB)}`);
  }
  console.log("   OK: con la herramienta de tier suficiente, coger funciona de verdad y el nodo desaparece del mundo");
  await roomB.leave();

  console.log("5) jugador C (picapedrero, pico_minero_hierro tier 1) mina un piedra_comun real del bake demo...");
  const clienteC = new Client(`ws://localhost:${PUERTO}`);
  const roomC = await clienteC.joinOrCreate("hub", { name: NOMBRE_C });
  await esperar(500);
  const jugadorC = roomC.state.players.get(roomC.sessionId);
  const distC = await andarHasta(roomC, jugadorC, ROCA);
  if (distC > 2.2) throw new Error(`FALLO: C no llegó cerca de la roca (dist=${distC.toFixed(2)})`);

  const erroresC = [];
  roomC.onMessage("coger:error", (m) => erroresC.push(m));
  let rocaQuitada = false;
  roomC.onMessage("mundo:objetoQuitado", () => { rocaQuitada = true; });
  roomC.send("coger");
  await esperar(500);
  if (erroresC.length !== 0) throw new Error(`FALLO: minar piedra_comun con pico_minero_hierro no debería fallar, llegó ${JSON.stringify(erroresC)}`);
  if (!rocaQuitada) throw new Error("FALLO: la roca debería haber desaparecido del mundo (mundo:objetoQuitado)");
  const itemsFinalesC = [...jugadorC.inventario.cuerpo.items];
  if (!itemsFinalesC.some((it) => it.itemId === "piedra_comun")) {
    throw new Error(`FALLO: piedra_comun debería estar en el inventario de C, llegó ${JSON.stringify(itemsFinalesC)}`);
  }
  console.log("   OK: minería real activada — igual que talar/recolectar, ahora con su propio gating de tier");
  await roomC.leave();

  console.log("\n✅ TODO OK: gating de herramienta por tier verificado contra el servidor real (incluida la roca, nueva).");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
}
if (fallo) { console.error(fallo); process.exit(1); }
