// E2E de la patrulla bandida (docs/GDD_Faccion_Bandidos.md §7ter, pedido
// 2026-08-30: "podemos hacer que simplemente patrullen varios ciudadanos...
// el movimiento por mapa exterior será por caminos ida y vuelta... al estar
// a x distancia el jugador entra en modo combate... y como el animal, muere
// deja un sprite de cadáver y tiene loot"). Contra el juego REAL: banquea un
// asentamiento_hostil pequeño, entra a su RegionRoom (NO al cuartel — la
// patrulla vive en el mapa exterior) y comprueba:
//   1. Los reclutas vivos salen como `Npc` `hostil:true` (RegionRoom.
//      poblarPatrullaBandida) — nada de spawns fijos: SE MUEVEN de verdad
//      sobre el camino puerta<->plaza ya bakeado (ciudades/, "nunca A* en
//      directo").
//   2. Agro por distancia real (verificarAgroFauna extendido a Npc hostil,
//      mismo mecanismo que la fauna peligrosa/orca-tiburón): el jugador NO
//      manda combate:iniciar, la patrulla ataca sola por estar cerca.
//   3. Pelea de verdad (mismo motor de arena instanciada) — matar la tropa
//      la marca "muerto" PERMANENTE en BD, deja un cadáver looteable, y (al
//      ser la última tropa viva) dispara la conquista real.
//   4. Reentrar a la región tras la conquista YA NO puebla ninguna patrulla.
//   node server/test/faccionBandidosPatrulla.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_patrulla_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_patrulla_e2e.sqlite");
const PUERTO = 2601;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-patrulla-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);
if (!Array.isArray(indice.caminos) || indice.caminos.length === 0) throw new Error("el bake de prueba no trae ningún camino puerta<->plaza — no debería pasar en asentamiento_hostil");

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

function patrullaMasCercana(state, jugador) {
  let mejorId = null, mejorDist = Infinity;
  for (const [id, n] of state.npcs.entries()) {
    if (!n.hostil) continue;
    const d = Math.hypot(n.x - jugador.x, n.y - jugador.y);
    if (d < mejorDist) { mejorDist = d; mejorId = id; }
  }
  return { id: mejorId, dist: mejorDist };
}

let fallo = null;
try {
  console.log("2) arrancando servidor con BD temporal (tick de economía apagado de sobra, TICK_ECONOMIA_MS grande)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) primera entrada (siembra el asentamiento+guarnición inicial de 7 tropas, 4 reclutas de patrulla)...");
  const region0 = await client.joinOrCreate("region", { name: "E2E-seed", mapaId });
  await esperar(500);

  const bd = new DatabaseSync(rutaBd);
  const tropasIniciales = bd.prepare("SELECT id, rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasIniciales.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada en BD (${tropasIniciales.length} tropas, se esperaban 7)`);
  const reclutas = tropasIniciales.filter((t) => t.rango === "recluta");
  if (reclutas.length !== 4) throw new Error(`FALLO: se esperaban 4 reclutas iniciales, hay ${reclutas.length}`);

  // Se recorta a propósito a 1 SOLO recluta vivo (y ninguna otra tropa) —
  // mismo motivo que faccionBandidosCuartel.e2e.mjs: un combate real contra
  // un grupo entero (o contra guardia/líder, mucho más duros) haría perder
  // al jugador de prueba casi siempre, sin decir nada del enganche
  // BD<->combate en sí. Se deja vivo justo el ÚLTIMO recluta para que
  // matarlo, al ser también la ÚLTIMA tropa viva de todo el asentamiento,
  // dispare TAMBIÉN la conquista real.
  const unicoVivo = reclutas[0];
  const resto = tropasIniciales.filter((t) => t.id !== unicoVivo.id);
  for (const t of resto) bd.prepare("UPDATE tropas_asentamiento SET estado = 'muerto' WHERE id = ?").run(t.id);
  console.log(`   guarnición recortada a 1 recluta vivo de prueba (id=${unicoVivo.id}) — el resto marcado 'muerto' directo en BD`);

  await region0.leave();
  await esperar(3000); // margen de sobra para que Colyseus auto-disponga la room vacía (recordar la composición vieja)

  // La patrulla camina entre la puerta y la plaza/focal (indice.caminos[0],
  // mismo dato que RegionRoom lee) — el mapa de la región puede ser grande y
  // el spawn por defecto del bake puede caer lejos de esa ruta, así que el
  // jugador de prueba entra DIRECTAMENTE junto a la plaza (entradaX/Y, ya
  // soportado por RegionRoom.onJoin) en vez de depender de una caminata a
  // ciegas por un mapa con muralla/edificios de por medio.
  const plaza = indice.caminos[0][indice.caminos[0].length - 1];

  console.log("4) reentrando a la región (room nueva, entrando junto a la plaza) — ahora solo debe patrullar 1 recluta...");
  const region = await client.joinOrCreate("region", { name: "E2E", mapaId, entradaX: plaza[0], entradaY: plaza[1] });
  await esperar(500);
  const hostiles = [...region.state.npcs.values()].filter((n) => n.hostil);
  if (hostiles.length !== 1) throw new Error(`FALLO: la región pobló ${hostiles.length} Npc(s) hostil(es), se esperaba 1 (el recluta que dejamos vivo)`);
  console.log(`   OK: 1 recluta vivo en BD = 1 Npc hostil patrullando (sin cupo aleatorio)`);

  console.log("5) comprobando que la patrulla SE MUEVE de verdad (camino bakeado, nada de spawn fijo)...");
  const posicionInicial = { x: hostiles[0].x, y: hostiles[0].y };
  await esperar(9000); // PAUSA_PARADA_SEG=7s en la parada + margen para que avance
  const jugador = region.state.players.get(region.sessionId);
  const { id: objetivoId, dist: distInicial } = patrullaMasCercana(region.state, jugador);
  const npcAhora = region.state.npcs.get(objetivoId);
  const distanciaRecorrida = Math.hypot(npcAhora.x - posicionInicial.x, npcAhora.y - posicionInicial.y);
  if (distanciaRecorrida < 0.5) throw new Error(`FALLO: la patrulla no se movió (recorrido=${distanciaRecorrida.toFixed(2)} casillas tras 9s) — ¿se quedó como un spawn fijo?`);
  console.log(`   OK: la patrulla recorrió ${distanciaRecorrida.toFixed(2)} casilla(s) sola, sin que nadie la tocara`);

  console.log("6) acercándose a pie hasta el radio de agro (RADIO_AGRO_DEFECTO=5) y esperando a que ataque ELLA sola...");
  let portalRecibido = null;
  region.onMessage("portal:ir", (info) => { portalRecibido = info; });
  let dist = distInicial;
  let pasos = 0;
  while (dist > 4 && pasos < 200) {
    const npc = region.state.npcs.get(objetivoId);
    if (!npc) break; // se movió de sitio entre lecturas, no pasa nada, el bucle de abajo ya comprueba portalRecibido
    region.send("input", { x: Math.sign(npc.x - jugador.x), y: Math.sign(npc.y - jugador.y) });
    await esperar(150);
    dist = Math.hypot(npc.x - jugador.x, npc.y - jugador.y);
    pasos++;
    if (portalRecibido) break;
  }
  region.send("input", { x: 0, y: 0 });

  // La patrulla abre la ventana de unión ella sola (bien) pero esa ventana
  // dura VENTANA_UNION_COMBATE_MS=60s de verdad — mismo atajo que ya usa
  // agroFauna.e2e.mjs: combate:comenzarYa la cierra ya, sin esperar el
  // minuto entero solo para confirmar que se abrió.
  const t0Agro = Date.now();
  let comenzarYaMandado = false;
  while (!portalRecibido && Date.now() - t0Agro < 20000) {
    await esperar(200);
    if (!comenzarYaMandado && region.state.combates.size > 0) {
      const [combateIdAgro] = [...region.state.combates.keys()];
      comenzarYaMandado = true;
      region.send("combate:comenzarYa", { combateId: combateIdAgro });
    }
  }
  if (!portalRecibido || portalRecibido.tipo !== "combate") {
    throw new Error(`FALLO: la patrulla no atacó por distancia sin que el jugador mandara combate:iniciar — portal:ir=${JSON.stringify(portalRecibido)}`);
  }
  console.log(`   OK: la patrulla disparó combate ELLA SOLA (agro por distancia, mismo mecanismo que la fauna peligrosa)`);

  console.log("7) uniéndose a la arena de verdad y peleando hasta resolver...");
  const arena = await client.joinOrCreate("arena", { name: "E2E", combateId: portalRecibido.combateId });
  await esperar(300);
  let errorCombate = null;
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
  await esperar(800); // aplicarResultadoRemoto (BD + cadáver) es fire-and-forget en la room de origen
  console.log(`   OK: combate resuelto en ${rondas} ronda(s)`);
  try { await arena.leave(); } catch {}

  const filaTropa = bd.prepare("SELECT estado FROM tropas_asentamiento WHERE id = ?").get(unicoVivo.id);
  if (filaTropa.estado !== "muerto") throw new Error(`FALLO: el recluta no quedó 'muerto' en BD tras el combate (sigue "${filaTropa.estado}")`);
  console.log(`   OK: el recluta quedó permanentemente muerto en BD tras el combate real`);

  const filaAsentamiento = bd.prepare("SELECT bando FROM asentamientos WHERE id = ?").get(mapaId);
  if (filaAsentamiento.bando !== "neutral") throw new Error(`FALLO: la conquista no se disparó al morir la última tropa viva (bando sigue "${filaAsentamiento.bando}")`);
  console.log(`   OK: última tropa muerta -> asentamiento conquistado de verdad (bando=neutral)`);

  const cadaveres = [...region.state.cadaveres.values()];
  if (cadaveres.length < 1 || !cadaveres.every((c) => c.tipoOrigen === "npc")) {
    throw new Error(`FALLO: no se creó cadáver de tipo npc para el recluta muerto: ${JSON.stringify(cadaveres.map((c) => ({ tipoOrigen: c.tipoOrigen })))}`);
  }
  const conLoot = cadaveres.some((c) => c.contenedor.items.length > 0);
  if (!conLoot) throw new Error("FALLO: el cadáver del recluta no lleva ningún material de loot");
  console.log(`   OK: ${cadaveres.length} cadáver(es) de patrulla creado(s) (tipoOrigen="npc"), con loot real — igual que un animal muerto`);

  await region.leave();
  await esperar(3000);

  console.log("8) reentrando a la región tras la conquista — ya NO debe patrullar nadie...");
  const region2 = await client.joinOrCreate("region", { name: "E2E-2", mapaId });
  await esperar(500);
  const hostilesTrasConquista = [...region2.state.npcs.values()].filter((n) => n.hostil);
  if (hostilesTrasConquista.length !== 0) {
    throw new Error(`FALLO: tras la conquista sigue habiendo ${hostilesTrasConquista.length} Npc(s) hostil(es) patrullando (el asentamiento ya no es bandido)`);
  }
  console.log(`   OK: la región reentrada ya no puebla ninguna patrulla — la conquista es real y permanente`);

  await region2.leave();
  bd.close();
  console.log("\n=== E2E patrulla bandida (economía real): TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E patrulla bandida (economía real): FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
