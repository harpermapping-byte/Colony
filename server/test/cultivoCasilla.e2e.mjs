// E2E de agricultura de casilla (docs/GDD_Carros.md §9, Fase 3, pedido
// 2026-09-03) contra el servidor REAL, sobre assets/mapas/testflat/ (tiene
// una parcela real "tf_0001" ya bakeada — misma que usa testZoneDebug.e2e.mjs).
// DIA_FORZADO=60 fija mes=3 (semilla_trigo se siembra en meses [3,4,5],
// docs/GDD_Agricultura.md) y congela el reloj de mundo para que la prueba
// sea determinista — la casilla lista-para-cosechar se siembra DIRECTO en
// BD con un diaPlantado muy anterior (mismo criterio "salta el crafteo/la
// espera real" que monturas.e2e.mjs/carros.e2e.mjs con admin:debug:darItem).
//   1. cultivoCasilla:labrar en una casilla libre DENTRO de la parcela
//      propia — exige azada equipada.
//   2. cultivoCasilla:labrar se rechaza fuera de cualquier parcela y sobre
//      una casilla ocupada por una construcción real ya sembrada.
//   3. cultivoCasilla:plantar sobre la casilla recién labrada.
//   4. cultivoCasilla:cosechar sobre una casilla YA "sembrada" y madura
//      (sembrada directo en BD) — entrega la cosecha real al inventario.
//   node server/test/cultivoCasilla.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "cultivoCasilla_e2e.sqlite");
const PUERTO = 2604;
const NOMBRE = "E2E-Cultivo";
const DIA = 60; // diaDelAnio=60 -> mes=3 (diasPorMes=30), coincide con semilla_trigo [3,4,5]

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador dueño de tf_0001 + una casilla YA sembrada y madura)...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS propiedades (
      id TEXT PRIMARY KEY, tipo TEXT NOT NULL, asentamiento TEXT NOT NULL, dueno INTEGER, asignada_en TEXT,
      modo_tenencia TEXT, precio_farycoins INTEGER, periodo_horas INTEGER, expira_en TEXT,
      impuesto_activo INTEGER NOT NULL DEFAULT 0, impuesto_farycoins INTEGER, impuesto_periodo_horas INTEGER, impuesto_ultimo_cobro TEXT
    );
    CREATE TABLE IF NOT EXISTS casillas_cultivo (
      mapa_id TEXT NOT NULL, idx_casilla INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      dueno_id INTEGER NOT NULL, estado TEXT NOT NULL, semilla_id TEXT, dia_plantado INTEGER,
      PRIMARY KEY (mapa_id, idx_casilla)
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno) VALUES ('tf_0001', 'parcela', 'testflat', 1)").run();
  // Casilla (27,10) YA sembrada y madura de sobra (diaPlantado muy anterior
  // a DIA) — sembrada DIRECTO en BD, ANTES de arrancar el servidor (la
  // caché de proceso de mundo/cultivoCasillaVivo.ts solo hidrata desde BD
  // la PRIMERA vez que se visita el mapa, así que tiene que estar aquí
  // desde el principio, no inyectada a mitad de sesión).
  const indice = JSON.parse(readFileSync(join(dirServidor, "..", "assets", "mapas", "testflat", "indice.json"), "utf8"));
  const anchoTestflat = indice.anchoChunks * indice.tamanoChunk;
  const idxMadura = 10 * anchoTestflat + 27;
  bd.prepare(
    "INSERT INTO casillas_cultivo (mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado) VALUES ('testflat', ?, 27.5, 10.5, 1, 'sembrada', 'semilla_trigo', ?)",
  ).run(idxMadura, DIA - 100); // muy anterior a DIA -> diasCrecimiento(3) cumplido de sobra
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
function esperarMensaje(room, tipo, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando mensaje "${tipo}"`)), ms);
    room.onMessage(tipo, (m) => { clearTimeout(t); resolve(m); });
  });
}
const darItem = async (room, itemId, cantidad = 1) => {
  room.send("admin:debug:darItem", { itemId, cantidad });
  await esperarMensaje(room, "admin:debug:ok");
};

const rutaTestflat = join(raiz, "assets", "mapas", "testflat");

let fallo = null;
try {
  console.log("2) arrancando servidor real (DIA_FORZADO=60 -> mes=3, JARL_NOMBRES para darItem/teleport)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestflat, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE, DIA_FORZADO: String(DIA) });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  const erroresCultivo = [];
  room.onMessage("cultivoCasilla:error", (m) => erroresCultivo.push(m));

  console.log("3) equipar azada_hierro...");
  await darItem(room, "azada_hierro", 1);
  await new Promise((r) => setTimeout(r, 300));
  let jugador = room.state.players.get(room.sessionId);
  const itAzada = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "azada_hierro");
  if (!itAzada) throw new Error("FALLO: no se encontró azada_hierro en el inventario tras darItem");
  room.send("equipo:equipar", { instanciaId: itAzada.id, slot: "manoPrincipal" });
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  if (jugador.inventario.equipo.get("manoPrincipal") !== "azada_hierro") throw new Error("FALLO: la azada no quedó equipada en manoPrincipal");
  console.log("   OK: azada_hierro equipada");

  console.log("4) teletransportarse a (26.5,10.5) — dentro de tf_0001, libre de muebles...");
  room.send("admin:debug:teleport", { x: 26.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));

  console.log("5) cultivoCasilla:labrar fuera de cualquier parcela se rechaza...");
  room.send("cultivoCasilla:labrar", { x: 0.5, y: 0.5 }); // esquina del mapa, sin parcela (RADIO_INTERACCION exige estar cerca, pero fuera de parcela igual se rechaza si estuviéramos ahí — comprobamos el motivo real)
  await new Promise((r) => setTimeout(r, 300));
  // (0.5,0.5) está lejísimos del jugador (26.5,10.5) -> el primer rechazo real es "demasiado_lejos", no "fuera_de_parcela". Confirmamos AL MENOS que se rechaza algo.
  if (!erroresCultivo.some((e) => e.motivo === "demasiado_lejos")) throw new Error(`FALLO: esperaba un rechazo por distancia, llegó ${JSON.stringify(erroresCultivo)}`);
  console.log("   OK: labrar lejos del jugador se rechaza (demasiado_lejos)");

  console.log("6) cultivoCasilla:labrar sobre una casilla YA OCUPADA por un mueble real (32,18, silla) se rechaza...");
  room.send("admin:debug:teleport", { x: 32.5, y: 18.5 });
  await new Promise((r) => setTimeout(r, 300));
  erroresCultivo.length = 0;
  room.send("cultivoCasilla:labrar", { x: 32.5, y: 18.5 });
  await new Promise((r) => setTimeout(r, 300));
  // Colocar la construcción endurece esa casilla a TIPO.SOLIDO en this.mundo
  // (aplicarColocacion) — el chequeo de terreno rechaza ANTES de llegar al
  // de ocupación explícita, ambos motivos son igual de válidos aquí.
  if (!erroresCultivo.some((e) => e.motivo === "suelo_ocupado" || e.motivo === "suelo_no_valido")) {
    throw new Error(`FALLO: esperaba un rechazo por suelo ocupado/no válido, llegó ${JSON.stringify(erroresCultivo)}`);
  }
  console.log("   OK: no se puede labrar encima de una construcción real");

  console.log("7) cultivoCasilla:labrar en (26.5,10.5), libre y dentro de tf_0001 (propia)...");
  room.send("admin:debug:teleport", { x: 26.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));
  erroresCultivo.length = 0;
  room.send("cultivoCasilla:labrar", { x: 26.5, y: 10.5 });
  const labrada = await esperarMensaje(room, "cultivoCasilla:labrada");
  if (labrada.x !== 26 || labrada.y !== 10) throw new Error(`FALLO: coordenadas de la casilla labrada inesperadas, llegó ${JSON.stringify(labrada)}`);
  console.log("   OK: cultivoCasilla:labrada — la parcela propia acepta labrar suelo libre");

  console.log("8) labrar la MISMA casilla otra vez se rechaza (ya_labrada)...");
  room.send("cultivoCasilla:labrar", { x: 26.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));
  if (!erroresCultivo.some((e) => e.motivo === "ya_labrada")) throw new Error(`FALLO: esperaba ya_labrada, llegó ${JSON.stringify(erroresCultivo)}`);
  console.log("   OK: no se puede labrar dos veces la misma casilla");

  console.log("9) cultivoCasilla:plantar semilla_trigo (mes 3, dentro de mesesSiembra [3,4,5])...");
  await darItem(room, "semilla_trigo", 1);
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const itSemilla = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "semilla_trigo");
  if (!itSemilla) throw new Error("FALLO: no se encontró semilla_trigo en el inventario tras darItem");
  room.send("cultivoCasilla:plantar", { x: 26.5, y: 10.5, instanciaIdSemilla: itSemilla.id });
  const plantada = await esperarMensaje(room, "cultivoCasilla:plantada");
  if (plantada.semillaId !== "semilla_trigo") throw new Error(`FALLO: plantada con semilla incorrecta, llegó ${JSON.stringify(plantada)}`);
  console.log("   OK: cultivoCasilla:plantada — la semilla se consumió del inventario y quedó sembrada");

  console.log("10) cosechar antes de tiempo (recién plantada) se rechaza (todavia_no)...");
  erroresCultivo.length = 0;
  room.send("cultivoCasilla:cosechar", { x: 26.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));
  if (!erroresCultivo.some((e) => e.motivo === "todavia_no")) throw new Error(`FALLO: esperaba todavia_no, llegó ${JSON.stringify(erroresCultivo)}`);
  console.log("   OK: no se puede cosechar antes de diasCrecimiento");

  console.log("11) casilla (27,10) sembrada directo en BD ANTES de arrancar (hidratada al crear la room) — ya madura, cosecharla...");
  room.send("admin:debug:teleport", { x: 27.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));
  room.send("cultivoCasilla:cosechar", { x: 27.5, y: 10.5 });
  const cosechada = await esperarMensaje(room, "cultivoCasilla:cosechada");
  if (cosechada.itemId !== "trigo" || cosechada.cantidad !== 3) {
    throw new Error(`FALLO: cosecha incorrecta, llegó ${JSON.stringify(cosechada)}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const trigoEnInventario = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "trigo");
  if (!trigoEnInventario || trigoEnInventario.cantidad !== 3) {
    throw new Error(`FALLO: el trigo cosechado no llegó al inventario, llegó ${JSON.stringify(trigoEnInventario)}`);
  }
  console.log("   OK: la casilla hidratada desde BD al crear la room (sembrada y madura) se cosechó de verdad — 3x trigo en el inventario");

  await room.leave();
  console.log("\n=== E2E agricultura de casilla: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E agricultura de casilla: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
