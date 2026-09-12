// E2E de `npc:inspeccionar` (docs/GDD_Poblacion_NPCs.md, pedido streamer
// 2026-09-12: clic sobre un NPC -> panel con "nombre, ciudad al que
// pertenece, oficio, familia si tiene") contra un servidor REAL. Como
// NINGÚN mapa ya horneado tiene familiaId/rolFamiliar/apellido en su
// poblacion.json (campos nuevos, ver escribirPoblacionDeMapa), este e2e
// hornea una aldea_pequena standalone + su población en un mapaId EFÍMERO
// bajo assets/mapas/ (RegionRoom solo resuelve mapaId ahí, borrado en el
// finally, nunca se comitea), que
// SÍ trae una familia real (censo.json::aldea_pequena tiene "aldeano"
// familia:true probFamilia:0.6):
//   Carles Salgado Méndez (cabeza) + Mónica Salgado Méndez (cónyuge) +
//   Cristina Salgado Méndez (hijo), más Isabel García Tejerina y María
//   Teresa Fernández de la Vega Sanz (sin familia) — ambas confirman el
//   caso "familia: null" sin reventar.
//   node server/test/npcInspeccionar.e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "npc_inspeccionar_e2e.sqlite");
const NOMBRE_MAPA_TMP = "aldea_inspeccion_e2e_tmp"; // efímero bajo assets/mapas/ (RegionRoom solo resuelve mapaId ahí, mundo/resolverMapa.ts) — se borra en el finally, NUNCA se comitea
const rutaMapa = join(raiz, "assets", "mapas", NOMBRE_MAPA_TMP);
const PUERTO = 2604;
const NOMBRE = "E2E-Inspeccionar";
const SEMILLA = "semilla-inspeccion-e2e";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) horneando una aldea_pequena standalone + su población (con familia real)...");
{
  rmSync(rutaMapa, { recursive: true, force: true });
  let r = spawnSync("node", ["ciudades/src/index.js", "aldea_pequena", SEMILLA, rutaMapa], { cwd: raiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: el bake de la aldea no terminó bien");
  r = spawnSync("node", ["poblacion/src/exportarAsentamiento.js", "aldea_pequena", SEMILLA, rutaMapa], { cwd: raiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: la exportación de población no terminó bien");
  if (!existsSync(join(rutaMapa, "poblacion.json"))) throw new Error("FALLO: no se generó poblacion.json");
}

console.log("2) sembrando BD sqlite temporal...");
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
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 1, '[]')").run();
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

function esperarMensaje(room, tipo, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando '${tipo}'`)), ms);
    room.onMessage(tipo, (m) => { clearTimeout(t); resolve(m); });
  });
}

let fallo = null;
try {
  console.log("3) arrancando servidor real sobre la aldea horneada...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaMapa, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("region", { mapaId: NOMBRE_MAPA_TMP, name: NOMBRE });
  await esperar(500);

  console.log(`4) hay ${room.state.npcs.size} NPCs en la región — buscando al cabeza de familia real...`);
  const slotCabeza = `${SEMILLA}|aldeano_1`;
  const slotConyuge = `${SEMILLA}|aldeano_1|conyuge`;
  const slotSinFamilia = `${SEMILLA}|aldeano_3`;
  for (const slot of [slotCabeza, slotConyuge, slotSinFamilia]) {
    if (!room.state.npcs.has(slot)) throw new Error(`FALLO: no existe el NPC ${slot} en state.npcs (¿cambió el bake?)`);
  }

  console.log("5) inspeccionando al CABEZA de familia (Carles Salgado Méndez)...");
  {
    const p = esperarMensaje(room, "npc:info");
    room.send("npc:inspeccionar", { slotId: slotCabeza });
    const info = await p;
    if (info.slotId !== slotCabeza) throw new Error(`FALLO: slotId incorrecto en la respuesta: ${JSON.stringify(info)}`);
    if (!/Carles/.test(info.nombre)) throw new Error(`FALLO: nombre incorrecto: ${JSON.stringify(info)}`);
    if (info.oficio !== "campesino") throw new Error(`FALLO: oficio incorrecto, esperaba 'campesino': ${JSON.stringify(info)}`);
    if (info.ciudad !== "Aldea pequeña") throw new Error(`FALLO: ciudad incorrecta, esperaba 'Aldea pequeña': ${JSON.stringify(info)}`);
    if (!info.familia || info.familia.apellido !== "Salgado Méndez" || info.familia.rol !== "cabeza") {
      throw new Error(`FALLO: familia incorrecta, esperaba apellido 'Salgado Méndez' rol 'cabeza': ${JSON.stringify(info)}`);
    }
    console.log(`   OK: ${JSON.stringify(info)}`);
  }

  console.log("6) inspeccionando al CÓNYUGE (mismo apellido, rol distinto)...");
  {
    const p = esperarMensaje(room, "npc:info");
    room.send("npc:inspeccionar", { slotId: slotConyuge });
    const info = await p;
    if (info.familia?.apellido !== "Salgado Méndez" || info.familia?.rol !== "conyuge") {
      throw new Error(`FALLO: familia del cónyuge incorrecta: ${JSON.stringify(info)}`);
    }
    console.log(`   OK: ${JSON.stringify(info)}`);
  }

  console.log("7) inspeccionando un NPC SIN familia (familia debe ser null, no reventar)...");
  {
    const p = esperarMensaje(room, "npc:info");
    room.send("npc:inspeccionar", { slotId: slotSinFamilia });
    const info = await p;
    if (info.familia !== null) throw new Error(`FALLO: esperaba familia:null para un NPC sin familia, llegó ${JSON.stringify(info)}`);
    if (!/Isabel/.test(info.nombre)) throw new Error(`FALLO: nombre incorrecto: ${JSON.stringify(info)}`);
    console.log(`   OK: ${JSON.stringify(info)}`);
  }

  console.log("8) inspeccionando un slotId que no existe -> npc:error, sin reventar el servidor...");
  {
    const p = esperarMensaje(room, "npc:error");
    room.send("npc:inspeccionar", { slotId: "no_existe_de_verdad" });
    const err = await p;
    if (!err.motivo) throw new Error(`FALLO: npc:error sin motivo: ${JSON.stringify(err)}`);
    console.log(`   OK: ${JSON.stringify(err)}`);
  }

  await room.leave();
  console.log("\n✅ TODO OK: npc:inspeccionar verificado contra el servidor real, familia real incluida.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
  rmSync(rutaMapa, { recursive: true, force: true }); // efímero, nunca se comitea
}
if (fallo) { console.error(fallo); process.exit(1); }
