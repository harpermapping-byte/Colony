// E2E del cuartel de un asentamiento bandido (docs/GDD_Faccion_Bandidos.md
// §7bis, pedido 2026-08-30: "las aldeas/ciudades aunque sean dungeons van
// por separado — las dungeons se recargan cada hora, estas no, tienen
// vida/economía propia"). Contra el juego REAL: banquea un asentamiento_
// hostil pequeño (ciudades/ SIEMPRE incluye un edificio "campamento_hostil"
// obligatorio, ciudades/catalogo/asentamientos.json), entra a su cuartel
// (InteriorRoom normal — NO DungeonRoom: un asentamiento_hostil bakeado vía
// ciudades/ nunca marca sus puertas `esMazmorra:true`, ver
// baker/src/instanciasPOI.js), pelea de verdad contra la guarnición (mismo
// motor de combate interactivo que combate.e2e.mjs) y comprueba:
//   1. El cuartel puebla exactamente 1 Enemigo por tropa VIVA de
//      tropas_asentamiento (BD) — no un cupo aleatorio como una mazmorra normal.
//   2. Matar una tropa de verdad la marca "muerto" PERMANENTE en BD (nunca
//      "vivo" de nuevo) y deja un cadáver looteable con material real.
//   3. Volver a entrar al MISMO cuartel (room nueva, la anterior se
//      auto-dispone al vaciarse) NO repuebla al azar tras 1h de cooldown —
//      sigue reflejando exactamente las tropas que quedan vivas en BD.
//   node server/test/faccionBandidosCuartel.e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const mapaId = "bandidos_cuartel_test";
const rutaMapa = join(raiz, "assets", "mapas", mapaId);
const rutaBd = join(dirServidor, "test", "faccion_cuartel_e2e.sqlite");
const PUERTO = 2599;

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) baking un asentamiento_hostil pequeño de prueba...");
execFileSync("node", ["ciudades/src/index.js", "asentamiento_hostil", "e2e-cuartel-1", rutaMapa], { cwd: raiz, stdio: "inherit" });
const indice = JSON.parse(readFileSync(join(rutaMapa, "indice.json"), "utf8"));
if (indice.tier !== "asentamiento_hostil") throw new Error(`bake de prueba con tier inesperado: ${indice.tier}`);
const portalCuartel = (indice.portales || []).find((p) => p.tipo === "interior" && p.tipoEdificioId === "campamento_hostil");
if (!portalCuartel) throw new Error("el bake de prueba no trae ningún campamento_hostil (debería ser obligatorio en este tier)");
const edificio = portalCuartel.edificio;
console.log(`   cuartel encontrado: edificio="${edificio}"`);

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
  console.log("2) arrancando servidor con BD temporal (tick de economía apagado de sobra, TICK_ECONOMIA_MS grande)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, TICK_ECONOMIA_MS: "999999999" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) uniéndose a la región (siembra el asentamiento+guarnición inicial de 7 tropas)...");
  const region = await client.joinOrCreate("region", { name: "E2E", mapaId });
  await esperar(500);

  const bd = new DatabaseSync(rutaBd);
  const tropasIniciales = bd.prepare("SELECT id, rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?").all(mapaId);
  if (tropasIniciales.length !== 7) throw new Error(`FALLO: guarnición inicial inesperada en BD (${tropasIniciales.length} tropas, se esperaban 7)`);
  // Se recorta a propósito a 1 SOLA tropa viva: GUARNICION_INICIAL trae 7,
  // y un 1vs7 real en una sala de 17x17 (con ventana de unión real — todo
  // hostil que quede cerca se suma) haría perder al jugador de prueba casi
  // siempre, sin que eso diga nada sobre si el enganche BD<->combate
  // funciona. Se deja viva justo la de menor rango ("recluta": vida 25,
  // ataque 5, defensa 1 — un "lider" con defensa 7 deja el daño del jugador
  // de prueba (ataque base 3) en el suelo de 1 de calcularDanio, un combate
  // literalmente imposible de ganar) para que matarla, al ser también la
  // ÚLTIMA viva, dispare TAMBIÉN la conquista real
  // (marcarTropaMuertaYVerificarConquista) en el mismo paso.
  const unicaViva = tropasIniciales.find((t) => t.rango === "recluta") ?? tropasIniciales[0];
  const resto = tropasIniciales.filter((t) => t.id !== unicaViva.id);
  for (const t of resto) bd.prepare("UPDATE tropas_asentamiento SET estado = 'muerto' WHERE id = ?").run(t.id);
  console.log(`   guarnición recortada a 1 tropa viva de prueba (${unicaViva.rango}, id=${unicaViva.id}) — el resto marcado 'muerto' directo en BD`);

  console.log("   uniéndose al cuartel (InteriorRoom — se autopuebla desde tropas_asentamiento)...");
  const cuartel = await client.joinOrCreate("interior", { name: "E2E", mapaId, edificio, nivel: 0 });
  await esperar(500);
  if (cuartel.state.enemigos.size !== 1) {
    throw new Error(`FALLO: el cuartel bandido no pobló 1 Enemigo por tropa viva (state.enemigos.size=${cuartel.state.enemigos.size}, se esperaba 1 — nada de cupo aleatorio)`);
  }
  console.log(`   OK: 1 tropa viva en BD = 1 Enemigo en el cuartel (sin cooldown ni azar)`);

  console.log("4) acercándose a la tropa viva más cercana (candidatas dispersas por sala_comun/dormitorio_comunal/celda) y atacando de verdad...");
  const RADIO_INTERACCION = 2.2;
  const jugador = cuartel.state.players.get(cuartel.sessionId);
  function tropaMasCercana() {
    let mejorId = null, mejorDist = Infinity;
    for (const [id, e] of cuartel.state.enemigos.entries()) {
      const d = Math.hypot(e.x - jugador.x, e.y - jugador.y);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    return { id: mejorId, dist: mejorDist };
  }
  let { id: objetivoId, dist } = tropaMasCercana();
  let pasos = 0;
  while (dist > 1.5 && pasos < 80) {
    const enemigo = cuartel.state.enemigos.get(objetivoId);
    cuartel.send("input", { x: Math.sign(enemigo.x - jugador.x), y: Math.sign(enemigo.y - jugador.y) });
    await esperar(150);
    ({ id: objetivoId, dist } = tropaMasCercana());
    pasos++;
  }
  cuartel.send("input", { x: 0, y: 0 });
  await esperar(150);
  if (dist > RADIO_INTERACCION) throw new Error(`FALLO: no se pudo acercar a ninguna tropa viva a rango de combate (dist=${dist.toFixed(2)} tras ${pasos} paso(s))`);
  console.log(`   OK: en rango de combate con "${objetivoId}" (dist=${dist.toFixed(2)}) tras ${pasos} paso(s) de movimiento`);

  // El combate de verdad NO se resuelve en esta room (InteriorRoom): al
  // cerrar la ventana de unión, cerrarVentanaCombate() BORRA el CombateSchema
  // de aquí (state.combates.delete) y manda a cada jugador implicado un
  // "portal:ir {tipo:'combate', combateId, mapaArenaId}" — hay que unirse a
  // una room "arena" (ArenaCombateRoom, filterBy combateId) aparte para
  // pelear de verdad; el resultado vuelve solo a esta room al terminar
  // (aplicarResultadoRemoto -> finalizarMuerte), docs/GDD_Combate.md §9.2.
  let portalRecibido = null;
  cuartel.onMessage("portal:ir", (info) => { portalRecibido = info; });
  let errorCombate = null;
  cuartel.onMessage("combate:error", (m) => { errorCombate = m; });
  cuartel.send("combate:iniciar", { objetivoId });
  await esperar(400);
  if (errorCombate) throw new Error(`FALLO: combate:iniciar rechazado: ${JSON.stringify(errorCombate)}`);
  const combatesPendientes = [...cuartel.state.combates.entries()];
  if (combatesPendientes.length === 0) throw new Error("FALLO: no se creó ningún CombateSchema tras combate:iniciar");
  const combateId = combatesPendientes[0][0];
  // La ventana de unión real dura 60s (VENTANA_UNION_COMBATE_MS, docs/GDD_Combate.md
  // §9.1) — de sobra para dejar que se sume gente cerca, pero aquí no hay
  // nadie más que sumar: se salta con el mismo atajo que agroFauna.e2e.mjs.
  cuartel.send("combate:comenzarYa", { combateId });

  const t0PortalCombate = Date.now();
  while (!portalRecibido && Date.now() - t0PortalCombate < 5000) await esperar(100);
  if (!portalRecibido || portalRecibido.tipo !== "combate") {
    throw new Error(`FALLO: no llegó portal:ir tipo combate tras comenzarYa: ${JSON.stringify(portalRecibido)}`);
  }
  console.log(`   OK: arena asignada (mapaArenaId=${portalRecibido.mapaArenaId}) — uniéndose de verdad a pelear...`);

  const arena = await client.joinOrCreate("arena", { name: "E2E", combateId: portalRecibido.combateId });
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
    // objetivo: cualquier unidad viva del bando contrario más cercana
    let objetivo = null, mejorDist = Infinity;
    for (const u of combate.unidades.values()) {
      if (u.bando === propia.bando || u.estado !== "activo") continue;
      const d = Math.hypot(u.gx - propia.gx, u.gy - propia.gy);
      if (d < mejorDist) { mejorDist = d; objetivo = u; }
    }
    if (!objetivo) { await esperar(150); continue; } // todo el bando contrario caído, esperando que el servidor cierre el combate
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

  const filaUnicaViva = bd.prepare("SELECT estado FROM tropas_asentamiento WHERE id = ?").get(unicaViva.id);
  if (filaUnicaViva.estado !== "muerto") throw new Error(`FALLO: la única tropa viva no quedó 'muerto' en BD tras el combate (sigue "${filaUnicaViva.estado}") — marcarTropaMuertaYVerificarConquista no se disparó`);
  console.log(`   OK: la tropa quedó permanentemente muerta en BD tras el combate real`);

  // Era la ÚLTIMA tropa viva del asentamiento -> tiene que disparar la
  // conquista real (docs/GDD_Faccion_Bandidos.md §7): bando pasa a "neutral".
  const filaAsentamiento = bd.prepare("SELECT bando FROM asentamientos WHERE id = ?").get(mapaId);
  if (filaAsentamiento.bando !== "neutral") throw new Error(`FALLO: la conquista no se disparó al morir la última tropa viva (bando sigue "${filaAsentamiento.bando}")`);
  console.log(`   OK: última tropa muerta -> asentamiento conquistado de verdad (bando=neutral)`);

  // El cadáver de una tropa NO se persiste en BD (mismo criterio "sin
  // completo/sin persistencia de sobra" que otros objetos efímeros del
  // mundo) — solo vive en el Schema de ESTA room mientras exista, así que
  // se comprueba AQUÍ, antes de salir (documentado en docs/GDD_Faccion_Bandidos.md §7bis).
  const cadaveres = [...cuartel.state.cadaveres.values()];
  if (cadaveres.length < 1 || !cadaveres.every((c) => c.tipoOrigen === "npc")) {
    throw new Error(`FALLO: no se creó cadáver de tipo npc para la(s) tropa(s) muerta(s): ${JSON.stringify(cadaveres.map((c) => ({ tipoOrigen: c.tipoOrigen })))}`);
  }
  const conLoot = cadaveres.some((c) => c.contenedor.items.length > 0);
  if (!conLoot) throw new Error("FALLO: el cadáver de la tropa no lleva ningún material de loot");
  console.log(`   OK: ${cadaveres.length} cadáver(es) de tropa bandida creado(s) (tipoOrigen="npc"), con loot real`);

  await cuartel.leave();
  await region.leave();
  await esperar(3000); // margen de sobra para que Colyseus auto-disponga las rooms vacías

  console.log("5) volviendo a entrar al MISMO cuartel (room nueva) — conquistado, ya NO debe poblar guarnición ninguna...");
  const region2 = await client.joinOrCreate("region", { name: "E2E-2", mapaId });
  await esperar(300);
  const cuartel2 = await client.joinOrCreate("interior", { name: "E2E-2", mapaId, edificio, nivel: 0 });
  await esperar(500);
  if (cuartel2.state.enemigos.size !== 0) {
    throw new Error(`FALLO: al reentrar tras la conquista, state.enemigos.size=${cuartel2.state.enemigos.size}, se esperaba 0 (el asentamiento ya no es bandido — sin cooldown ni azar de mazmorra normal de por medio)`);
  }
  console.log(`   OK: el cuartel reentrado ya NO puebla guarnición — la conquista es real y permanente, sin cooldown ni repoblación al azar`);

  await cuartel2.leave();
  await region2.leave();
  bd.close();
  console.log("\n=== E2E cuartel bandido (economía real): TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E cuartel bandido (economía real): FALLO ===\n", err);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
process.exit(fallo ? 1 : 0);
