// E2E de pasajeros REALES en un conjunto de tiro (docs/GDD_Carros.md §4/§8.1,
// Fase 4, pedido 2026-09-03) contra el servidor REAL — Fase 1 ya construyó
// el mecanismo de varios asientos (conductorSessionId + ocupantesDeConjunto,
// mismo patrón que barcos) pero NUNCA se probó con más de un jugador de
// verdad montado a la vez. Usa `diligencia_4` (4 asientos), el primer carro
// del catálogo con capacidad para pasajeros reales.
//   1. El conductor engancha+monta el buey+diligencia.
//   2. TRES pasajeros más se montan (conjunto:montar sin conjuntoId,
//      auto-apuntado) hasta llenar las 4 plazas — cada uno recibe
//      Player.conjuntoConductor=false.
//   3. Un QUINTO jugador no puede montar: sin hueco.
//   4. El conductor se mueve; los pasajeros se mueven CON él (offset fijo),
//      sin mandar su propio input.
//   node server/test/carroPasajeros.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "carroPasajeros_e2e.sqlite");
const PUERTO = 2607;
const NOMBRE_CONDUCTOR = "E2E-Cochero";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador conductor + buey con arnés reforzado 'siguiendo')...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS mascotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, especie_id TEXT NOT NULL,
      ubicacion TEXT NOT NULL DEFAULT 'siguiendo', propiedad_id TEXT, creado_en TEXT NOT NULL,
      montura INTEGER NOT NULL DEFAULT 0, arnes INTEGER NOT NULL DEFAULT 0, arnes_peso_maximo REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS carros (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, tipo_id TEXT NOT NULL, mapa_id TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, creado_en TEXT NOT NULL, contenido TEXT
    );
    CREATE TABLE IF NOT EXISTS conjuntos_tiro (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, mascota_id INTEGER NOT NULL,
      especie_animal_id TEXT NOT NULL, carro_tipo_id TEXT NOT NULL, mapa_id TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, creado_en TEXT NOT NULL, contenido TEXT
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE_CONDUCTOR, new Date().toISOString());
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (1, 'buey', 'siguiendo', NULL, ?, 0, 1, 400)").run(new Date().toISOString());
  bd.close();
}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  p.stderr.on("data", (d) => process.stdout.write(`[srv:err] ${d}`));
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

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real (JARL_NOMBRES para admin:debug:darItem)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE_CONDUCTOR });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("3) conductor: darItem arnes_reforzado + diligencia_4, ponerArnes, colocar, enganchar, montar...");
  const clienteConductor = new Client(`ws://localhost:${PUERTO}`);
  const roomConductor = await clienteConductor.joinOrCreate("hub", { name: NOMBRE_CONDUCTOR });
  await new Promise((r) => setTimeout(r, 700));

  await darItem(roomConductor, "arnes_reforzado", 1);
  roomConductor.send("mascota:ponerArnes", {});
  await new Promise((r) => setTimeout(r, 300));

  await darItem(roomConductor, "diligencia_4", 1);
  roomConductor.send("carro:colocar", { itemId: "diligencia_4" });
  await esperarMensaje(roomConductor, "carro:colocado");
  roomConductor.send("carro:enganchar", {});
  const enganchado = await esperarMensaje(roomConductor, "carro:enganchado");
  roomConductor.send("conjunto:montar", {});
  await new Promise((r) => setTimeout(r, 300));
  let jugadorConductor = roomConductor.state.players.get(roomConductor.sessionId);
  if (!jugadorConductor.conjuntoConductor || jugadorConductor.conjuntoId !== enganchado.conjuntoId) {
    throw new Error(`FALLO: el cochero no quedó como conductor (conjuntoId=${jugadorConductor.conjuntoId}, conjuntoConductor=${jugadorConductor.conjuntoConductor})`);
  }
  console.log(`   OK: conjunto ${enganchado.conjuntoId} (buey + diligencia_4, 4 plazas) enganchado, cochero al mando`);

  console.log("4) TRES pasajeros se montan hasta llenar las 4 plazas...");
  const pasajeros = [];
  for (let i = 1; i <= 3; i++) {
    const cliente = new Client(`ws://localhost:${PUERTO}`);
    const room = await cliente.joinOrCreate("hub", { name: `E2E-Pasajero-${i}` });
    await new Promise((r) => setTimeout(r, 400));
    room.send("conjunto:montar", {});
    await new Promise((r) => setTimeout(r, 300));
    const jugador = room.state.players.get(room.sessionId);
    if (jugador.conjuntoId !== enganchado.conjuntoId || jugador.conjuntoConductor !== false) {
      throw new Error(`FALLO: pasajero ${i} no se montó como pasajero (conjuntoId=${jugador.conjuntoId}, conjuntoConductor=${jugador.conjuntoConductor})`);
    }
    pasajeros.push({ cliente, room });
    console.log(`   OK: pasajero ${i} montado (asiento ${i + 1}/4)`);
  }

  console.log("5) un QUINTO jugador no puede montar: las 4 plazas ya están llenas...");
  const clienteExtra = new Client(`ws://localhost:${PUERTO}`);
  const roomExtra = await clienteExtra.joinOrCreate("hub", { name: "E2E-Pasajero-Extra" });
  await new Promise((r) => setTimeout(r, 400));
  const erroresExtra = [];
  roomExtra.onMessage("carro:error", (m) => erroresExtra.push(m));
  roomExtra.send("conjunto:montar", {});
  await new Promise((r) => setTimeout(r, 400));
  if (!erroresExtra.some((e) => e.motivo === "nada_cerca")) {
    throw new Error(`FALLO: el 5º jugador debería haber sido rechazado (sin hueco), llegó ${JSON.stringify(erroresExtra)}`);
  }
  const jugadorExtra = roomExtra.state.players.get(roomExtra.sessionId);
  if (jugadorExtra.conjuntoId !== 0) throw new Error("FALLO: el 5º jugador no debería haberse montado");
  console.log("   OK: con las 4 plazas llenas, un 5º jugador queda fuera");
  await roomExtra.leave();

  console.log("6) el cochero avanza — los 3 pasajeros deben moverse CON él (offset fijo), sin input propio...");
  const x0 = jugadorConductor.x, y0 = jugadorConductor.y;
  const posicionesPasajeros0 = pasajeros.map((p) => {
    const j = p.room.state.players.get(p.room.sessionId);
    return { x: j.x, y: j.y };
  });
  roomConductor.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 1000));
  roomConductor.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 300));
  jugadorConductor = roomConductor.state.players.get(roomConductor.sessionId);
  const distanciaConductor = Math.hypot(jugadorConductor.x - x0, jugadorConductor.y - y0);
  if (distanciaConductor < 1) throw new Error(`FALLO: el cochero apenas se movió (${distanciaConductor.toFixed(2)} casillas)`);

  for (let i = 0; i < pasajeros.length; i++) {
    const j = pasajeros[i].room.state.players.get(pasajeros[i].room.sessionId);
    const distanciaPasajero = Math.hypot(j.x - posicionesPasajeros0[i].x, j.y - posicionesPasajeros0[i].y);
    // El pasajero se mueve JUNTO al conjunto, no por su cuenta — su
    // desplazamiento debe ser parecido al del cochero (offset fijo
    // alrededor del conductor, mismo criterio que un pasajero de barco),
    // no cero (se quedaría atrás) ni descontrolado.
    if (distanciaPasajero < 0.5) throw new Error(`FALLO: el pasajero ${i + 1} no siguió al conjunto (se movió ${distanciaPasajero.toFixed(2)})`);
    const distanciaAlConductorAhora = Math.hypot(j.x - jugadorConductor.x, j.y - jugadorConductor.y);
    if (distanciaAlConductorAhora > 1.5) throw new Error(`FALLO: el pasajero ${i + 1} quedó demasiado lejos del cochero (${distanciaAlConductorAhora.toFixed(2)})`);
  }
  console.log(`   OK: los 3 pasajeros se movieron junto al conjunto (cochero avanzó ${distanciaConductor.toFixed(2)} casillas)`);

  for (const p of pasajeros) await p.room.leave();
  await roomConductor.leave();
  console.log("\n=== E2E pasajeros de carro: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E pasajeros de carro: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
