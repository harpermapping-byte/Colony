"use strict";

// E2E del bug real "una InteriorRoom/DungeonRoom se autodispone con el
// último jugador peleando fuera" (docs/GDD_Combate.md §9.2, docs/
// GDD_Bakeador_Dungeons.md §7, encontrado 2026-09-01 construyendo
// mazmorraLimpiada.e2e.cjs — ahí se esquivó a propósito con un cliente
// "Centinela" que se quedaba dentro; ESTE script reproduce el caso SIN
// esquivarlo: "Jarl" entra SOLO a una mazmorra de 1 enemigo, sale a pelearlo
// a la arena (room de origen momentáneamente a 0 clientes) y vuelve a
// entrar — antes del fix la room se autodisponía en el hueco y Colyseus
// creaba una instancia NUEVA (repoblada de cero, el "muerto" seguía vivo);
// con el fix (`RoomExteriorBase`: `autoDispose=false` mientras
// `state.combatesEnCurso` tenga algo pendiente, revertido/disparado a mano
// por `quitarMarcadorCombate`) la MISMA room sigue viva y el resultado del
// combate se aplica de verdad sobre su `state.enemigos` real.
//
// Verificación doble, más fuerte que solo mirar el estado final:
// 1) `state.enemigos.size === 0` al reentrar (el resultado se aplicó).
// 2) La línea de log `Interior "..." nivel=0` (InteriorRoom.onCreate, solo
//    imprime una vez por instancia real) aparece EXACTAMENTE una vez en
//    todo el stdout del servidor — si apareciera 2 veces, la segunda
//    entrada habría creado una instancia fantasma nueva (el síntoma exacto
//    del bug), aunque (1) diera 0 por casualidad de otra forma.
//
//   node client/test/combateSoloMantieneRoom.e2e.cjs

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Client } = require("colyseus.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const PUERTO_WS = 2602;
const BD_RUTA = path.join(os.tmpdir(), "colony_combate_solo_e2e.sqlite");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const EDIFICIO_TEST = "e2e_test_combate_solo";
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

  console.log("1) bakeando una mazmorra real pequeña y recortándola a 1 solo enemigo normal...");
  const { generarMazmorra } = require(path.join(RAIZ, "mazmorras", "src", "generarMazmorra"));
  const { cargarCatalogos } = require(path.join(RAIZ, "interiores", "src", "catalogo"));
  const tiposDungeon = require(path.join(RAIZ, "mazmorras", "catalogo", "tipos_dungeon.json"));
  const catalogosInteriores = cargarCatalogos();
  const catalogosMazmorra = { tiposDungeon };

  let m = null;
  let plantaBaja = null;
  let spawn_ = null;
  for (const semilla of ["e2e-solo-1", "e2e-solo-2", "e2e-solo-3", "e2e-solo-4", "e2e-solo-5"]) {
    const intento = generarMazmorra({ tipoDungeonId: "cueva_goblins", catalogosMazmorra, catalogosInteriores, semilla });
    const planta = intento.plantas.find((p) => p.rol === "planta_baja") ?? intento.plantas[0];
    const normales = (planta.spawnsEnemigos || []).filter((s) => !s.esBossSlot);
    if (normales.length >= 1) { m = intento; plantaBaja = planta; spawn_ = normales[0]; break; }
  }
  if (!m) throw new Error("ninguna semilla de prueba dio un spawn normal — no se puede montar el e2e");
  plantaBaja.spawnsEnemigos = [spawn_]; // recorte real: 1 solo enemigo, misma geometría de sala válida
  console.log(`  planta_baja nivel=${plantaBaja.nivel}, 1 spawn en (${spawn_.x},${spawn_.y})`);

  const existiaCarpetaInteriores = fs.existsSync(RUTA_INTERIORES_DEMO);
  fs.mkdirSync(RUTA_INTERIORES_DEMO, { recursive: true });
  fs.writeFileSync(RUTA_ARCHIVO_MAZMORRA, JSON.stringify(m));
  fs.rmSync(BD_RUTA, { force: true });

  let servidor;
  let logServidor = "";
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
    servidor.stdout.on("data", (d) => { logServidor += d.toString(); process.stdout.write(`[servidor] ${d}`); });
    servidor.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);

    const client = new Client(`ws://localhost:${PUERTO_WS}`);
    const opcionesJoin = () => ({
      name: "Jarl", mapaId: "demo", edificio: EDIFICIO_TEST, nivel: plantaBaja.nivel,
      entradaX: spawn_.x + 0.5, entradaY: spawn_.y + 0.5,
    });

    console.log("2) Jarl entra SOLO — nadie más se queda dentro, a propósito (aquí es donde reproducía el bug)...");
    let room = await client.joinOrCreate("mazmorra", opcionesJoin());
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.enemigos, 5000, 100);
    comprobar(room.state.enemigos.size === 1, "poblarEnemigos crea el único enemigo real", `size=${room.state.enemigos.size}`);
    comprobar(room.state.players.size === 1, "Jarl está solo en la instancia", `players=${room.state.players.size}`);
    const objetivoId = [...room.state.enemigos.keys()][0];

    room.send("admin:debug:godMode", { activo: true });
    await esperar(300);

    console.log(`3) matando al único enemigo (${objetivoId}) con combate real — Jarl sale SOLO a la arena, la room de origen se queda a 0 clientes...`);
    let portalArena = null;
    room.onMessage("portal:ir", (m2) => { if (m2?.tipo === "combate") portalArena = m2; });
    let errorCombate = null;
    room.onMessage("combate:error", (m2) => { errorCombate = m2; });

    room.send("combate:iniciar", { objetivoId });
    const combateId = await esperarCondicion(() => {
      for (const [id, c] of room.state.combates.entries()) if (c.unidades.has(objetivoId)) return id;
      return null;
    }, 3000, 100);
    comprobar(!!combateId, "combate:iniciar crea el combate contra el enemigo", errorCombate ? JSON.stringify(errorCombate) : "sin combateId");
    if (!combateId) throw new Error("no se pudo iniciar combate real");

    room.send("combate:comenzarYa", { combateId });
    const llegoPortal = await esperarCondicion(() => portalArena?.combateId === combateId, 3000, 100);
    comprobar(!!llegoPortal, "comenzarYa cierra la ventana e instancia la arena", JSON.stringify(portalArena));

    room.leave(); // Jarl se va SOLO — sin fix, esto autodispone la DungeonRoom de origen
    await esperar(300);
    const arena = await client.joinOrCreate("arena", { name: "Jarl", combateId });
    await esperarCondicion(() => arena.state?.combates?.get(combateId)?.fase === "activo", 3000, 100);
    comprobar(arena.state.combates.get(combateId)?.fase === "activo", "la arena monta el combate activo");

    // godMode vive en el Player.godMode de CADA room — no viaja de la room de
    // origen a la arena (ArenaCombateRoom crea su propio Player en onJoin).
    arena.send("admin:debug:godMode", { activo: true });
    await esperar(300);

    let errorArena = null;
    arena.onMessage("combate:error", (m2) => { errorArena = m2; });
    let portalVuelta = null;
    arena.onMessage("portal:ir", (m2) => (portalVuelta = m2));

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
    comprobar(objetivoMuerto, "el enemigo muere en combate real (godMode: Jarl nunca pierde vida)", `rondas=${rondas}`);
    await esperar(2000); // margen generoso para el aplicarResultadoRemoto "void" (fire-and-forget) de ArenaCombateRoom.ts
    comprobar(!!portalVuelta, "portal:ir llega tras ganar", JSON.stringify(portalVuelta));
    arena.leave();
    await esperar(500);

    // La comprobación real del bug: en la VENTANA vulnerable (entre
    // `room.leave()` justo antes de la arena y aquí, ya con el combate
    // resuelto) la DungeonRoom original NUNCA debió recrearse — si el
    // autoDispose por defecto la hubiera destruido a medio combate,
    // aparecería una SEGUNDA línea "Interior ..." ya en este punto (nadie
    // volvió a entrar todavía). Que Colyseus la disponga DESPUÉS de esto,
    // ya sin nadie dentro y sin combate pendiente (`quitarMarcadorCombate`
    // lo hace a propósito, vía `disconnect()`), es correcto y esperado —
    // no es lo que este e2e vigila.
    const vecesTrasResolver = (logServidor.match(/Interior "cueva_goblins_e2e-solo-\d+"/g) || []).length;
    comprobar(vecesTrasResolver === 1, "la DungeonRoom de origen NO se recreó durante la ventana vulnerable (combate en curso, 0 clientes)", `veces=${vecesTrasResolver}`);

    console.log("4) reentrando a la MISMA mazmorra — ya con la limpieza aplicada, sin repoblar (aunque Colyseus haya dispuesto la instancia anterior al quedarse sin nada pendiente)...");
    room = await client.joinOrCreate("mazmorra", opcionesJoin());
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.enemigos, 5000, 100);
    comprobar(room.state.enemigos.size === 0, "el resultado del combate remoto SÍ se aplicó sobre la room de origen real (nunca se repuebla)", `size=${room.state.enemigos.size}`);
    room.leave();
    await esperar(300);
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

  console.log(fallos === 0 ? "\n✅ combateSoloMantieneRoom.e2e: todo OK" : `\n❌ combateSoloMantieneRoom.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
