// E2E de la crónica bandida (docs/GDD_Faccion_Bandidos.md §7quinquies,
// pedido 2026-08-30: "que la historia del servidor, nombres de jugadores y
// hazañas se recuerden"). Contra el juego REAL (servidor sin claves de IA
// configuradas — igual que cualquier entorno de CI/dev sin GEMINI_API_KEY/
// GROQ_API_KEY): mata una tropa de verdad con un jugador con NOMBRE real y
// comprueba que:
//   1. Queda un evento "tropa_muerta" en memoria_lider, atribuido a ESE
//      jugador y a ESE asentamiento (no solo texto libre — columnas
//      estructuradas que se pueden consultar).
//   2. Al ser también la ÚLTIMA tropa viva, queda ADEMÁS un evento
//      "asentamiento_conquistado" atribuido al mismo jugador, con el texto
//      de siempre (sin IA configurada, el fallback determinista).
//   3. El bandido vivo, antes de morir, sigue con `grito=""` (silencio) —
//      sin IA configurada nunca finge personalidad.
//   node server/test/faccionBandidosCronica.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_cronica_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_cronica_e2e.sqlite");
const PUERTO = 2605;
const NOMBRE_JUGADOR = "CronistaTest";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY; // este E2E prueba a propósito el camino SIN IA configurada

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-cronica-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);

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

let fallo = null;
try {
  console.log("2) arrancando servidor SIN claves de IA (mismo entorno que cualquier CI/dev)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999",
    GEMINI_API_KEY: "", GROQ_API_KEY: "",
  });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) primera entrada (siembra el asentamiento + guarnición inicial de 7 tropas)...");
  const region0 = await client.joinOrCreate("region", { name: NOMBRE_JUGADOR, mapaId });
  await esperar(500);

  const bd = new DatabaseSync(rutaBd);
  const tropasIniciales = bd.prepare("SELECT id, rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasIniciales.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada (${tropasIniciales.length} tropas, se esperaban 7)`);
  const reclutas = tropasIniciales.filter((t) => t.rango === "recluta");

  // Se recorta a 1 SOLO recluta vivo (mismo motivo de ganabilidad que
  // faccionBandidosPatrulla.e2e.mjs) — al ser también la ÚLTIMA tropa viva,
  // matarlo dispara TAMBIÉN la conquista, así se comprueban los dos tipos
  // de evento ("tropa_muerta" y "asentamiento_conquistado") en un solo paso.
  const unicoVivo = reclutas[0];
  const resto = tropasIniciales.filter((t) => t.id !== unicoVivo.id);
  for (const t of resto) bd.prepare("UPDATE tropas_asentamiento SET estado = 'muerto' WHERE id = ?").run(t.id);

  await region0.leave();
  await esperar(3000); // margen de sobra para que Colyseus auto-disponga la room vacía

  console.log("4) reentrando a la región (room nueva) — solo debe quedar 1 recluta patrullando...");
  const region = await client.joinOrCreate("region", { name: NOMBRE_JUGADOR, mapaId });
  await esperar(500);
  const hostiles = [...region.state.npcs.entries()].filter(([, n]) => n.hostil);
  if (hostiles.length !== 1) throw new Error(`FALLO: se esperaba 1 Npc hostil, hay ${hostiles.length}`);
  const [objetivoId, objetivoNpc] = hostiles[0];

  console.log("5) esperando el barrido de diálogo (~1s) ANTES de matarlo — sin IA configurada debe quedar en silencio...");
  const jugador = region.state.players.get(region.sessionId);
  // Se acerca lo bastante para que verificarDialogoBandidos lo detecte
  // dentro de RADIO_INTERACCION (mismo radio que el resto de interacciones).
  let dist = Math.hypot(objetivoNpc.x - jugador.x, objetivoNpc.y - jugador.y);
  let pasos = 0;
  while (dist > 1.5 && pasos < 200) {
    const npc = region.state.npcs.get(objetivoId);
    if (!npc) break;
    region.send("input", { x: Math.sign(npc.x - jugador.x), y: Math.sign(npc.y - jugador.y) });
    await esperar(150);
    dist = Math.hypot(npc.x - jugador.x, npc.y - jugador.y);
    pasos++;
  }
  region.send("input", { x: 0, y: 0 });
  await esperar(1500); // el barrido de diálogo corre cada 1s
  const npcAntesDeMorir = region.state.npcs.get(objetivoId);
  if (!npcAntesDeMorir) throw new Error("FALLO: el bandido desapareció antes de poder comprobar su grito");
  if (npcAntesDeMorir.grito !== "") {
    throw new Error(`FALLO: sin IA configurada, el grito debería quedar en silencio ("") — llegó "${npcAntesDeMorir.grito}"`);
  }
  console.log(`   OK: sin IA configurada, el bandido se queda en silencio (grito="") — nunca finge personalidad sin IA de verdad`);

  console.log("6) matándolo de verdad (combate real vía arena instanciada)...");
  let portalRecibido = null;
  region.onMessage("portal:ir", (info) => { portalRecibido = info; });
  let errorCombate = null;
  region.onMessage("combate:error", (m) => { errorCombate = m; });
  // Al estar tan cerca para comprobar el grito (paso 5), el agro por
  // distancia (RADIO_AGRO_DEFECTO=5) puede haber abierto YA un combate
  // "pendiente" él solo — reusarlo en vez de mandar combate:iniciar (que el
  // servidor rechazaría con "ya estás en combate").
  let combatesPendientes = [...region.state.combates.entries()];
  if (combatesPendientes.length === 0) {
    region.send("combate:iniciar", { objetivoId });
    await esperar(400);
    if (errorCombate) throw new Error(`FALLO: combate:iniciar rechazado: ${JSON.stringify(errorCombate)}`);
    combatesPendientes = [...region.state.combates.entries()];
  }
  if (combatesPendientes.length === 0) throw new Error("FALLO: no se creó ningún CombateSchema (ni por agro ni por combate:iniciar)");
  const combateId = combatesPendientes[0][0];
  region.send("combate:comenzarYa", { combateId });

  const t0Portal = Date.now();
  while (!portalRecibido && Date.now() - t0Portal < 5000) await esperar(100);
  if (!portalRecibido || portalRecibido.tipo !== "combate") {
    throw new Error(`FALLO: no llegó portal:ir tipo combate: ${JSON.stringify(portalRecibido)}`);
  }

  const arena = await client.joinOrCreate("arena", { name: NOMBRE_JUGADOR, combateId: portalRecibido.combateId });
  await esperar(300);
  arena.onMessage("combate:error", (m) => { errorCombate = m; });

  let rondas = 0;
  let resuelto = false;
  while (rondas < 400) {
    rondas++;
    const combate = arena.state.combates.get(portalRecibido.combateId);
    if (!combate) { resuelto = true; break; }
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== arena.sessionId) { await esperar(150); continue; }
    const propia = combate.unidades.get(arena.sessionId);
    if (!propia || propia.estado !== "activo") { await esperar(150); continue; }
    let objetivo = null, mejorDist = Infinity;
    for (const u of combate.unidades.values()) {
      if (u.bando === propia.bando || u.estado !== "activo") continue;
      const d = Math.hypot(u.gx - propia.gx, u.gy - propia.gy);
      if (d < mejorDist) { mejorDist = d; objetivo = u; }
    }
    if (!objetivo) { await esperar(150); continue; }
    errorCombate = null;
    arena.send("combate:accion", { combateId: portalRecibido.combateId, objetivoId: objetivo.id });
    await esperar(150);
    if (errorCombate?.motivo === "fuera de alcance") {
      const dx = Math.sign(objetivo.gx - propia.gx);
      const dy = Math.sign(objetivo.gy - propia.gy);
      arena.send("combate:mover", { combateId: portalRecibido.combateId, gx: propia.gx + dx, gy: propia.gy + dy });
      await esperar(150);
    }
    const propiaActual = arena.state.combates.get(portalRecibido.combateId)?.unidades.get(arena.sessionId);
    if (!propiaActual || propiaActual.pa <= 0 || errorCombate?.motivo === "sin PA suficiente") {
      arena.send("combate:pasarTurno", { combateId: portalRecibido.combateId });
      await esperar(150);
    }
  }
  if (!resuelto) throw new Error(`FALLO: el combate no se resolvió en ${rondas} rondas`);
  await esperar(800); // aplicarResultadoRemoto (BD) es fire-and-forget en la room de origen
  try { await arena.leave(); } catch {}
  console.log(`   OK: combate resuelto en ${rondas} ronda(s)`);

  console.log("7) comprobando la crónica en BD...");
  const eventos = bd.prepare(
    "SELECT tipo, asentamiento_id, jugador, evento FROM memoria_lider WHERE asentamiento_id = ? ORDER BY id ASC",
  ).all(mapaId);

  const muerte = eventos.find((e) => e.tipo === "tropa_muerta");
  if (!muerte) throw new Error(`FALLO: no hay ningún evento "tropa_muerta" en memoria_lider: ${JSON.stringify(eventos)}`);
  if (muerte.jugador !== NOMBRE_JUGADOR) throw new Error(`FALLO: el evento "tropa_muerta" está atribuido a "${muerte.jugador}", se esperaba "${NOMBRE_JUGADOR}"`);
  if (!muerte.evento.includes(NOMBRE_JUGADOR)) throw new Error(`FALLO: el texto del evento no menciona al jugador: "${muerte.evento}"`);
  console.log(`   OK: "tropa_muerta" atribuido a ${NOMBRE_JUGADOR} — evento: "${muerte.evento}"`);

  const conquista = eventos.find((e) => e.tipo === "asentamiento_conquistado");
  if (!conquista) throw new Error(`FALLO: no hay ningún evento "asentamiento_conquistado" en memoria_lider (era la última tropa viva): ${JSON.stringify(eventos)}`);
  if (conquista.jugador !== NOMBRE_JUGADOR) throw new Error(`FALLO: el evento "asentamiento_conquistado" está atribuido a "${conquista.jugador}", se esperaba "${NOMBRE_JUGADOR}"`);
  if (!/ha caído/.test(conquista.evento)) throw new Error(`FALLO: sin IA configurada se esperaba el texto de siempre ("...ha caído..."), llegó: "${conquista.evento}"`);
  console.log(`   OK: "asentamiento_conquistado" atribuido a ${NOMBRE_JUGADOR}, con el texto de siempre (sin IA configurada) — evento: "${conquista.evento}"`);

  await region.leave();
  bd.close();
  console.log("\n=== E2E crónica bandida (hazañas atribuidas): TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E crónica bandida (hazañas atribuidas): FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
