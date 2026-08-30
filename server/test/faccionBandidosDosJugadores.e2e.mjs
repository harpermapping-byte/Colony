// E2E de multijugador real sobre la patrulla bandida (pedido del streamer
// 2026-08-30: "a ver si dos jugadores ven esas patrullas") — dos sesiones
// Colyseus DISTINTAS conectadas a la MISMA región (mismo mapaId, filterBy)
// y comprueban que:
//   1. Ambas caen en la MISMA room (se ven mutuamente en state.players).
//   2. Ambas ven EXACTAMENTE los mismos Npc `hostil` (mismos slotId), en
//      la MISMA posición — la patrulla es estado de mundo compartido, no
//      algo que cada conexión simule por su cuenta.
//   3. Cuando UN jugador mata a la tropa, el OTRO jugador (que no hizo
//      nada) también ve desaparecer al hostil y aparecer el cadáver —
//      mismo Schema replicado a los dos.
//   node server/test/faccionBandidosDosJugadores.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_2players_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_2players_e2e.sqlite");
const PUERTO = 2604;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-2players-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);
if (!Array.isArray(indice.caminos) || indice.caminos.length === 0) throw new Error("el bake de prueba no trae ningún camino puerta<->plaza");

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

function hostilesDe(state) {
  return [...state.npcs.entries()].filter(([, n]) => n.hostil);
}

let fallo = null;
try {
  console.log("2) arrancando servidor con BD temporal (tick de economía apagado de sobra)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  // La patrulla camina entre la puerta y la plaza (mismo dato que
  // RegionRoom.poblarPatrullaBandida) — los dos jugadores entran justo ahí
  // para no depender de una caminata a ciegas por un mapa con muralla de
  // por medio (mismo criterio que faccionBandidosPatrulla.e2e.mjs).
  const plaza = indice.caminos[0][indice.caminos[0].length - 1];

  console.log("3) DOS clientes Colyseus distintos, misma región (mismo mapaId)...");
  const clientA = new Client(`ws://localhost:${PUERTO}`);
  const clientB = new Client(`ws://localhost:${PUERTO}`);
  const regionA = await clientA.joinOrCreate("region", { name: "Jugador-A", mapaId, entradaX: plaza[0], entradaY: plaza[1] });
  await esperar(300);
  const regionB = await clientB.joinOrCreate("region", { name: "Jugador-B", mapaId, entradaX: plaza[0], entradaY: plaza[1] });
  await esperar(500);

  if (regionA.roomId !== regionB.roomId) {
    throw new Error(`FALLO: los dos jugadores cayeron en rooms DISTINTAS (${regionA.roomId} vs ${regionB.roomId}) — filterBy(mapaId) debería haberlos juntado`);
  }
  if (regionA.state.players.size !== 2 || regionB.state.players.size !== 2) {
    throw new Error(`FALLO: cada jugador debería ver 2 players (a sí mismo + el otro) — A ve ${regionA.state.players.size}, B ve ${regionB.state.players.size}`);
  }
  console.log(`   OK: misma room (${regionA.roomId}), cada jugador ve a los 2 players conectados`);

  console.log("4) esperando a que la patrulla se mueva un poco, y comprobando que AMBOS ven la MISMA patrulla...");
  await esperar(4000);
  const hostA = hostilesDe(regionA.state);
  const hostB = hostilesDe(regionB.state);
  if (hostA.length === 0) throw new Error("FALLO: el jugador A no ve ninguna patrulla (state.npcs sin hostil:true)");
  if (hostA.length !== hostB.length) {
    throw new Error(`FALLO: A ve ${hostA.length} patrulla(s) hostil(es), B ve ${hostB.length} — deberían ser el mismo estado de mundo`);
  }
  const idsA = new Set(hostA.map(([id]) => id));
  const idsB = new Set(hostB.map(([id]) => id));
  if (idsA.size !== idsB.size || [...idsA].some((id) => !idsB.has(id))) {
    throw new Error(`FALLO: A y B ven slotId distintos — A=${JSON.stringify([...idsA])}, B=${JSON.stringify([...idsB])}`);
  }
  let maxDesajuste = 0;
  for (const [id, nA] of hostA) {
    const nB = regionB.state.npcs.get(id);
    const d = Math.hypot(nA.x - nB.x, nA.y - nB.y);
    maxDesajuste = Math.max(maxDesajuste, d);
  }
  if (maxDesajuste > 1) throw new Error(`FALLO: la misma tropa aparece en posiciones muy distintas para A y B (desajuste=${maxDesajuste.toFixed(2)} casillas) — ¿estado no compartido de verdad?`);
  console.log(`   OK: A y B ven exactamente los mismos ${hostA.length} Npc hostil(es), mismas posiciones (desajuste máximo ${maxDesajuste.toFixed(2)} casillas — solo diferencia de timing de patch, no de estado)`);

  console.log("5) el jugador A ataca (agro por distancia, sin combate:iniciar) — comprobando que B TAMBIÉN lo ve desaparecer/morir...");
  const jugadorA = regionA.state.players.get(regionA.sessionId);
  let portalRecibidoA = null;
  regionA.onMessage("portal:ir", (info) => { portalRecibidoA = info; });
  const objetivoId = hostA[0][0];
  let dist = Infinity;
  let pasos = 0;
  while (dist > 4 && pasos < 200) {
    const npc = regionA.state.npcs.get(objetivoId);
    if (!npc) break;
    regionA.send("input", { x: Math.sign(npc.x - jugadorA.x), y: Math.sign(npc.y - jugadorA.y) });
    await esperar(150);
    dist = Math.hypot(npc.x - jugadorA.x, npc.y - jugadorA.y);
    pasos++;
    if (portalRecibidoA) break;
  }
  regionA.send("input", { x: 0, y: 0 });

  let comenzarYaMandado = false;
  const t0Agro = Date.now();
  while (!portalRecibidoA && Date.now() - t0Agro < 20000) {
    await esperar(200);
    if (!comenzarYaMandado && regionA.state.combates.size > 0) {
      const [combateIdAgro] = [...regionA.state.combates.keys()];
      comenzarYaMandado = true;
      regionA.send("combate:comenzarYa", { combateId: combateIdAgro });
    }
  }
  if (!portalRecibidoA || portalRecibidoA.tipo !== "combate") {
    throw new Error(`FALLO: la patrulla no atacó a A por distancia — portal:ir=${JSON.stringify(portalRecibidoA)}`);
  }

  const arenaA = await clientA.joinOrCreate("arena", { name: "Jugador-A", combateId: portalRecibidoA.combateId });
  await esperar(300);
  let errorCombate = null;
  arenaA.onMessage("combate:error", (m) => { errorCombate = m; });

  let rondas = 0;
  let resuelto = false;
  while (rondas < 400) {
    rondas++;
    const combate = arenaA.state.combates.get(portalRecibidoA.combateId);
    if (!combate) { resuelto = true; break; }
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== arenaA.sessionId) { await esperar(150); continue; }
    const propia = combate.unidades.get(arenaA.sessionId);
    if (!propia || propia.estado !== "activo") { await esperar(150); continue; }
    let objetivo = null, mejorDist = Infinity;
    for (const u of combate.unidades.values()) {
      if (u.bando === propia.bando || u.estado !== "activo") continue;
      const d = Math.hypot(u.gx - propia.gx, u.gy - propia.gy);
      if (d < mejorDist) { mejorDist = d; objetivo = u; }
    }
    if (!objetivo) { await esperar(150); continue; }
    errorCombate = null;
    arenaA.send("combate:accion", { combateId: portalRecibidoA.combateId, objetivoId: objetivo.id });
    await esperar(150);
    if (errorCombate?.motivo === "fuera de alcance") {
      const dx = Math.sign(objetivo.gx - propia.gx);
      const dy = Math.sign(objetivo.gy - propia.gy);
      arenaA.send("combate:mover", { combateId: portalRecibidoA.combateId, gx: propia.gx + dx, gy: propia.gy + dy });
      await esperar(150);
    }
    const propiaActual = arenaA.state.combates.get(portalRecibidoA.combateId)?.unidades.get(arenaA.sessionId);
    if (!propiaActual || propiaActual.pa <= 0 || errorCombate?.motivo === "sin PA suficiente") {
      arenaA.send("combate:pasarTurno", { combateId: portalRecibidoA.combateId });
      await esperar(150);
    }
  }
  if (!resuelto) throw new Error(`FALLO: el combate de A no se resolvió en ${rondas} rondas`);
  await esperar(1000); // aplicarResultadoRemoto (BD + cadáver) es fire-and-forget en la room de origen — B necesita el patch
  try { await arenaA.leave(); } catch {}
  console.log(`   OK: A resolvió el combate en ${rondas} ronda(s) (B no ha hecho NADA en todo este paso)`);

  // Al menos LA tropa que peleó (objetivoId) tiene que haber muerto — el
  // resto del grupo puede haberse unido o no según dónde cayera cada una
  // exactamente en ese instante (auto-unión por RADIO_INTERACCION, docs/
  // GDD_Faccion_Bandidos.md §7ter); lo que importa aquí es que ESA
  // desapareció para B también, sin que B hiciera nada.
  const hostilesTrasMuerte = hostilesDe(regionB.state);
  if (hostilesTrasMuerte.some(([id]) => id === objetivoId)) {
    throw new Error(`FALLO: B sigue viendo la tropa muerta (${objetivoId}) — el estado no llegó replicado a B`);
  }
  if (hostilesTrasMuerte.length >= hostA.length) {
    throw new Error(`FALLO: ninguna tropa desapareció para B (seguía viendo ${hostilesTrasMuerte.length} de ${hostA.length})`);
  }
  const cadaveresB = [...regionB.state.cadaveres.values()];
  if (cadaveresB.length < 1) throw new Error("FALLO: B no ve ningún cadáver tras la muerte real (debería, es la MISMA room)");
  console.log(`   [debug] hostiles antes=${hostA.length}, después=${hostilesTrasMuerte.length}, cadáveres=${cadaveresB.length}`);
  console.log(`   OK: B (que no hizo nada) ve desaparecer justo a la tropa muerta y aparecer el cadáver — mismo Schema replicado a los dos jugadores`);

  await regionA.leave();
  await regionB.leave();
  console.log("\n=== E2E dos jugadores + patrulla bandida: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E dos jugadores + patrulla bandida: FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
