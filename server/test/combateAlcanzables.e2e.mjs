// E2E de "casillas alcanzables" en combate (docs/GDD_Combate.md, pedido
// streamer 2026-09-09: "las casillas alcanzables no se pintan en verde por
// adelantado — hoy solo ves si podías llegar cuando el servidor te rechaza
// el clic... haz esto"). Protocolo real (sin navegador — colyseus.js puro,
// mismo criterio que combateHabilidadDesgastePocion.e2e.mjs/combateCoop.e2e.mjs:
// no hay panel de cliente que dibuje el verde en este e2e, lo que hay que
// confirmar es que el SERVIDOR calcula y manda lo correcto, jugado de
// verdad).
//
// El cálculo en sí (Dijkstra por PA/coste de terreno/ocupación,
// casillasAlcanzables en pathfindingArena.ts) YA está cubierto exhaustivamente
// por server/test/pathfindingArena.test.ts — este e2e NO re-verifica esa
// matemática, verifica el CABLEADO nuevo: que combate:alcanzables (mensaje
// nuevo) resuelve la unidad correcta, usa el MISMO PA/posición/ocupación
// reales de la unidad en ESE combate, y que la respuesta cambia de verdad
// tras moverse (no es una foto fija calculada una sola vez).
//
//   node server/test/combateAlcanzables.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Client } from "colyseus.js";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "combate_alcanzables_e2e.sqlite");
const rutaTestzone = join(raiz, "assets", "mapas", "testzone");
const PUERTO = 2613;
const NOMBRE = "E2E-Alcanzables";
const DUMMY_ID = "dummy_1"; // npcsFijos.json de testzone, slotId real, junto a x:236,y:280

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl mínimo, sin arma/inventario — no hace falta para este e2e)...");
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
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, new Date().toISOString());
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
  while (Date.now() < ms + t0) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarCondicion(fn, timeoutMs, intervaloMs = 100) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const v = fn();
    if (v) return v;
    await esperar(intervaloMs);
  }
  return null;
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
}

try {
  console.log("2) arrancando servidor real sobre assets/mapas/testzone/...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestzone, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const cliente = new Client(`ws://localhost:${PUERTO}`);
  let room = await cliente.joinOrCreate("hub", { name: NOMBRE });
  await esperar(500);

  let adminOk = null, combateErr = null, portalIr = null;
  room.onMessage("admin:debug:ok", (m) => (adminOk = m));
  room.onMessage("combate:error", (m) => { combateErr = m; console.log("  combate:error", m); });
  room.onMessage("portal:ir", (m) => (portalIr = m));

  console.log("3) teleport junto al dummy_1 (Zona 5, x:236,y:280) y combate:iniciar...");
  room.send("admin:debug:teleport", { x: 237, y: 280 });
  await esperarCondicion(() => adminOk?.accion === "teleport", 3000);
  comprobar("teleport responde ok", adminOk?.accion === "teleport", JSON.stringify(adminOk));

  room.send("combate:iniciar", { objetivoId: DUMMY_ID });
  const combateId = await esperarCondicion(() => {
    for (const [id, c] of room.state.combates.entries()) if (c.unidades.has(DUMMY_ID)) return id;
    return null;
  }, 3000);
  comprobar("combate:iniciar contra el dummy abre ventana de unión", !!combateId, combateErr ? JSON.stringify(combateErr) : combateId);
  if (!combateId) throw new Error("no se pudo iniciar combate contra dummy_1");

  console.log("4) comenzarYa -> portal:ir a la arena real...");
  room.send("combate:comenzarYa", { combateId });
  await esperarCondicion(() => portalIr?.combateId === combateId, 3000);
  room.leave();
  await esperar(300);

  const arena = await cliente.joinOrCreate("arena", { name: NOMBRE, combateId });
  await esperarCondicion(() => arena.state?.combates?.get(combateId)?.fase === "activo", 3000);
  comprobar("la arena monta el combate en fase activo", arena.state.combates.get(combateId)?.fase === "activo");

  let respuestaAlcanzables = null;
  arena.onMessage("combate:alcanzables", (m) => (respuestaAlcanzables = m));

  async function esperarMiTurno() {
    return esperarCondicion(() => {
      const c = arena.state.combates.get(combateId);
      return c && c.fase === "activo" && c.ordenTurnos[c.turnoActual] === arena.sessionId ? c : null;
    }, 8000, 300);
  }

  console.log("5) esperando mi turno y pidiendo combate:alcanzables...");
  let combate = await esperarMiTurno();
  comprobar("llega mi turno", !!combate);
  if (!combate) throw new Error("nunca llegó mi turno");

  // OJO: los objetos de Schema de colyseus.js son MUTABLES EN VIVO (el
  // mismo objeto se actualiza in-place con cada patch, nunca se reemplaza)
  // — hay que copiar los números que importan a variables planas AQUÍ,
  // nunca guardar la referencia y leerla más tarde esperando el valor de
  // "antes" (bug real que se coló al escribir este mismo e2e: comparar
  // pa_antes/pa_después leyendo dos veces del mismo objeto mutado daba
  // pa_antes === pa_después SIEMPRE, aunque el PA real sí hubiera bajado).
  const cuPropia = combate.unidades.get(arena.sessionId);
  const cuDummy = combate.unidades.get(DUMMY_ID);
  const paAntes = cuPropia.pa;
  const dummyAntes = { gx: cuDummy.gx, gy: cuDummy.gy };
  respuestaAlcanzables = null;
  arena.send("combate:alcanzables", { combateId });
  await esperarCondicion(() => respuestaAlcanzables?.combateId === combateId, 3000);
  comprobar("llega respuesta combate:alcanzables", respuestaAlcanzables?.combateId === combateId, JSON.stringify(respuestaAlcanzables)?.slice(0, 200));
  if (!respuestaAlcanzables) throw new Error("sin respuesta de combate:alcanzables");

  const casillas1 = respuestaAlcanzables.casillas;
  comprobar("hay casillas alcanzables (PA>0, tablero abierto)", casillas1.length > 0, `count=${casillas1.length} pa=${paAntes}`);

  const propiaCasilla = { gx: cuPropia.gx, gy: cuPropia.gy };
  const fueraDeAlcance = casillas1.filter((c) => chebyshev(c, propiaCasilla) > paAntes);
  comprobar(
    "NINGUNA casilla devuelta excede el PA real (distancia Chebyshev <= pa, tablero sin obstáculos raros)",
    fueraDeAlcance.length === 0,
    `pa=${paAntes} fueraDeAlcance=${JSON.stringify(fueraDeAlcance)}`,
  );

  const incluyeCasillaDelDummy = casillas1.some((c) => c.gx === dummyAntes.gx && c.gy === dummyAntes.gy);
  comprobar("la casilla OCUPADA por el dummy NO aparece como alcanzable (no puedes moverte encima de otra unidad)", !incluyeCasillaDelDummy, `dummy=(${dummyAntes.gx},${dummyAntes.gy})`);

  const propiaCasillaIncluida = casillas1.some((c) => c.gx === propiaCasilla.gx && c.gy === propiaCasilla.gy);
  comprobar("tu propia casilla actual NO sale en la lista (no es un 'movimiento' de verdad)", !propiaCasillaIncluida);

  console.log("6) me muevo (combate:mover real) y vuelvo a pedir combate:alcanzables — debe reducirse el PA disponible y el set...");
  const destino = casillas1.reduce((mejor, c) => (!mejor || chebyshev(c, propiaCasilla) < chebyshev(mejor, propiaCasilla) ? c : mejor), null);
  arena.send("combate:mover", { combateId, gx: destino.gx, gy: destino.gy });
  await esperarCondicion(() => {
    const u = arena.state.combates.get(combateId)?.unidades.get(arena.sessionId);
    return u && u.gx === destino.gx && u.gy === destino.gy;
  }, 3000);
  const cuPropiaDespues = arena.state.combates.get(combateId).unidades.get(arena.sessionId);
  const propiaDespues = { gx: cuPropiaDespues.gx, gy: cuPropiaDespues.gy, pa: cuPropiaDespues.pa };
  comprobar("combate:mover movió de verdad y gastó PA real", propiaDespues.pa < paAntes, `pa antes=${paAntes} después=${propiaDespues.pa}`);

  respuestaAlcanzables = null;
  arena.send("combate:alcanzables", { combateId });
  await esperarCondicion(() => respuestaAlcanzables?.combateId === combateId, 3000);
  const casillas2 = respuestaAlcanzables?.casillas ?? [];
  comprobar(
    "tras moverse (menos PA), la respuesta NUEVA no es la misma foto fija de antes — combate:alcanzables recalcula de verdad cada vez",
    JSON.stringify([...casillas2].sort((a, b) => a.gx - b.gx || a.gy - b.gy)) !== JSON.stringify([...casillas1].sort((a, b) => a.gx - b.gx || a.gy - b.gy)),
    `antes=${casillas1.length} después=${casillas2.length} pa_restante=${propiaDespues.pa}`,
  );
  const fueraDeAlcance2 = casillas2.filter((c) => chebyshev(c, { gx: propiaDespues.gx, gy: propiaDespues.gy }) > propiaDespues.pa);
  comprobar("la nueva respuesta también respeta el PA real restante", fueraDeAlcance2.length === 0, `pa=${propiaDespues.pa} fueraDeAlcance=${JSON.stringify(fueraDeAlcance2)}`);

  console.log(`\n=== RESUMEN: combate:alcanzables verificado con protocolo real (combateId=${combateId}) ===`);
} catch (err) {
  console.error("ERROR en el e2e:", err);
  fallos++;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
}

console.log(fallos === 0 ? "\n✅ combateAlcanzables.e2e: TODO OK" : `\n❌ combateAlcanzables.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
