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

/** Mata al enemigo `objetivoId` con combate real (mismo flujo no-caza que combate.e2e.mjs: ventana de unión -> comenzarYa -> arena -> turnos -> vuelta). godMode ya activado antes de llamar. */
async function matarEnemigoReal(client, room, objetivoId, comprobar) {
  let portalArena = null;
  const alPortal = (m) => { if (m?.tipo === "combate") portalArena = m; };
  room.onMessage("portal:ir", alPortal);
  let errorCombate = null;
  room.onMessage("combate:error", (m) => { errorCombate = m; });

  room.send("combate:iniciar", { objetivoId });
  const combateId = await esperarCondicion(() => {
    for (const [id, c] of room.state.combates.entries()) if (c.unidades.has(objetivoId)) return id;
    return null;
  }, 3000, 100);
  comprobar(!!combateId, `combate:iniciar crea el combate contra ${objetivoId}`, errorCombate ? JSON.stringify(errorCombate) : "sin combateId");
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

  let rondas = 0;
  let objetivoMuerto = false;
  while (rondas < 200) {
    rondas++;
    const combate = arena.state.combates.get(combateId);
    if (!combate) { objetivoMuerto = true; break; }
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== arena.sessionId) { await esperar(150); continue; }
    const objetivo = combate.unidades.get(objetivoId);
    if (!objetivo) { objetivoMuerto = true; break; }
    errorArena = null;
    arena.send("combate:accion", { combateId, objetivoId });
    await esperar(150);
    if (errorArena?.motivo === "fuera de alcance") {
      const propia = combate.unidades.get(arena.sessionId);
      const dx = Math.sign(objetivo.gx - propia.gx);
      const dy = Math.sign(objetivo.gy - propia.gy);
      arena.send("combate:mover", { combateId, gx: propia.gx + dx, gy: propia.gy + dy });
      await esperar(150);
    }
    const propiaActual = arena.state.combates.get(combateId)?.unidades.get(arena.sessionId);
    if (!propiaActual || propiaActual.pa <= 0 || errorArena?.motivo === "sin PA suficiente") {
      arena.send("combate:pasarTurno", { combateId });
      await esperar(150);
    }
  }
  comprobar(objetivoMuerto, `${objetivoId} muere en combate real (godMode: el jugador nunca pierde vida)`, `rondas=${rondas}`);
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
