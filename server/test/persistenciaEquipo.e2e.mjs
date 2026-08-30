// E2E de persistencia de inventario/equipo entre sesiones (docs/GDD_Equipo.md
// §9, antes descartada explícitamente por falta de jugador_id estable — ya
// resuelto: la MISMA identidad "nombre -> jugador_id" que usan gremios/
// oficios/atributos/mascotas, vía obtenerOCrearJugador). Contra el servidor
// REAL (mismo patrón que equipo.e2e.mjs/faccionBandidos.e2e.mjs): sin bake
// real con recolectables al alcance, se siembra la BD sqlite temporal
// DIRECTAMENTE (jugador_id=1 fijo, misma forma de fila que guardarContenedor)
// antes de arrancar el servidor — así el join real ejercita el camino de
// CARGA sin depender de "coger" del mundo.
//
//   1. Con la BD ya sembrada (jugador "E2E-Persistencia" con un casco_cuero
//      en el cuerpo), el primer join debe cargarlo de verdad en el Schema.
//   2. equipo:equipar lo mueve a equipo — se guarda en segundo plano
//      (persistirInventarioPorSesion, sin awaitear la propia mecánica).
//   3. room.leave() dispara el guardado AWAITEADO de onLeave — se comprueba
//      la fila de `equipo` en la BD desde FUERA de la room (mismo criterio
//      que faccionBandidos.e2e.mjs).
//   4. Un SEGUNDO join con el MISMO nombre (sesión nueva de Colyseus, mismo
//      jugador_id) debe traer el casco YA equipado — el cierre real del
//      ciclo "persistencia entre sesiones", no solo un roundtrip de BD.
//   node server/test/persistenciaEquipo.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "persistencia_e2e.sqlite");
const PUERTO = 2599;
const NOMBRE = "E2E-Persistencia";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador + casco_cuero en el cuerpo, ANTES de arrancar el servidor)...");
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
    CREATE TABLE IF NOT EXISTS equipo (
      jugador_id INTEGER NOT NULL,
      slot TEXT NOT NULL,
      item_id TEXT NOT NULL,
      PRIMARY KEY (jugador_id, slot)
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  const items = JSON.stringify([{ id: 1, itemId: "casco_cuero", cantidad: 1, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);
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

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre esa BD sembrada...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("3) primer join (misma sesión que la BD sembrada) — debe CARGAR el casco en el cuerpo...");
  const clienteA = new Client(`ws://localhost:${PUERTO}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700)); // cargarInventarioYEquipoDe es async, sin awaitear desde crearJugador
  const jugadorA = roomA.state.players.get(roomA.sessionId);
  const itemsCuerpo = [...jugadorA.inventario.cuerpo.items];
  if (itemsCuerpo.length !== 1 || itemsCuerpo[0].itemId !== "casco_cuero" || itemsCuerpo[0].id !== 1) {
    throw new Error(`FALLO: el cuerpo no cargó el casco sembrado en BD, llegó ${JSON.stringify(itemsCuerpo)}`);
  }
  console.log("   OK: el join cargó de verdad el contenedor 'cuerpo' guardado en una sesión anterior");

  console.log("4) equipo:equipar el casco cargado (instanciaId=1, slot=casco)...");
  const erroresEquipo = [];
  roomA.onMessage("equipo:error", (m) => erroresEquipo.push(m));
  roomA.send("equipo:equipar", { instanciaId: 1, slot: "casco" });
  await new Promise((r) => setTimeout(r, 400));
  if (erroresEquipo.length > 0) throw new Error(`FALLO: equipo:equipar rechazado, ${JSON.stringify(erroresEquipo)}`);
  const equipadoEnVivo = jugadorA.inventario.equipo.get("casco");
  if (equipadoEnVivo !== "casco_cuero") throw new Error(`FALLO: el Schema en vivo no muestra el casco equipado (${equipadoEnVivo})`);
  if ([...jugadorA.inventario.cuerpo.items].length !== 0) throw new Error("FALLO: el casco debería haber salido del cuerpo al equiparse");
  console.log("   OK: equipar mueve el casco de cuerpo -> equipo en el Schema en vivo");

  console.log("5) room.leave() — debe AWAITEAR el guardado antes de soltar la sesión...");
  await roomA.leave();
  await new Promise((r) => setTimeout(r, 300)); // margen para que el proceso del servidor termine de procesar el onLeave

  console.log("6) comprobando la BD DESDE FUERA de la room (mismo criterio que faccionBandidos.e2e.mjs)...");
  {
    const bd = new DatabaseSync(rutaBd);
    const filaEquipo = bd.prepare("SELECT item_id FROM equipo WHERE jugador_id = 1 AND slot = 'casco'").get();
    if (!filaEquipo || filaEquipo.item_id !== "casco_cuero") {
      throw new Error(`FALLO: onLeave no guardó el equipo (fila: ${JSON.stringify(filaEquipo)})`);
    }
    const filaCuerpo = bd.prepare("SELECT items FROM inventarios WHERE jugador_id = 1 AND contenedor_id = 'cuerpo'").get();
    const itemsGuardados = JSON.parse(filaCuerpo.items);
    if (itemsGuardados.length !== 0) throw new Error(`FALLO: el cuerpo guardado todavía tiene el casco (${filaCuerpo.items})`);
    bd.close();
  }
  console.log("   OK: onLeave persistió equipo (casco->casco_cuero) y cuerpo (vacío) en la BD real");

  console.log("7) SEGUNDO join, mismo nombre (sesión Colyseus nueva, mismo jugador_id) — debe traer el casco YA equipado...");
  const clienteB = new Client(`ws://localhost:${PUERTO}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  const jugadorB = roomB.state.players.get(roomB.sessionId);
  const equipadoTrasReconexion = jugadorB.inventario.equipo.get("casco");
  if (equipadoTrasReconexion !== "casco_cuero") {
    throw new Error(`FALLO: la segunda sesión no recuperó el casco equipado (${equipadoTrasReconexion})`);
  }
  if ([...jugadorB.inventario.cuerpo.items].length !== 0) throw new Error("FALLO: la segunda sesión no debería traer nada suelto en el cuerpo");
  console.log("   OK: una sesión de Colyseus NUEVA, con el mismo nombre, recupera el equipo de la sesión anterior — persistencia entre sesiones real");

  await roomB.leave();
  console.log("\n=== E2E persistencia de inventario/equipo: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E persistencia: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
