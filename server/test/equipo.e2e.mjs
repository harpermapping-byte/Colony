// E2E de los mensajes equipo:equipar/equipo:desequipar (docs/GDD_Equipo.md)
// contra el servidor REAL (sin navegador — Colyseus puro, mismo patrón que
// faccionBandidos.e2e.mjs): arranca el Hub de verdad y comprueba que los
// handlers están conectados de punta a punta (onMessage -> lógica pura de
// inventario.ts -> Schema -> respuesta al cliente), incluidas las rutas de
// error reales. La ruta feliz completa (coger un objeto del mundo real y
// luego equiparlo) queda cubierta por los 35 tests puros de
// server/test/inventario.test.ts (equiparItem/desequiparItem/
// calcularStatsEquipo/pesoTotalJugador) — el mapa de prueba (assets/mapas/
// demo) no tiene ningún recolectable al alcance del spawn, así que
// reproducir esa ruta aquí exigiría hornear un mapa nuevo solo para este
// test; este E2E se centra en lo que SOLO se puede probar contra el
// servidor real: que los mensajes llegan, tocan el Schema de verdad y
// responden por la red.
//   node server/test/equipo.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const PUERTO = 2596;

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
  console.log("1) arrancando servidor real (Hub sobre el mapa demo — pequeño y rápido, mismo criterio que el resto de tests)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("2) uniéndose al Hub...");
  const room = await client.joinOrCreate("hub", { name: "E2E-Equipo" });
  await new Promise((r) => setTimeout(r, 500));
  const jugador = room.state.players.get(room.sessionId);

  console.log("3) estado inicial de combate/equipo del jugador...");
  if (jugador.ataque !== 3) throw new Error(`FALLO: ataque base inesperado (${jugador.ataque}, se esperaba 3)`);
  if (jugador.defensa !== 0) throw new Error(`FALLO: defensa base inesperada (${jugador.defensa}, se esperaba 0)`);
  if (jugador.ataqueMagico !== 0 || jugador.defensaMagica !== 0) throw new Error("FALLO: ataqueMagico/defensaMagica deberían nacer en 0");
  if (jugador.inventario.equipo.size !== 0) throw new Error("FALLO: el jugador no debería nacer con nada equipado");
  console.log("   OK: Player.ataque/defensa/ataqueMagico/defensaMagica y equipo vacío tal como se esperaba al nacer");

  console.log("4) equipo:equipar con una instancia que NO existe...");
  const erroresEquipo = [];
  room.onMessage("equipo:error", (m) => erroresEquipo.push(m));
  room.send("equipo:equipar", { instanciaId: 999999, slot: "casco" });
  await new Promise((r) => setTimeout(r, 400));
  if (erroresEquipo.length !== 1 || erroresEquipo[0].motivo !== "instancia_no_encontrada") {
    throw new Error(`FALLO: se esperaba equipo:error/instancia_no_encontrada, llegó ${JSON.stringify(erroresEquipo)}`);
  }
  console.log("   OK: equipo:equipar con instancia inexistente responde equipo:error/instancia_no_encontrada — el handler está conectado de verdad");

  console.log("5) equipo:desequipar sobre un slot vacío...");
  erroresEquipo.length = 0;
  room.send("equipo:desequipar", { slot: "casco" });
  await new Promise((r) => setTimeout(r, 400));
  if (erroresEquipo.length !== 1 || erroresEquipo[0].motivo !== "slot_vacio") {
    throw new Error(`FALLO: se esperaba equipo:error/slot_vacio, llegó ${JSON.stringify(erroresEquipo)}`);
  }
  console.log("   OK: equipo:desequipar sobre un slot vacío responde equipo:error/slot_vacio");

  console.log("6) mensajes malformados no tiran el servidor abajo (sigue respondiendo después)...");
  room.send("equipo:equipar", {});
  room.send("equipo:desequipar", {});
  await new Promise((r) => setTimeout(r, 300));
  erroresEquipo.length = 0;
  room.send("equipo:equipar", { instanciaId: 123, slot: "casco" });
  await new Promise((r) => setTimeout(r, 400));
  if (erroresEquipo.length !== 1) throw new Error("FALLO: el servidor dejó de responder tras un mensaje malformado");
  console.log("   OK: el servidor sigue vivo y respondiendo tras mensajes sin payload");

  await room.leave();
  console.log("\n=== E2E equipo:equipar/desequipar: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E equipo: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
