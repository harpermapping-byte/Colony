"use strict";

// E2E de "mazmorra limpiada" (docs/GDD_Combate.md, docs/GDD_Bakeador_Dungeons.md
// §4.2/§7, pedido 2026-09-01) — servidor Colyseus REAL, cliente colyseus.js
// plano (sin navegador, mismo patrón que combate.e2e.mjs). Prueba el bug
// real que se acaba de corregir en DungeonRoom.ts: antes de esta pasada,
// `marcarMazmorraLimpiada` tenía persistencia lista (bd.ts) pero CERO call
// sites — nada la llamaba nunca, así que el cooldown de 1h tras vaciar una
// mazmorra jamás se activaba en la práctica.
//
// Bakea una mazmorra real pequeña (mismo generador que server/test/
// mazmorra.test.ts) y la RECORTA a solo 2 enemigos normales (sin boss, para
// no arrastrar el camino de loot procedural) antes de escribirla en
// assets/mapas/demo/interiores/ — esa carpeta YA existe con un fixture de
// prueba (prueba_luz_ambiente.json), así que añadir un fichero más ahí es
// el patrón establecido, no un hueco nuevo. Se limpia en el finally.
//
// Para no tener que resolver pathfinding real dentro de una mazmorra
// orgánica (problema real y no trivial, ver los comentarios de
// mesaAjedrez.e2e.cjs sobre "línea despejada" en el exterior — aquí sería
// peor, geometría de cueva) el jugador entra DIRECTAMENTE encima de cada
// enemigo via entradaX/entradaY (OpcionesInterior, pensado para "llegar por
// una escalera concreta" pero genérico: es solo la casilla de aparición) —
// las coordenadas del spawn las conoce el propio script porque es quien
// generó el bake. godMode (admin:debug:godMode, ya usado en Test Zone) deja
// al jugador encajar golpes sin morir mientras devuelve los suyos, así el
// combate se resuelve en un puñado de turnos deterministas sin depender de
// equipo/nivel.
//
// Verificación final MÁS FUERTE que leer la fila de mazmorras_estado a
// mano: tras matar a los 2 enemigos, se vuelve a entrar a la MISMA mazmorra
// y se comprueba que esta vez aparece VACÍA — ejercita el lazo completo
// (muerte -> marcarMazmorraLimpiada -> próxima entrada lee el cooldown con
// obtenerLimpiezaMazmorra y no puebla nada) a través de su propio
// consumidor real, no de una lectura de BD por fuera del sistema.
//
// BUG REAL DISTINTO encontrado construyendo este e2e (no ocultado, ver
// tarea aparte sugerida): la primera versión de este script hacía que
// "Jarl" saliera de la mazmorra solo (room.leave()) para ir a pelear a la
// arena — Colyseus con autoDispose por defecto (nunca desactivado en
// InteriorRoom/DungeonRoom, comprobado con grep) destruye la room en
// cuanto se queda vacía, así que al volver "Jarl" entraba a una instancia
// NUEVA (log "Interior ... nivel=0" repetido en cada entrada) con los 2
// enemigos repoblados de cero — el resultado del combate real (incluida
// esta corrección) nunca llegaba a aplicarse sobre ninguna room viva.
// Afecta a CUALQUIER jugador en solitario que vaya a pelear el último
// enemigo de un interior/mazmorra suyo, no solo a este trigger — recompensas
// y loot de esa pelea también se perderían. Aquí se evita añadiendo un
// segundo cliente "Centinela" que se queda dentro todo el rato (mismo
// truco que usaría un grupo real: mientras alguien siga dentro, la room no
// se destruye) — así se puede verificar ESTE fix de verdad; el problema de
// fondo (una room de combate en solitario puede destruirse a medio pelear)
// se deja documentado y con una tarea aparte, fuera de alcance de este ticket.
//
//   node client/test/mazmorraLimpiada.e2e.cjs

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Client } = require("colyseus.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const PUERTO_WS = 2601;
const BD_RUTA = path.join(os.tmpdir(), "colony_mazmorra_limpiada_e2e.sqlite");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const EDIFICIO_TEST = "e2e_test_mazmorra_limpiada";
const RUTA_INTERIORES_DEMO = path.join(RUTA_DEMO, "interiores");
const RUTA_ARCHIVO_MAZMORRA = path.join(RUTA_INTERIORES_DEMO, `${EDIFICIO_TEST}.json`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {}
    await esperar(500);
  }
  throw new Error(`No responde ${url}`);
}

async function esperarCondicion(fn, timeoutMs, intervaloMs = 100) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const v = fn();
    if (v) return v;
    await esperar(intervaloMs);
  }
  return null;
}

/** El id "e_N" de poblarEnemigos sale de una lista BARAJADA (barajarYCortar) — nunca asume que "e_0" es el spawn[0]: busca el enemigo real más cercano al jugador (que sí entró exactamente encima del spawn que le tocaba). */
function enemigoMasCercano(room) {
  const propio = room.state.players.get(room.sessionId);
  let mejorId = null;
  let mejorDist = Infinity;
  for (const [id, e] of room.state.enemigos.entries()) {
    const d = Math.hypot(e.x - propio.x, e.y - propio.y);
    if (d < mejorDist) { mejorDist = d; mejorId = id; }
  }
  return mejorId;
}

/**
 * Mata a un enemigo con combate real (mismo flujo no-caza que combate.e2e.mjs:
 * ventana de unión -> comenzarYa -> arena -> turnos -> vuelta). godMode ya
 * activado antes de llamar.
 *
 * `objetivoIdPreferido` es solo un HINT (el enemigo más cercano al punto de
 * entrada) — NO se asume que `combate:iniciar` vaya a enfrentarlo de verdad.
 * Causa raíz real del "Sin roster para el combate..." intermitente
 * (docs/GDD_Combate.md §11quater, investigado 2026-09-07): el jugador entra
 * literalmente ENCIMA del spawn de un enemigo (a propósito, ver cabecera del
 * fichero) y el agro automático de enemigos de mazmorra
 * (`verificarAgroFauna`, tick de 200ms, §11) puede arrastrarlo a un combate
 * PROPIO contra CUALQUIER enemigo cercano antes de que le dé tiempo a mandar
 * `combate:iniciar` a mano. Cuando eso pasa, el servidor rechaza
 * correctamente el `combate:iniciar` manual con "ya estás en combate"
 * (`RoomExteriorBase.ts`, comportamiento correcto: un jugador no puede abrir
 * dos combates a la vez) — pero la versión vieja de este test seguía
 * asumiendo que `objetivoIdPreferido` era el enemigo real y usaba
 * `combate:comenzarYa` sobre un combate del que el jugador NUNCA formó
 * parte, así que nadie llegaba a registrar su roster (`registrarRosterArena`)
 * y `ArenaCombateRoom.onCreate` reventaba con "Sin roster" al intentar
 * consumirlo. Arreglo real: comprobar primero si el jugador YA está en un
 * combate propio (agro automático) y, si es así, seguir ESE — nunca asumir
 * `objetivoIdPreferido`.
 */
async function matarEnemigoReal(client, room, objetivoIdPreferido, comprobar) {
  let portalArena = null;
  const alPortal = (m) => { if (m?.tipo === "combate") portalArena = m; };
  room.onMessage("portal:ir", alPortal);
  let errorCombate = null;
  room.onMessage("combate:error", (m) => { errorCombate = m; });

  const combatePropio = () => {
    for (const [id, c] of room.state.combates.entries()) if (c.unidades.has(room.sessionId)) return id;
    return null;
  };

  let combateId = combatePropio();
  if (!combateId) {
    room.send("combate:iniciar", { objetivoId: objetivoIdPreferido });
    combateId = await esperarCondicion(combatePropio, 3000, 100);
  }
  // El objetivo REAL es quien esté en el bando contrario dentro del combate
  // ya confirmado — nunca `objetivoIdPreferido` a ciegas: si el agro
  // automático adelantó al jugador, puede ser un enemigo distinto del más
  // cercano al punto de entrada (y si hay un aliado co-unido, bando lo
  // distingue de un enemigo real sin más que mirar `esJugador`/`bando`).
  let objetivoId = objetivoIdPreferido;
  if (combateId) {
    const combate = room.state.combates.get(combateId);
    const propiaBando = combate.unidades.get(room.sessionId)?.bando;
    for (const [unidadId, u] of combate.unidades.entries()) {
      if (u.bando !== propiaBando) { objetivoId = unidadId; break; }
    }
  }
  comprobar(!!combateId, `combate:iniciar (manual o agro automático) mete al jugador en un combate real contra ${objetivoId}`, errorCombate ? JSON.stringify(errorCombate) : "sin combateId");
  if (!combateId) throw new Error("no se pudo iniciar combate real contra el enemigo de mazmorra");
  comprobar(room.state.combates.get(combateId)?.fase === "pendiente", "arranca en fase pendiente (enemigo de mazmorra, nunca modo caza)");

  room.send("combate:comenzarYa", { combateId });
  const llegoPortal = await esperarCondicion(() => portalArena?.combateId === combateId, 3000, 100);
  comprobar(!!llegoPortal, "comenzarYa cierra la ventana e instancia la arena", JSON.stringify(portalArena));

  room.leave();
  await esperar(300);
  const arena = await client.joinOrCreate("arena", { name: "Jarl", combateId });
  await esperarCondicion(() => arena.state?.combates?.get(combateId)?.fase === "activo", 3000, 100);
  comprobar(arena.state.combates.get(combateId)?.fase === "activo", "la arena monta el combate activo");

  // godMode vive en el Player.godMode de CADA room (server/src/rooms/schema/HubState.ts)
  // — el flag puesto en la room de origen NO viaja con el jugador a la arena
  // (ArenaCombateRoom crea su propio Player nuevo en onJoin, ver
  // ArenaCombateRoom.ts). admin:debug:godMode SÍ está cableado también aquí
  // (iniciarMovimiento() es común a toda RoomExteriorBase), así que hay que
  // reactivarlo de nuevo tras entrar — si no, "Jarl" (stats base, sin
  // equipo) puede morir de verdad antes que el enemigo y el combate lo
  // resuelve por el bando del jugador, no por el del enemigo.
  arena.send("admin:debug:godMode", { activo: true });
  await esperar(300);

  let errorArena = null;
  arena.onMessage("combate:error", (m) => { errorArena = m; });
  let portalVuelta = null;
  arena.onMessage("portal:ir", (m) => (portalVuelta = m));

  // `rondas` cuenta SOLO turnos reales de Jarl (ataca/mueve/pasa) — nunca
  // ciclos de espera del turno de otro. Con el agro automático de mazmorra
  // (§11) es normal que un combate real acabe con un aliado co-unido (aquí,
  // Centinela) además de Jarl y el enemigo — el turno de Jarl deja de ser
  // 1 de cada 2 (jugador/enemigo) y pasa a ser 1 de cada 3, así que si
  // `rondas` contara también los ciclos de espera, el mismo presupuesto fijo
  // (200) se agotaba esperando SIN haber dado tiempo a que a Jarl le
  // tocaran sus 200 turnos de verdad (bug real, docs/GDD_Combate.md
  // §11quater: "e_0 muere... rondas=200" pese a que un combate 1v1
  // equivalente muere en ~40-45). `esperas` es un tope aparte, generoso,
  // solo para no colgarse si algo se rompe de verdad (combate nunca avanza).
  let rondas = 0;
  let esperas = 0;
  let objetivoMuerto = false;
  while (rondas < 200 && esperas < 1200) {
    const combate = arena.state.combates.get(combateId);
    if (!combate) { objetivoMuerto = true; break; }
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== arena.sessionId) { esperas++; await esperar(150); continue; }
    rondas++;
    const objetivo = combate.unidades.get(objetivoId);
    if (!objetivo) { objetivoMuerto = true; break; }
    errorArena = null;
    arena.send("combate:accion", { combateId, objetivoId });
    await esperar(150);
    if (errorArena?.motivo === "fuera de alcance") {
      // Movimiento voraz: un solo paso diagonal hacia el objetivo. En una
      // rejilla táctica con obstáculos (`combate.obstaculos`, distinto mapa
      // de arena cada vez vía `elegirArena`) un paso diagonal puede estar
      // bloqueado aunque los pasos horizontal/vertical equivalentes NO lo
      // estén (mismo criterio de muchos tácticos por rejilla: mover en
      // diagonal exige las dos casillas ortogonales adyacentes libres) — sin
      // caer a un paso alternativo, Jarl podía quedarse pegado a una esquina
      // repitiendo el MISMO movimiento fallido las 200 rondas enteras, sin
      // acercarse nunca (bug real de este test, docs/GDD_Combate.md
      // §11quater, encontrado con diagnóstico de HP: `objetivo.hp` se
      // quedaba en 40/40 las 200 rondas, "fuera de alcance" todo el rato).
      // Se prueba la diagonal directa y, si no avanza de verdad (posición
      // sin cambios tras el intento), los dos pasos ortogonales sueltos.
      const propia = combate.unidades.get(arena.sessionId);
      const dx = Math.sign(objetivo.gx - propia.gx);
      const dy = Math.sign(objetivo.gy - propia.gy);
      const candidatos = [[propia.gx + dx, propia.gy + dy], [propia.gx + dx, propia.gy], [propia.gx, propia.gy + dy]]
        .filter(([gx, gy]) => gx !== propia.gx || gy !== propia.gy);
      for (const [gx, gy] of candidatos) {
        arena.send("combate:mover", { combateId, gx, gy });
        await esperar(150);
        const propiaTrasMover = arena.state.combates.get(combateId)?.unidades.get(arena.sessionId);
        if (propiaTrasMover && (propiaTrasMover.gx !== propia.gx || propiaTrasMover.gy !== propia.gy)) break;
      }
    }
    const propiaActual = arena.state.combates.get(combateId)?.unidades.get(arena.sessionId);
    if (!propiaActual || propiaActual.pa <= 0 || errorArena?.motivo === "sin PA suficiente") {
      arena.send("combate:pasarTurno", { combateId });
      await esperar(150);
    }
  }
  comprobar(objetivoMuerto, `${objetivoId} muere en combate real (godMode: el jugador nunca pierde vida)`, `rondas=${rondas} esperas=${esperas}`);
  await esperar(2000); // margen generoso para el aplicarResultadoRemoto "void" (fire-and-forget) de ArenaCombateRoom.ts
  // Sin "retorno" capturado en combate:iniciar (este script no lo manda) el
  // destino cae al Hub por defecto (RoomExteriorBase.ts, comportamiento
  // correcto y documentado) — no es lo que se está probando aquí, solo
  // importa que SÍ llegue algún portal:ir confirmando que el combate se
  // resolvió; la reentrada a la mazmorra se hace a mano justo después.
  comprobar(!!portalVuelta, "portal:ir llega tras ganar (destino real, sin retorno capturado por este script)", JSON.stringify(portalVuelta));
  arena.leave();
  await esperar(300);
}

/**
 * El Centinela se queda en la mazmorra solo para evitar que la room se
 * destruya (ver cabecera) — pero el agro automático (o el co-op join de
 * `combate:iniciar`, ambos comportamiento CORRECTO del servidor) puede
 * arrastrarlo a un combate real sin que este script lo pidiera. Si nadie
 * controla su unidad ahí, sus turnos solo se resuelven por el margen de
 * gracia de `saltarTurnoSiJugadorAusente` (8s, docs/GDD_Combate.md §11bis) —
 * repetido varias veces a lo largo de una pelea agota el presupuesto fijo
 * de 200 rondas del bucle de combate ANTES de que el enemigo real muera
 * (segundo síntoma real del intermitente, ver §11quater). Arreglo real: en
 * cuanto el Centinela recibe SU PROPIO portal:ir de combate, sigue a la
 * arena con su propia conexión (sin dejar la mazmorra — colyseus.js permite
 * varias rooms abiertas a la vez en el mismo Client) y pasa turno cada vez
 * que le toca, como un aliado presente pero pasivo — nunca deja un turno
 * huérfano esperando el margen de gracia.
 */
function seguirCentinelaAArenas(clientCentinela, centinela) {
  const atendidos = new Set();
  centinela.onMessage("portal:ir", (m) => {
    if (m?.tipo !== "combate" || !m.combateId || atendidos.has(m.combateId)) return;
    atendidos.add(m.combateId);
    (async () => {
      try {
        const arena = await clientCentinela.joinOrCreate("arena", { name: "Centinela", combateId: m.combateId });
        // El primer patch de estado (MapSchema `combates` incluida) puede
        // llegar unos ms DESPUÉS de que se resuelva joinOrCreate — esperar
        // a que exista de verdad antes de leerlo evita reventar con
        // "Cannot read properties of undefined" y abandonar el seguimiento
        // a las primeras de cambio (encontrado de verdad corriendo el e2e).
        await esperarCondicion(() => arena.state?.combates?.get(m.combateId), 3000, 100);
        arena.send("admin:debug:godMode", { activo: true });
        for (let i = 0; i < 400; i++) {
          const combate = arena.state?.combates?.get(m.combateId);
          if (!combate) break;
          if (combate.ordenTurnos[combate.turnoActual] === arena.sessionId) {
            arena.send("combate:pasarTurno", { combateId: m.combateId });
          }
          await esperar(150);
        }
        try { arena.leave(); } catch {}
      } catch (e) {
        console.error("[Centinela] no pudo seguir a su propia arena:", e?.message || e);
      }
    })();
  });
}

async function main() {
  let fallos = 0;
  const comprobar = (ok, mensaje, detalle) => {
    console.log(`${ok ? "ok" : "FALLO"} - ${mensaje}${detalle ? ` (${detalle})` : ""}`);
    if (!ok) fallos++;
  };

  for (const puerto of [PUERTO_WS, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado — mátalo antes de correr el e2e`);
  }

  console.log("1) bakeando una mazmorra real pequeña y recortándola a 2 enemigos normales (sin boss)...");
  const { generarMazmorra } = require(path.join(RAIZ, "mazmorras", "src", "generarMazmorra"));
  const { cargarCatalogos } = require(path.join(RAIZ, "interiores", "src", "catalogo"));
  const tiposDungeon = require(path.join(RAIZ, "mazmorras", "catalogo", "tipos_dungeon.json"));
  const catalogosInteriores = cargarCatalogos();
  const catalogosMazmorra = { tiposDungeon };

  let m = null;
  let plantaBaja = null;
  let spawns = null;
  for (const semilla of ["e2e-limpiada-1", "e2e-limpiada-2", "e2e-limpiada-3", "e2e-limpiada-4", "e2e-limpiada-5"]) {
    const intento = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla });
    const planta = intento.plantas.find((p) => p.rol === "planta_baja") ?? intento.plantas[0];
    const normales = (planta.spawnsEnemigos || []).filter((s) => !s.esBossSlot);
    if (normales.length >= 2) { m = intento; plantaBaja = planta; spawns = normales.slice(0, 2); break; }
  }
  if (!m) throw new Error("ninguna semilla de prueba dio 2 spawns normales — no se puede montar el e2e");
  plantaBaja.spawnsEnemigos = spawns; // recorte real: menos enemigos, misma geometría de sala válida
  console.log(`  planta_baja nivel=${plantaBaja.nivel}, 2 spawns en (${spawns[0].x},${spawns[0].y}) y (${spawns[1].x},${spawns[1].y})`);

  const existiaCarpetaInteriores = fs.existsSync(RUTA_INTERIORES_DEMO);
  fs.mkdirSync(RUTA_INTERIORES_DEMO, { recursive: true });
  fs.writeFileSync(RUTA_ARCHIVO_MAZMORRA, JSON.stringify(m));
  fs.rmSync(BD_RUTA, { force: true });

  let servidor;
  const matar = () => {
    try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
    try { servidor.kill("SIGKILL"); } catch {}
  };

  try {
    servidor = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: path.join(RAIZ, "server"),
      env: { ...process.env, PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_DEMO, BD_RUTA, JARL_NOMBRES: "Jarl" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    servidor.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
    servidor.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);

    const client = new Client(`ws://localhost:${PUERTO_WS}`);
    const clientCentinela = new Client(`ws://localhost:${PUERTO_WS}`);
    const opcionesJoin = (nombre, spawn_) => ({
      name: nombre, mapaId: "demo", edificio: EDIFICIO_TEST, nivel: plantaBaja.nivel,
      entradaX: spawn_.x + 0.5, entradaY: spawn_.y + 0.5,
    });

    console.log("2) el Centinela entra primero y se queda todo el rato — evita que la room se destruya mientras Jarl pelea fuera (ver nota de cabecera)...");
    const centinela = await clientCentinela.joinOrCreate("mazmorra", opcionesJoin("Centinela", spawns[0]));
    await esperarCondicion(() => centinela.state?.players?.get(centinela.sessionId) && centinela.state.enemigos, 5000, 100);
    seguirCentinelaAArenas(clientCentinela, centinela);

    console.log("3) Jarl entra a la MISMA instancia — deben verse los 2 enemigos (mazmorra nunca limpiada todavía)...");
    let room = await client.joinOrCreate("mazmorra", opcionesJoin("Jarl", spawns[0]));
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.enemigos, 5000, 100);
    comprobar(room.state.enemigos.size === 2, "poblarEnemigos crea los 2 enemigos reales", `size=${room.state.enemigos.size}`);
    comprobar(room.state.players.size === 2, "Jarl y Centinela comparten la MISMA instancia (mismo mapaId/edificio/nivel)", `players=${room.state.players.size}`);

    room.send("admin:debug:godMode", { activo: true });
    await esperar(300);

    const idCercano1 = enemigoMasCercano(room);
    console.log(`4) matando al enemigo más cercano al punto de entrada (${idCercano1}) con combate real (godMode activo)...`);
    await matarEnemigoReal(client, room, idCercano1, comprobar);
    console.log(`  [diagnóstico] vista en VIVO del Centinela (nunca salió de la room) tras la muerte: enemigos=${centinela.state.enemigos.size}, ids=${JSON.stringify([...centinela.state.enemigos.keys()])}`);
    comprobar(centinela.state.enemigos.size === 1, "el Centinela (en vivo, sin reconectar) ya ve solo 1 enemigo tras la primera muerte", `size=${centinela.state.enemigos.size}`);

    console.log("5) reentrando tras la primera muerte — debe quedar 1 enemigo, la mazmorra NO se marca limpiada con uno vivo todavía...");
    room = await client.joinOrCreate("mazmorra", opcionesJoin("Jarl", spawns[1]));
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.enemigos, 5000, 100);
    comprobar(room.state.enemigos.size === 1, "sigue vivo el segundo enemigo (el trigger no dispara con 1 de 2 muertos)", `size=${room.state.enemigos.size}`);
    room.send("admin:debug:godMode", { activo: true });
    await esperar(300);

    const idUltimo = enemigoMasCercano(room);
    console.log(`6) matando al ÚLTIMO enemigo (${idUltimo}) — aquí debe dispararse marcarMazmorraLimpiada...`);
    await matarEnemigoReal(client, room, idUltimo, comprobar);
    comprobar(centinela.state.enemigos.size === 0, "el Centinela (que nunca salió) ve la room en vivo ya a 0 enemigos", `size=${centinela.state.enemigos.size}`);

    console.log("7) los dos se van (la room ahora SÍ se vacía de verdad) y se vuelve a entrar — debe verse VACÍA por el cooldown persistido, no por casualidad...");
    room.leave();
    centinela.leave();
    await esperar(1000); // margen real para que la room vacía se destruya de verdad antes de la siguiente entrada
    room = await client.joinOrCreate("mazmorra", opcionesJoin("Jarl", spawns[0]));
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.enemigos, 5000, 100);
    comprobar(room.state.enemigos.size === 0, "instancia NUEVA (room anterior ya destruida) y sigue VACÍA — el cooldown real, persistido en BD, gatea la repoblación", `size=${room.state.enemigos.size}`);
    room.leave();
  } catch (err) {
    console.error(err);
    fallos++;
  } finally {
    matar();
    await esperar(500);
    fs.rmSync(BD_RUTA, { force: true });
    fs.rmSync(RUTA_ARCHIVO_MAZMORRA, { force: true });
    if (!existiaCarpetaInteriores) {
      try { fs.rmdirSync(RUTA_INTERIORES_DEMO); } catch {} // solo si quedó vacía (no existía antes de este e2e)
    }
  }

  console.log(fallos === 0 ? "\n✅ mazmorraLimpiada.e2e: todo OK" : `\n❌ mazmorraLimpiada.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
