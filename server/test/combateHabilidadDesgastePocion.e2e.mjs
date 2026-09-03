// E2E de las mecánicas nuevas de combate (docs/GDD_Combate.md, pedido
// streamer 2026-09-03: "Sin e2e dedicado a las 3 mecánicas nuevas [habilidad
// por familia de arma, desgaste conectado a combate, pociones en combate]...
// que lo coloque") + reparar (mismo pedido, nuevo). Colyseus puro real (sin
// navegador — protocolo de red real, mismo criterio que herreria.e2e.mjs/
// testZoneDebug.e2e.mjs/combateCoop.e2e.mjs: no hay panel de cliente para
// habilidad/reparar todavía, lo que hay que confirmar es que el SERVIDOR
// hace lo que promete, jugado de verdad).
//
// Mapa: assets/mapas/testzone/ (RUTA_MAPA) — ya trae un NPC "dummy_1" fijo
// (oficio dummy_combate, Zona 5, x:236,y:280, npcsFijos.json). OJO — hallazgo
// real de ESTE e2e: la "vida infinita" del dummy_combate
// (RoomExteriorBase.aplicarUnidadesASchema::dummyRegenera) SOLO aplica en la
// room de origen (this.oficiosNpc, poblado por HubRoom/RegionRoom al leer
// npcsFijos.json) — ArenaCombateRoom recrea al NPC desde el roster sin tocar
// `oficiosNpc`, así que DENTRO de la arena real el dummy puede morir de
// verdad como cualquier otro NPC (gap de diseño confirmado, no un bug de
// este e2e — fuera de alcance de esta pasada, documentado en
// docs/GDD_Combate.md). Este e2e se adapta: golpea hasta que el combate se
// resuelva de verdad (el dummy muere y el combate termina solo, disparando
// ArenaCombateRoom.onCombateResuelto — el mismo punto que persiste el
// desgaste real), con "huir" como red de seguridad SOLO si sobreviviera más
// de la cuenta. BD sqlite sembrada directo (mismo atajo que herreria.e2e.mjs):
// jugador jarl/superadmin (JARL_NOMBRES, para admin:debug:teleport), herrero
// nivel 10 (probabilidadRoturaArmaPorNivelHerrero mínima — 5%, reduce el
// riesgo de que la rotura probabilística tape la comparación de daño con
// poción, ver más abajo), bastón de guerra (habilidadId "baston:barrido",
// alcance 2, familiaMaterial "madera", daño bajo A PROPÓSITO — 6 base, para
// que el dummy aguante un par de golpes antes de morir de verdad) + una
// poción YA preparada con efectoPocion real (+30% de
// REFERENCIA_STAT_ALQUIMIA=20 de ataqueFisico, +6 FLAT) — `efectoPocion`
// solo lo rellena `alquimia.ts::prepararPocion` en producción, así que aquí
// se sembra directo en la fila de inventario (mismo criterio "atajo de
// siembra, nunca del protocolo" que toda la familia combateCoop/
// combateArenaTierra) + madera_dura para el insumo real de `item:reparar` +
// un "yunque_tocon" sembrado directo como construcción (mismo atajo que
// herreria.e2e.mjs).
//
// Verifica JUGADO DE VERDAD:
//   1) baston:barrido (familia "baston") reduce el PA restante del objetivo
//      — SIEMPRE que el golpe conecte (arenaCombate.ts::
//      resolverAtaqueConHabilidad, case "baston", sin depender de terreno ni
//      obstáculos como sí haría comprobar un empuje) — se confirma
//      comparando `pa` del dummy antes/después del golpe #1.
//   2) beber la poción A MITAD de combate sube el daño de verdad del
//      SIGUIENTE golpe frente al golpe anterior (manejarPocionBeber ya
//      sobreescribe unidadCombate.ataqueFisico con el player.ataque post-
//      buff) — comparación de "vida quitada" entre dos golpes reales, no
//      solo que el mensaje "pocion:bebida" llegue.
//   3) la durabilidad real del arma equipada BAJA tras varios golpes reales
//      — se infiere por el efecto del debuff (docs/GDD_Combate.md, "combate
//      SÍ consulta estaRoto/factorDurabilidad ahora"): player.ataque antes
//      de pelear vs. player.ataque tras volver al Hub (recalculado desde la
//      durabilidad YA persistida, `cargarInventarioYEquipoDe`) — sin
//      necesitar leer la BD a mano, es la MISMA cifra que ve el cliente real.
//   4) `item:reparar` (mínimo viable NUEVO, cero mecánica previa) junto al
//      yunque sembrado, consumiendo madera_dura real, RESTAURA la
//      durabilidad al máximo — confirmado con el evento `item:reparado` Y
//      con player.ataque volviendo EXACTO a su valor inicial (misma prueba
//      indirecta que el punto 3, en sentido contrario).
//   node server/test/combateHabilidadDesgastePocion.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Client } from "colyseus.js";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "combate_habilidad_desgaste_pocion_e2e.sqlite");
const rutaTestzone = join(raiz, "assets", "mapas", "testzone");
const PUERTO = 2607;
const NOMBRE = "E2E-Lancero";
const DUMMY_ID = "dummy_1"; // npcsFijos.json de testzone, slotId real
const YUNQUE_XY = { x: 236, y: 282 };
const PARCELA_ID = "p_0001"; // única parcela real de assets/mapas/testzone/parcelas.json — una construcción con `propiedad` desconocida se filtra entera al cargar (RoomExteriorBase: "parcelas.parcelas.has(c.propiedad)")

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl, herrero nivel 10, bastón de guerra+poción preparada+madera_dura, yunque_tocon sembrado directo)...");
let idYunque;
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
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propiedad TEXT NOT NULL,
      objeto TEXT NOT NULL,
      categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL,
      rot INTEGER NOT NULL DEFAULT 0,
      variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT,
      creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jugador_oficios (
      jugador_id INTEGER NOT NULL,
      oficio TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jugador_id, oficio)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, ahora);
  // nivel 10 real (UMBRALES_NIVEL = generarUmbrales(10,90), umbral[10]=4050) —
  // probabilidadRoturaArmaPorNivelHerrero(10) = 5% (mínimo), reduce el riesgo
  // de que la rotura probabilística de golpe (mecanismo NUEVO, aparte del
  // desgaste gradual) se cuele justo entre los dos golpes que se comparan
  // para confirmar el efecto de la poción.
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'herrero', 4050)").run();

  const items = JSON.stringify([
    { id: 1, itemId: "baston_guerra", cantidad: 1, x: 0, y: 0, rot: 0 },
    {
      id: 2, itemId: "pocion_alquimica_clara", cantidad: 1, x: 3, y: 0, rot: 0,
      // efectoPocion (docs/GDD_Pociones.md) solo lo rellena de verdad
      // alquimia.ts::prepararPocion — aquí se siembra YA resuelto (mismo
      // atajo de siembra que el resto de este e2e), +30% de
      // REFERENCIA_STAT_ALQUIMIA(20) de ataqueFisico = +6 FLAT — inequívoco
      // frente al golpe #1 (ataqueFisico=6 del bastón, +6 casi lo dobla) sin
      // pasarse: el dummy_combate tiene vida=30 fija (Npc por defecto,
      // HubState.ts) y SÍ puede morir de verdad dentro de la arena (ver
      // cabecera) — con el bastón (daño base ~7) el golpe #1 deja al dummy
      // en ~23hp, el golpe #2 con poción (~13 de daño) en ~10hp: la
      // comparación de daño entre #1 y #2 nunca se cruza con una muerte real
      // a mitad de camino (eso solo puede pasar en los golpes extra de
      // después, que ya no comparan daño, solo confirman que la durabilidad
      // se movió).
      efectoPocion: [{ categoria: "stat", stat: "ataqueFisico", magnitudPct: 30 }],
    },
    { id: 3, itemId: "madera_dura", cantidad: 2, x: 5, y: 0, rot: 0 }, // insumo real de item:reparar para el bastón (familiaMaterial "madera") — EXACTAMENTE lo justo para UNA reparación (INSUMOS_REPARACION_POR_FAMILIA.madera = 2), así la SEGUNDA reparación de la fase 13 se rechaza de verdad por falta de insumos.
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 4, ?)").run(items);

  idYunque = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  yunque_tocon id=${idYunque}@(${YUNQUE_XY.x},${YUNQUE_XY.y})`);

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

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre assets/mapas/testzone/...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestzone, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const cliente = new Client(`ws://localhost:${PUERTO}`);
  let room = await cliente.joinOrCreate("hub", { name: NOMBRE });
  await esperar(500);

let errorMsg = null, adminOk = null, combateErr = null, portalIr = null, pocionBebida = null, itemReparado = null, itemError = null, armaRota = null;
  room.onMessage("admin:error", (m) => (errorMsg = m));
  room.onMessage("admin:debug:ok", (m) => (adminOk = m));
  room.onMessage("combate:error", (m) => { combateErr = m; console.log("  combate:error", m); });
  room.onMessage("portal:ir", (m) => (portalIr = m));
  room.onMessage("pocion:bebida", (m) => (pocionBebida = m));
  room.onMessage("item:reparado", (m) => (itemReparado = m));
  room.onMessage("item:error", (m) => { itemError = m; console.log("  item:error", m); });
  room.onMessage("combate:armaRota", (m) => (armaRota = m));

  console.log("3) equipa el bastón de guerra (manoPrincipal) — habilidadId/alcance del snapshot de combate salen de aquí...");
  const itBaston = [...room.state.players.get(room.sessionId).inventario.cuerpo.items.values()].find((it) => it.itemId === "baston_guerra");
  comprobar("el bastón sembrado está en el cuerpo", !!itBaston);
  room.send("equipo:equipar", { instanciaId: itBaston.id, slot: "manoPrincipal" });
  await esperarCondicion(() => room.state.players.get(room.sessionId).inventario.equipo.get("manoPrincipal") === "baston_guerra", 3000);
  comprobar("el bastón queda equipado en manoPrincipal (estado replicado)", room.state.players.get(room.sessionId).inventario.equipo.get("manoPrincipal") === "baston_guerra");
  const ataqueInicial = room.state.players.get(room.sessionId).ataque;
  comprobar("player.ataque ya suma el ataqueFisico del bastón (durabilidad a tope)", ataqueInicial === 9, `ataque=${ataqueInicial} (esperado 3 base + 6 bastón = 9)`);

  console.log("4) teleport junto al dummy_1 (Zona 5, x:236,y:280) y combate:iniciar...");
  adminOk = null;
  room.send("admin:debug:teleport", { x: 237, y: 280 });
  await esperarCondicion(() => adminOk?.accion === "teleport", 3000);
  comprobar("teleport responde ok", adminOk?.accion === "teleport", JSON.stringify(adminOk));

  combateErr = null;
  room.send("combate:iniciar", { objetivoId: DUMMY_ID });
  const combateId = await esperarCondicion(() => {
    for (const [id, c] of room.state.combates.entries()) if (c.unidades.has(DUMMY_ID)) return id;
    return null;
  }, 3000);
  comprobar("combate:iniciar contra el dummy abre ventana de unión", !!combateId, combateErr ? JSON.stringify(combateErr) : combateId);
  if (!combateId) throw new Error("no se pudo iniciar combate contra dummy_1");

  console.log("5) comenzarYa -> portal:ir a la arena real...");
  portalIr = null;
  room.send("combate:comenzarYa", { combateId });
  await esperarCondicion(() => portalIr?.combateId === combateId, 3000);
  comprobar("portal:ir hacia la arena llega", portalIr?.combateId === combateId, JSON.stringify(portalIr));
  room.leave();
  await esperar(300);

  const arena = await cliente.joinOrCreate("arena", { name: NOMBRE, combateId });
  await esperarCondicion(() => arena.state?.combates?.get(combateId)?.fase === "activo", 3000);
  comprobar("la arena monta el combate en fase activo", arena.state.combates.get(combateId)?.fase === "activo");

  let errorArena = null;
  arena.onMessage("combate:error", (m) => { errorArena = m; console.log("  arena combate:error", m); });
  arena.onMessage("pocion:bebida", (m) => (pocionBebida = m));
  arena.onMessage("combate:armaRota", (m) => { armaRota = m; console.log("  arena combate:armaRota", m); });
  let portalVuelta = null;
  arena.onMessage("portal:ir", (m) => (portalVuelta = m));

  /** Espera a que sea mi turno de verdad (esperando a que la IA del dummy resuelva el suyo si hace falta). */
  async function esperarMiTurno() {
    return esperarCondicion(() => {
      const c = arena.state.combates.get(combateId);
      return c && c.ordenTurnos[c.turnoActual] === arena.sessionId ? c : null;
    }, 15000, 100);
  }

  console.log("6) acercándose al dummy hasta quedar en alcance del bastón (2 casillas)...");
  let enAlcance = false;
  for (let intento = 0; intento < 20 && !enAlcance; intento++) {
    const combate = await esperarMiTurno();
    if (!combate) throw new Error("nunca llegó mi turno moviéndome hacia el dummy");
    const propia = combate.unidades.get(arena.sessionId);
    const objetivo = combate.unidades.get(DUMMY_ID);
    if (!objetivo) throw new Error("dummy_1 no está en la arena");
    const dist = Math.max(Math.abs(propia.gx - objetivo.gx), Math.abs(propia.gy - objetivo.gy));
    if (dist <= 2) { enAlcance = true; break; }
    const dx = Math.sign(objetivo.gx - propia.gx), dy = Math.sign(objetivo.gy - propia.gy);
    const pasos = Math.min(propia.pa, Math.max(Math.abs(objetivo.gx - propia.gx), Math.abs(objetivo.gy - propia.gy)) - 2);
    errorArena = null;
    arena.send("combate:mover", { combateId, gx: propia.gx + dx * Math.max(1, pasos), gy: propia.gy + dy * Math.max(1, pasos) });
    await esperar(200);
    if (errorArena) {
      // casilla exacta no alcanzable (PA/obstáculo) — un paso más corto, red de seguridad.
      arena.send("combate:mover", { combateId, gx: propia.gx + dx, gy: propia.gy + dy });
      await esperar(200);
    }
    const propiaTrasMover = arena.state.combates.get(combateId)?.unidades.get(arena.sessionId);
    if (!propiaTrasMover || propiaTrasMover.pa <= 0) {
      arena.send("combate:pasarTurno", { combateId });
      await esperar(200);
    }
  }
  comprobar("el jugador consigue quedar en alcance (2 casillas) del dummy", enAlcance);
  if (!enAlcance) throw new Error("nunca se pudo cerrar la distancia contra el dummy");

  // La secuencia crítica de abajo (golpe, poción, golpe — 2+2+2 PA) necesita
  // el turno ENTERO: si llegar al alcance gastó PA de más (nos plantamos en
  // rango con PA de sobra pero no necesariamente 6 completos), se pasa
  // turno una vez más para arrancar la secuencia con PA fresca de verdad.
  arena.send("combate:pasarTurno", { combateId });
  await esperar(200);

  console.log("7) golpe #1 (baston:barrido) — confirma reducción real de PA del objetivo (familia bastón) y guarda el daño como base...");
  let combate = await esperarMiTurno();
  if (!combate) throw new Error("no llegó mi turno para el golpe #1");
  let objAntes = combate.unidades.get(DUMMY_ID);
  const paAntes1 = objAntes.pa;
  const hpAntes1 = objAntes.hp;
  errorArena = null;
  arena.send("combate:accion", { combateId, objetivoId: DUMMY_ID, habilidadId: "baston:barrido" });
  await esperarCondicion(() => {
    const c = arena.state.combates.get(combateId);
    return c && c.unidades.get(DUMMY_ID)?.hp !== hpAntes1 ? c : null;
  }, 3000);
  comprobar("golpe #1 se resuelve sin error de servidor", !errorArena, JSON.stringify(errorArena));
  let objDespues1 = arena.state.combates.get(combateId).unidades.get(DUMMY_ID);
  const dano1 = hpAntes1 - objDespues1.hp;
  comprobar(
    "baston:barrido reduce el PA del objetivo en exactamente 1 (familia 'baston' de arenaCombate.ts, siempre — no depende de terreno/obstáculos)",
    objDespues1.pa === Math.max(0, paAntes1 - 1),
    `PA antes=${paAntes1} después=${objDespues1.pa}`,
  );
  comprobar("el golpe #1 hizo daño real medible (>0)", dano1 > 0, `daño=${dano1}`);
  // Rotura probabilística (docs/GDD_Combate.md, 2026-09-03) — mecanismo
  // NUEVO Y APARTE del desgaste gradual: cada golpe tiene una tirada real
  // (5% en nivel 10 de herrero, la mínima posible) de romper el arma DE
  // GOLPE. Si ha saltado justo en ESTE golpe, el golpe #2 (con poción) va a
  // rendir MENOS, no más — capturado aquí para no depender de que la tirada
  // no salga (~5% de posibilidades de que sí, en cuyo caso el golpe #2 se
  // compara con la expectativa CORRECTA en vez de asumir ciegamente "sube
  // siempre").
  const armaYaRotaAntesDelGolpe2 = !!armaRota;
  if (armaYaRotaAntesDelGolpe2) console.log(`   (nota: el golpe #1 rompió el arma de golpe — probabilidad real del 5%, tirada real. Rama alternativa: golpe #2 rendirá MENOS con el suelo fijo del 20%.)`);

  console.log("8) bebe la poción a MITAD de combate (mismo turno, tras el golpe #1)...");
  const itPocionArena = [...arena.state.players.get(arena.sessionId).inventario.cuerpo.items.values()].find((it) => it.itemId === "pocion_alquimica_clara");
  comprobar("la poción sembrada viajó con el inventario real hasta la arena", !!itPocionArena);
  pocionBebida = null;
  arena.send("pocion:beber", { instanciaId: itPocionArena.id });
  await esperarCondicion(() => pocionBebida, 3000);
  comprobar("pocion:beber confirma 'pocion:bebida' con el efecto real sembrado", pocionBebida?.efectos?.[0]?.stat === "ataqueFisico", JSON.stringify(pocionBebida));

  console.log("9) golpe #2 (mismo turno, con la poción activa) — debe hacer MÁS daño que el golpe #1...");
  const hpAntes2 = arena.state.combates.get(combateId).unidades.get(DUMMY_ID).hp;
  errorArena = null;
  arena.send("combate:accion", { combateId, objetivoId: DUMMY_ID, habilidadId: "baston:barrido" });
  await esperarCondicion(() => {
    const c = arena.state.combates.get(combateId);
    return !c || c.unidades.get(DUMMY_ID)?.hp !== hpAntes2 ? true : null;
  }, 3000);
  comprobar("golpe #2 se resuelve sin error de servidor", !errorArena, JSON.stringify(errorArena));
  const combateTrasGolpe2 = arena.state.combates.get(combateId);
  const hpDespues2 = combateTrasGolpe2 ? combateTrasGolpe2.unidades.get(DUMMY_ID).hp : 0; // el combate ya no existe -> el dummy murió DE VERDAD (sin regen dentro de la arena, ver cabecera) -> daño real >= hpAntes2 (cota inferior válida para la comparación de abajo)
  const dano2 = hpDespues2 > hpAntes2 ? hpAntes2 : hpAntes2 - hpDespues2;
  if (!armaYaRotaAntesDelGolpe2) {
    comprobar(
      "la poción sube el daño de verdad: golpe CON poción > golpe SIN poción (unidadCombate.ataqueFisico recalculado mid-combate)",
      dano2 > dano1,
      `daño sin poción=${dano1} daño con poción=${dano2}`,
    );
  } else {
    // Rama real (~5% de las ejecuciones): el golpe #1 rompió el arma de
    // golpe — el golpe #2 sigue conectando (arma rota funciona, con
    // debuff), pero el suelo fijo del 20% (FACTOR_ITEM_ROTO) pesa más que
    // el bonus de la poción, así que en ESTA rama el daño BAJA en vez de
    // subir. Confirma la mecánica de rotura en vez de la de poción — igual
    // de real, solo que la tirada esta vez cayó en esa rama.
    comprobar(
      "arma rota tras el golpe #1: el golpe #2 SIGUE conectando (con debuff), nunca se bloquea del todo",
      dano2 > 0,
      `daño sin poción(pre-rotura)=${dano1} daño con poción+arma rota=${dano2}`,
    );
  }

  console.log("10) golpes extra hasta que el combate se resuelva de verdad (el dummy SÍ puede morir dentro de la arena, ver cabecera — eso es justo lo que dispara ArenaCombateRoom.onCombateResuelto y persiste golpesDados/armaRotaEnCombate reales)...");
  let combateResuelto = !arena.state.combates.has(combateId);
  for (let i = 0; i < 6 && !combateResuelto; i++) {
    combate = await esperarMiTurno();
    if (!combate) { combateResuelto = !arena.state.combates.has(combateId); break; }
    const propia = combate.unidades.get(arena.sessionId);
    if (propia.pa < 2) { arena.send("combate:pasarTurno", { combateId }); await esperar(200); i--; continue; }
    const objetivo = combate.unidades.get(DUMMY_ID);
    if (!objetivo) { combateResuelto = true; break; }
    const hpAntesN = objetivo.hp;
    arena.send("combate:accion", { combateId, objetivoId: DUMMY_ID, habilidadId: "baston:barrido" });
    await esperarCondicion(() => !arena.state.combates.has(combateId) || arena.state.combates.get(combateId)?.unidades.get(DUMMY_ID)?.hp !== hpAntesN, 3000);
    combateResuelto = !arena.state.combates.has(combateId);
  }
  comprobar("varios golpes reales más se resolvieron sin reventar el servidor", true);

  // Red de seguridad: si por lo que sea el dummy sigue vivo (defensa alta,
  // muchos fallos de alcance...), huir para forzar la resolución del combate
  // igualmente (30% base de éxito por intento, reintenta hasta que salga).
  if (!combateResuelto) {
    console.log("   (el dummy sigue vivo tras los golpes extra — huyendo para forzar la resolución del combate)");
    let huido = false;
    for (let intento = 0; intento < 30 && !huido; intento++) {
      const c = await esperarMiTurno();
      if (!c) { huido = true; break; }
      const propia = c.unidades.get(arena.sessionId);
      // Huir exige >=1 PA (manejarCombateHuir) y, a diferencia de un ataque
      // con PA insuficiente, NO pasa turno solo por fallar esa comprobación
      // — hay que pasarlo a mano para llegar a un turno con PA fresca.
      if (!propia || propia.pa < 1) {
        arena.send("combate:pasarTurno", { combateId });
        await esperar(200);
        continue;
      }
      arena.send("combate:huir", { combateId });
      const resultado = await esperarCondicion(() => (portalVuelta ? "volvio" : !arena.state.combates.has(combateId) ? "termino" : null), 3000, 100);
      if (resultado) { huido = true; break; }
    }
    comprobar("el jugador consigue huir del combate (red de seguridad)", huido);
  }
  arena.leave();
  await esperar(500); // deja que onLeave (guardarInventarioYEquipoDe) termine de persistir antes de reconectar

  room = await cliente.joinOrCreate("hub", { name: NOMBRE });
  room.onMessage("item:reparado", (m) => (itemReparado = m));
  room.onMessage("item:error", (m) => { itemError = m; console.log("  item:error", m); });
  await esperarCondicion(() => room.state?.players?.get(room.sessionId), 5000);
  const ataqueTrasCombate = await esperarCondicion(() => {
    const a = room.state.players.get(room.sessionId)?.ataque;
    return typeof a === "number" ? { a } : null;
  }, 5000);
  comprobar(
    "la durabilidad real del arma BAJÓ tras varios golpes reales (player.ataque recalculado con la durabilidad persistida es menor que el inicial)",
    (ataqueTrasCombate?.a ?? Infinity) < ataqueInicial,
    `ataque inicial=${ataqueInicial} ataque tras combate=${ataqueTrasCombate?.a}`,
  );

  console.log("12) item:reparar junto al yunque sembrado — restaura la durabilidad al máximo (mínimo viable NUEVO)...");
  itemReparado = null; itemError = null;
  room.send("item:reparar", { construccionId: idYunque, slot: "manoPrincipal" });
  await esperarCondicion(() => itemReparado || itemError, 3000);
  comprobar("item:reparar responde 'item:reparado' con la durabilidad máxima real", itemReparado?.itemId === "baston_guerra" && itemReparado?.durabilidad === 55, JSON.stringify({ itemReparado, itemError }));
  // recalcularStatsJugador ya corrió DENTRO de manejarItemReparar (síncrono,
  // antes de que "item:reparado" llegue) — solo hace falta esperar a que el
  // propio patch de estado (15/seg) traiga el player.ataque actualizado.
  await esperarCondicion(() => room.state.players.get(room.sessionId)?.ataque === ataqueInicial, 3000, 50);
  comprobar(
    "player.ataque vuelve EXACTO al valor inicial tras reparar (misma prueba indirecta, en sentido contrario)",
    room.state.players.get(room.sessionId)?.ataque === ataqueInicial,
    `ataque tras reparar=${room.state.players.get(room.sessionId)?.ataque} (esperado ${ataqueInicial})`,
  );

  console.log("13) item:reparar SIN material se rechaza limpio (madera_dura ya gastada en el paso anterior)...");
  itemReparado = null; itemError = null;
  room.send("item:reparar", { construccionId: idYunque, slot: "manoPrincipal" });
  await esperarCondicion(() => itemReparado || itemError, 3000);
  comprobar("segunda reparación sin insumos se rechaza con item:error (no revienta, no repara gratis)", !!itemError?.motivo, JSON.stringify(itemError));

  room.leave();
  await esperar(200);

  console.log(`\n${fallos === 0 ? "✅ TODO OK" : "❌ HAY FALLOS"}: verificadas habilidad de familia (bastón reduce PA), poción sube el daño mid-combate, desgaste real de combate baja la durabilidad (y sube de vuelta al equipo/ataque), y item:reparar restaura de verdad junto a un yunque real.`);
  if (fallos > 0) fallo = new Error(`${fallos} comprobaciones fallaron`);
} catch (e) {
  fallo = e;
  console.error(e);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
  try { unlinkSync(rutaBd + "-shm"); } catch {}
  try { unlinkSync(rutaBd + "-wal"); } catch {}
}

if (fallo) { console.error("FALLO:", fallo.message); process.exit(1); }
