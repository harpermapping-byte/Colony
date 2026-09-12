// E2E de la hierba de suelo toolless + cosecha en área con azada
// (docs/GDD_Bakeador_Exteriores.md, pedido streamer 2026-09-12: "recolectarlas
// a mano, de una en una... o con azada... coge varias alrededor") contra un
// servidor REAL. La hierba nueva no existe en ningún mapa ya horneado
// (assets/mapas/*) — este e2e hornea PRIMERO el pequeño mapa de prueba
// permitido (ejemplo-rapido.json, semilla "prueba-01", determinista) y usa
// coordenadas reales de ESE bake, recalculadas mirando `cargarMapaColision`
// directamente (si el catálogo de vegetación cambia otra vez, recalcular):
//   - CLUSTER (294,54): tiene 2 vecinas hierba reales dentro de 1.6 casillas
//     — (293,54) y (295,55) — el sitio real para probar la cosecha en área.
//   - AISLADA (31,20): 0 vecinas dentro de 1.6 — para el caso "a mano" (una
//     sola, sin azada, aunque hubiera azada tampoco arrastraría nada más).
//   node server/test/hierbaAzada.e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "hierba_azada_e2e.sqlite");
const rutaMapa = join(raiz, "output", "ejemplo-rapido");
const PUERTO = 2603;
const NOMBRE_A = "E2E-HierbaAMano";
const NOMBRE_B = "E2E-HierbaAzada";
const CLUSTER = { x: 294.5, y: 54.5 }; // 1 hierba aquí + 2 vecinas reales dentro de 1.6
const AISLADA = { x: 31.5, y: 20.5 }; // 1 hierba real, sin vecinas dentro de 1.6

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) horneando ejemplo-rapido.json (único bake de prueba permitido, determinista por semilla)...");
{
  const r = spawnSync("node", ["baker/src/index.js", "baker/config/ejemplo-rapido.json"], { cwd: raiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: el bake de prueba no terminó bien");
  if (!existsSync(join(rutaMapa, "indice.json"))) throw new Error("FALLO: no se generó output/ejemplo-rapido/indice.json");
}

console.log("2) sembrando BD sqlite temporal (B ya lleva azada_hierro equipable en el cuerpo)...");
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
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 1, '[]')").run();
  const itemsB = JSON.stringify([{ id: 1, itemId: "azada_hierro", cantidad: 1, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (2, 'cuerpo', 8, 6, 2, ?)").run(itemsB);
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
const cantidadDe = (room, itemId) => [...room.state.players.get(room.sessionId).inventario.cuerpo.items].filter((it) => it.itemId === itemId).reduce((s, it) => s + it.cantidad, 0);

let fallo = null;
try {
  console.log("3) arrancando servidor real sobre output/ejemplo-rapido (JARL_NOMBRES para admin:debug:teleport)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaMapa, BD_RUTA: rutaBd, JARL_NOMBRES: `${NOMBRE_A},${NOMBRE_B}` });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("4) jugador A (SIN azada, 'a mano') se teleporta a la hierba AISLADA y coge...");
  const clienteA = new Client(`ws://localhost:${PUERTO}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: NOMBRE_A });
  await esperar(500);
  roomA.send("admin:debug:teleport", AISLADA);
  await esperar(300);

  const erroresA = [];
  roomA.onMessage("coger:error", (m) => erroresA.push(m));
  let quitadosA = 0;
  roomA.onMessage("mundo:objetoQuitado", () => { quitadosA++; });
  roomA.send("coger");
  await esperar(400);
  if (erroresA.length !== 0) throw new Error(`FALLO: coger hierba SIN ninguna herramienta no debería fallar (toolless), llegó ${JSON.stringify(erroresA)}`);
  if (quitadosA !== 1) throw new Error(`FALLO: sin azada debe quitarse EXACTAMENTE 1 hierba del mundo, llegaron ${quitadosA} avisos`);
  const hierbaA = cantidadDe(roomA, "hierba");
  if (hierbaA !== 1) throw new Error(`FALLO: A debería llevar exactamente 1 hierba tras coger a mano, lleva ${hierbaA}`);
  console.log("   OK: sin herramienta ('cualquiera puede'), 1 sola hierba por golpe, tal como se pidió");
  await roomA.leave();

  console.log("5) jugador B (CON azada equipada) se teleporta al CLUSTER y coge...");
  const clienteB = new Client(`ws://localhost:${PUERTO}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: NOMBRE_B });
  await esperar(500);
  const jugadorB = roomB.state.players.get(roomB.sessionId);
  const itemAzada = [...jugadorB.inventario.cuerpo.items].find((it) => it.itemId === "azada_hierro");
  if (!itemAzada) throw new Error("FALLO: B no cargó la azada sembrada en BD");
  roomB.send("equipo:equipar", { instanciaId: itemAzada.id, slot: "manoPrincipal" });
  await esperar(300);
  roomB.send("admin:debug:teleport", CLUSTER);
  await esperar(300);

  const erroresB = [];
  roomB.onMessage("coger:error", (m) => erroresB.push(m));
  let quitadosB = 0;
  roomB.onMessage("mundo:objetoQuitado", () => { quitadosB++; });
  roomB.send("coger");
  await esperar(400);
  if (erroresB.length !== 0) throw new Error(`FALLO: coger con azada no debería fallar, llegó ${JSON.stringify(erroresB)}`);
  if (quitadosB !== 3) throw new Error(`FALLO: con azada, el cluster real tiene 2 vecinas -> deberían quitarse 3 hierbas del mundo (1+2), llegaron ${quitadosB}`);
  const hierbaB = cantidadDe(roomB, "hierba");
  if (hierbaB !== 3) throw new Error(`FALLO: B debería llevar exactamente 3 hierba (1 clicada + 2 vecinas) tras un solo 'coger' con azada, lleva ${hierbaB}`);
  console.log("   OK: con azada equipada, un solo 'coger' arrastra las 2 vecinas reales del cluster (3 en total)");

  console.log("6) B repite 'coger' en el MISMO sitio: las 3 hierbas ya están agotadas (respawn), nada más que recoger cerca...");
  const erroresB2 = [];
  roomB.onMessage("coger:error", (m) => erroresB2.push(m));
  roomB.send("coger");
  await esperar(400);
  if (erroresB2.length !== 1 || erroresB2[0].motivo !== "nada_cerca") {
    throw new Error(`FALLO: tras agotar el cluster, un segundo 'coger' debería fallar con 'nada_cerca', llegó ${JSON.stringify(erroresB2)}`);
  }
  if (cantidadDe(roomB, "hierba") !== 3) throw new Error("FALLO: el segundo 'coger' fallido no debería haber añadido más hierba");
  console.log("   OK: las 3 quedan agotadas de verdad (mismo respawn por timer que cualquier otro recolectable)");
  await roomB.leave();

  console.log("\n✅ TODO OK: hierba toolless + cosecha en área con azada, verificado contra el servidor real.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
}
if (fallo) { console.error(fallo); process.exit(1); }
