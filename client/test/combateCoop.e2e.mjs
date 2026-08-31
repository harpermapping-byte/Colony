// E2E de combate PvE COOPERATIVO (docs/GDD_Combate.md §9.1): dos clientes
// colyseus.js REALES (sin navegador — solo hace falta comprobar mensajes/
// estado replicado, no render, mismo criterio que combate.e2e.mjs) contra un
// servidor Colyseus real sobre el mapa DEMO (pequeño — el mapa PRINCIPAL
// dejó esto pendiente la vez pasada porque la fauna estaba a 17-24 casillas
// del spawn del Hub, fuera de RADIO_INTERACCION).
//
// Diagnóstico previo (2026-08-31): el bake del mapa demo solo trae 2
// animales (erizo + arrendajo, ninguno "peligroso") — sin fauna peligrosa NO
// hay nada que probar aquí, porque fauna no peligrosa entra en "modo caza"
// (docs/GDD_Caza.md), que cierra la ventana de unión de forma SÍNCRONA
// dentro del propio mensaje combate:iniciar y es estrictamente 1 vs 1 (nadie
// más puede unirse). Solución: mismo atajo que server/test/agroFauna.e2e.mjs
// — siembra directa en la fila `fauna_salvaje` de la BD sqlite (bypass del
// BAKE, nunca del PROTOCOLO de combate en sí) de una avispa_comun
// (peligroso:true, radioAgro=1, catálogo real) a ~1.4 casillas del spawn del
// Hub — dentro de RADIO_INTERACCION (2.2, así ninguno de los 2 jugadores
// necesita caminar) pero FUERA de su radioAgro (1, así el agro automático de
// verificarAgroFauna NUNCA dispara antes que el combate:iniciar manual del
// jugador — a diferencia de jabalí/lobo/lince, cuyo radioAgro 4-6 > 2.2
// habría ganado la carrera casi siempre). vidaMaxima=25 real del catálogo:
// combate corto, sin maratón.
//   node test/combateCoop.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const PUERTO_WS = 2596;
const BD_RUTA = join(tmpdir(), "colony_combate_coop_e2e.sqlite");

rmSync(BD_RUTA, { force: true });

console.log("0) sembrando BD sqlite temporal (una avispa_comun peligrosa cerca del spawn del demo)...");
{
  // Mismo esquema exacto que server/src/datos/bd.ts (fauna_salvaje) y mismo
  // truco de ultima_comida/ultima_bebida que agroFauna.e2e.mjs: un valor
  // muy en el FUTURO hace "ahora - ultima" negativo, nunca > ventana =
  // "recién comida/bebida" sin replicar aquí el reloj de mundo real.
  const bd = new DatabaseSync(BD_RUTA);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0,
      vida INTEGER NOT NULL DEFAULT 100,
      vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS fauna_salvaje (
      id TEXT PRIMARY KEY,
      mapa_id TEXT NOT NULL,
      sector_x INTEGER NOT NULL,
      sector_y INTEGER NOT NULL,
      especie_id TEXT NOT NULL,
      sexo TEXT NOT NULL,
      etapa TEXT NOT NULL DEFAULT 'adulto',
      estado TEXT NOT NULL DEFAULT 'vivo',
      x REAL NOT NULL,
      y REAL NOT NULL,
      ultima_comida REAL NOT NULL,
      ultima_bebida REAL NOT NULL,
      gestando_desde REAL,
      gestacion_duracion_dias REAL,
      nacio_en REAL,
      vida REAL NOT NULL DEFAULT 0,
      vida_max REAL NOT NULL DEFAULT 0,
      ataque REAL NOT NULL DEFAULT 0
    );
  `);
  const ahora = 999999;
  // spawn real del Hub en el demo (confirmado, client/test/mecanicas.e2e.mjs)
  // es (30.5,18.5) — (31.5,19.5) es tierra libre confirmada aparte (terreno
  // "cesped", sin prop encima) a hypot(1,1)=1.41 casillas: dentro de
  // RADIO_INTERACCION (2.2) pero fuera del radioAgro=1 de avispa_comun.
  bd.prepare(`
    INSERT INTO fauna_salvaje
      (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y, ultima_comida, ultima_bebida, vida, vida_max, ataque)
    VALUES
      ('demo:0:0:1', 'demo', 0, 0, 'avispa_comun', 'hembra', 'adulto', 'vivo', 31.5, 19.5, ?, ?, 25, 25, 4)
  `).run(ahora, ahora);
  bd.close();
}

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirRaiz, "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA });
const matar = () => {
  try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
  try { servidor.kill("SIGKILL"); } catch {}
};
process.on("exit", () => { matar(); rmSync(BD_RUTA, { force: true }); });

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}
function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
/** Camina mandando "input" normalizado hacia `objetivoFn()` hasta estar a `radio` — solo se usa como red de seguridad si la geometría asumida (spawn/arena) no cuadrase exactamente. */
async function caminarHacia(room, propio, objetivoFn, radio, timeoutMs) {
  return esperarCondicion(() => {
    const obj = objetivoFn();
    if (!obj) return true;
    const dx = obj.x - propio.x, dy = obj.y - propio.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= radio) { room.send("input", { x: 0, y: 0 }); return true; }
    const norma = dist || 1;
    room.send("input", { x: dx / norma, y: dy / norma });
    return false;
  }, timeoutMs, 100);
}

try {
  await esperar(4000); // arranque del servidor

  const clientA = new Client(`ws://localhost:${PUERTO_WS}`);
  const clientB = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomA = await clientA.joinOrCreate("hub", { name: "CoopA" });
  const roomB = await clientB.joinOrCreate("hub", { name: "CoopB" });
  console.log(`Conectados: A=${roomA.sessionId} B=${roomB.sessionId} (room ${roomA.roomId})`);
  comprobar("A y B están en la MISMA room del Hub", roomA.roomId === roomB.roomId, `A=${roomA.roomId} B=${roomB.roomId}`);

  await esperarCondicion(() => roomA.state?.fauna && roomA.state?.players && roomB.state?.fauna && roomB.state?.players, 5000, 100);
  const propioA = roomA.state.players.get(roomA.sessionId);
  const propioB = roomB.state.players.get(roomB.sessionId);
  console.log(`  spawn A=(${propioA.x.toFixed(1)},${propioA.y.toFixed(1)}) spawn B=(${propioB.x.toFixed(1)},${propioB.y.toFixed(1)})`);

  // 1) esperar a que la fauna sembrada active su sector (GestorFaunaSalvaje.
  // actualizarPorJugadores cada 8s en HubRoom) — determinista: es la ÚNICA
  // fauna que puede aparecer (sembrar fauna_salvaje hace que resolverSector
  // NO relea el bake original, ver cabecera).
  const objetivoId = await esperarCondicion(() => {
    for (const [id, f] of roomA.state.fauna.entries()) {
      if (f.especieId === "avispa_comun") return id;
    }
    return null;
  }, 20000, 500);
  comprobar("la avispa_comun sembrada activa su sector y aparece en state.fauna", !!objetivoId, objetivoId ?? "no apareció en 20s");
  if (!objetivoId) throw new Error("sin fauna sembrada activa, no se puede seguir");

  const faunaObj = roomA.state.fauna.get(objetivoId);
  const distA = Math.hypot(faunaObj.x - propioA.x, faunaObj.y - propioA.y);
  console.log(`  objetivo=${objetivoId} especie=${faunaObj.especieId} vida=${faunaObj.vida} a ${distA.toFixed(2)} casillas de A (RADIO_INTERACCION=2.2, radioAgro=1: no debería haber disparado agro solo)`);
  comprobar("la avispa NO disparó agro por su cuenta todavía (fase pendiente exige que la abra el jugador)", ![...roomA.state.combates.values()].some((c) => c.unidades.has(objetivoId)));

  // 2) A manda combate:iniciar de verdad — el camino MANUAL que pide el
  // streamer (a diferencia de jabalí/lobo, aquí no compite con el agro
  // automático: distA > radioAgro=1 por diseño de la siembra).
  let errorA = null;
  roomA.onMessage("combate:error", (msg) => { errorA = msg; console.log("  A combate:error", msg); });
  roomA.send("combate:iniciar", { objetivoId });
  await esperar(400);
  if (errorA?.motivo === "demasiado lejos") {
    // empuje PJ-PJ (docs/GDD_Mecanicas.md): A y B spawnean en el MISMO punto
    // exacto, así que el servidor los separa un poco tras el join — red de
    // seguridad, mismo patrón que la de B más abajo.
    console.log("  A estaba fuera de RADIO_INTERACCION de la fauna (empuje PJ-PJ al spawnear ambos superpuestos) — red de seguridad: caminando...");
    await caminarHacia(roomA, propioA, () => roomA.state.fauna.get(objetivoId), 2.0, 15000);
    errorA = null;
    roomA.send("combate:iniciar", { objetivoId });
    await esperar(400);
  }

  const combateId = await esperarCondicion(() => {
    for (const [id, c] of roomA.state.combates.entries()) {
      if (c.unidades.has(objetivoId)) return id;
    }
    return null;
  }, 3000, 100);
  comprobar("combate:iniciar (manual, de A) abre un combate con ventana de unión", !!combateId, errorA ? JSON.stringify(errorA) : (combateId ?? "sin combateId"));
  if (!combateId) throw new Error("no se pudo abrir combate contra la fauna sembrada");
  const combateInicial = roomA.state.combates.get(combateId);
  comprobar("el combate arranca en fase 'pendiente' (ventana de unión de 60s)", combateInicial?.fase === "pendiente", combateInicial?.fase);
  comprobar("A ya está dentro como unidad del bando A", combateInicial?.unidades?.get(roomA.sessionId)?.bando === "A");

  // 3) B se une con combate:unirse real — B exige estar a RADIO_INTERACCION
  // del CENTRO de la arena (no de A ni de la fauna). Con A parado en el
  // spawn (nunca caminó) el centro cae casi sobre el propio spawn — B no
  // debería necesitar caminar; si por algún motivo la geometría no
  // cuadrase, hay una red de seguridad de reintento caminando.
  const centroArena = { x: combateInicial.gx0 + combateInicial.ancho / 2, y: combateInicial.gy0 + combateInicial.alto / 2 };
  console.log(`  centro de arena=(${centroArena.x.toFixed(1)},${centroArena.y.toFixed(1)}), B en (${propioB.x.toFixed(1)},${propioB.y.toFixed(1)}), dist=${Math.hypot(centroArena.x - propioB.x, centroArena.y - propioB.y).toFixed(2)}`);

  let errorB = null;
  roomB.onMessage("combate:error", (msg) => { errorB = msg; console.log("  B combate:error", msg); });
  roomB.send("combate:unirse", { combateId });
  await esperar(400);
  if (errorB?.motivo === "demasiado lejos") {
    console.log("  B estaba fuera de RADIO_INTERACCION del centro de arena (geometría inesperada) — red de seguridad: caminando hacia el centro...");
    await caminarHacia(roomB, propioB, () => centroArena, 2.0, 15000);
    errorB = null;
    roomB.send("combate:unirse", { combateId });
    await esperar(400);
  }

  // 4) confirmar que AMBOS clientes (conexiones/estados replicados
  // INDEPENDIENTES) ven a B dentro del MISMO combate.
  const vistoPorA = await esperarCondicion(() => {
    const c = roomA.state.combates.get(combateId);
    return c && c.unidades.has(roomB.sessionId) ? c : null;
  }, 5000, 100);
  comprobar("A ve a B en el combate tras combate:unirse (estado replicado de A)", !!vistoPorA, errorB ? JSON.stringify(errorB) : "B no apareció en el estado de A");
  const vistoPorB = roomB.state.combates.get(combateId);
  comprobar("B se ve a sí mismo en el combate (estado replicado de B, independiente del de A)", !!vistoPorB?.unidades?.has(roomB.sessionId));
  if (vistoPorA) {
    comprobar("el bando de B es el MISMO que el de A (co-op contra la fauna, no PvP)", vistoPorA.unidades.get(roomB.sessionId)?.bando === vistoPorA.unidades.get(roomA.sessionId)?.bando, `A=${vistoPorA.unidades.get(roomA.sessionId)?.bando} B=${vistoPorA.unidades.get(roomB.sessionId)?.bando}`);
  }

  // 5) cerrar la ventana ya (comenzarYa) — portal:ir debe llegar a LOS DOS.
  let portalA = null, portalB = null;
  roomA.onMessage("portal:ir", (m) => (portalA = m));
  roomB.onMessage("portal:ir", (m) => (portalB = m));
  roomA.send("combate:comenzarYa", { combateId });

  const llegaronAmbos = await esperarCondicion(() => portalA?.combateId === combateId && portalB?.combateId === combateId, 3000, 100);
  comprobar("AMBOS jugadores reciben portal:ir hacia la MISMA arena (mismo combateId)", !!llegaronAmbos, JSON.stringify({ portalA, portalB }));
  comprobar("el combate desaparece del Hub (se fue a la arena)", !roomA.state.combates.has(combateId));

  roomA.leave(); roomB.leave();
  await esperar(300);

  const arenaA = await clientA.joinOrCreate("arena", { name: "CoopA", combateId });
  const arenaB = await clientB.joinOrCreate("arena", { name: "CoopB", combateId });
  comprobar("A y B aterrizan en la MISMA room de arena", arenaA.roomId === arenaB.roomId, `A=${arenaA.roomId} B=${arenaB.roomId}`);

  await esperarCondicion(() => arenaA.state?.combates?.get(combateId)?.fase === "activo" && arenaB.state?.combates?.get(combateId)?.fase === "activo", 3000, 100);
  const cA0 = arenaA.state.combates.get(combateId), cB0 = arenaB.state.combates.get(combateId);
  comprobar("la arena monta el combate activo, visto por A", cA0?.fase === "activo");
  comprobar("la arena monta el combate activo, visto por B (estado replicado propio)", cB0?.fase === "activo");
  const idsA = cA0 ? [...cA0.unidades.keys()].sort() : [];
  const idsB = cB0 ? [...cB0.unidades.keys()].sort() : [];
  comprobar(
    "AMBOS ven las MISMAS 3 unidades (A, B y la fauna sintética recreada con el mismo id)",
    idsA.length === 3 && JSON.stringify(idsA) === JSON.stringify(idsB) && idsA.includes(arenaA.sessionId) && idsA.includes(arenaB.sessionId) && idsA.includes(objetivoId),
    `A ve [${idsA}] B ve [${idsB}]`,
  );
  comprobar("AMBOS ven el MISMO orden de turnos (ordenTurnos idéntico)", JSON.stringify([...(cA0?.ordenTurnos ?? [])]) === JSON.stringify([...(cB0?.ordenTurnos ?? [])]), `A=${JSON.stringify([...(cA0?.ordenTurnos ?? [])])} B=${JSON.stringify([...(cB0?.ordenTurnos ?? [])])}`);

  let errorArenaA = null, errorArenaB = null;
  arenaA.onMessage("combate:error", (msg) => { errorArenaA = msg; });
  arenaB.onMessage("combate:error", (msg) => { errorArenaB = msg; });
  let portalVueltaA = null, portalVueltaB = null;
  arenaA.onMessage("portal:ir", (m) => (portalVueltaA = m));
  arenaB.onMessage("portal:ir", (m) => (portalVueltaB = m));

  // 6) jugar rondas — A y B atacan cuando les toca (la fauna la resuelve el
  // servidor solo). vidaMaxima real de avispa_comun=25 (catálogo): combate
  // corto a propósito. Confirmar al menos una vez que un golpe de daño se
  // ve IDÉNTICO en los 2 estados replicados (turnos sincronizados de
  // verdad) y seguir hasta la resolución completa.
  const vidaInicialObjetivo = cA0?.unidades?.get(objetivoId)?.hp ?? 0;
  let sincronizadoTrasGolpe = false;
  let sincronizadoTrasGolpeHp = null;
  let objetivoMuerto = false;
  let rondas = 0;
  while (rondas < 120) {
    rondas++;
    const combate = arenaA.state.combates.get(combateId);
    if (!combate) { objetivoMuerto = true; break; }
    const idActual = combate.ordenTurnos[combate.turnoActual];

    if (idActual === arenaA.sessionId || idActual === arenaB.sessionId) {
      const esA = idActual === arenaA.sessionId;
      const propiaArena = esA ? arenaA : arenaB;
      const objetivo = combate.unidades.get(objetivoId);
      if (!objetivo) { objetivoMuerto = true; break; }
      if (esA) errorArenaA = null; else errorArenaB = null;
      propiaArena.send("combate:accion", { combateId, objetivoId });
      await esperar(150);
      const err = esA ? errorArenaA : errorArenaB;
      if (err?.motivo === "fuera de alcance") {
        // Varios candidatos de movimiento, no solo el paso directo hacia el
        // objetivo: con 2 jugadores conviviendo en una arena pequeña, la
        // celda "directa" puede estar OCUPADA por el otro jugador (bug real
        // encontrado aquí: repetir siempre el mismo candidato ocupado se
        // queda atascado para siempre en "casilla no alcanzable con tu
        // PA") — igual que rodearía un jugador de verdad, se prueban
        // varias celdas vecinas libres antes de rendirse esta ronda.
        const propia = combate.unidades.get(idActual);
        const dx = Math.sign(objetivo.gx - propia.gx), dy = Math.sign(objetivo.gy - propia.gy);
        const ocupadas = new Set(
          [...combate.unidades.entries()].filter(([k, u]) => k !== idActual && u.estado === "activo").map(([, u]) => `${u.gx},${u.gy}`),
        );
        const candidatos = [];
        const add = (ox, oy) => {
          if (!ox && !oy) return;
          const gx = propia.gx + ox, gy = propia.gy + oy;
          if (ocupadas.has(`${gx},${gy}`)) return;
          if (!candidatos.some((c) => c.gx === gx && c.gy === gy)) candidatos.push({ gx, gy });
        };
        add(dx, dy); add(dx, 0); add(0, dy); add(dx, -dy); add(-dx, dy);
        if (candidatos.length === 0) candidatos.push({ gx: propia.gx + dx, gy: propia.gy + dy }); // último recurso: que decida el servidor
        for (const cand of candidatos) {
          if (esA) errorArenaA = null; else errorArenaB = null;
          propiaArena.send("combate:mover", { combateId, gx: cand.gx, gy: cand.gy });
          await esperar(150);
          if (!(esA ? errorArenaA : errorArenaB)) break;
        }
      }
      const propiaActual = arenaA.state.combates.get(combateId)?.unidades.get(idActual);
      const errAhora = esA ? errorArenaA : errorArenaB;
      if (!propiaActual || propiaActual.pa <= 0 || errAhora?.motivo === "sin PA suficiente") {
        propiaArena.send("combate:pasarTurno", { combateId });
        await esperar(150);
      }
    } else {
      await esperar(150); // turno de la fauna (IA) o el estado aún no llegó
      continue;
    }

    if (!sincronizadoTrasGolpe) {
      const objA = arenaA.state.combates.get(combateId)?.unidades?.get(objetivoId);
      const objB = arenaB.state.combates.get(combateId)?.unidades?.get(objetivoId);
      if (objA && objB && objA.hp === objB.hp && objA.hp < vidaInicialObjetivo) {
        sincronizadoTrasGolpeHp = objA.hp;
        sincronizadoTrasGolpe = true;
      }
    }
  }
  comprobar(
    "tras un golpe, A y B ven EXACTAMENTE la misma vida restante del objetivo (turnos sincronizados de verdad)",
    sincronizadoTrasGolpe,
    sincronizadoTrasGolpe ? `hp=${sincronizadoTrasGolpeHp} (inicial ${vidaInicialObjetivo})` : "el objetivo nunca bajó de vida de forma visible en ambos estados a la vez (o murió de un solo golpe)",
  );
  comprobar("el combate co-op termina (el objetivo muere o el combate se borra del Map)", objetivoMuerto, `rondas jugadas=${rondas}`);

  await esperar(400);
  comprobar("A recibe portal:ir de vuelta al Hub tras ganar", portalVueltaA?.tipo === "volverDeCombate" && portalVueltaA?.sala === "hub", JSON.stringify(portalVueltaA));
  comprobar("B recibe portal:ir de vuelta al Hub tras ganar", portalVueltaB?.tipo === "volverDeCombate" && portalVueltaB?.sala === "hub", JSON.stringify(portalVueltaB));

  arenaA.leave(); arenaB.leave();
  await esperar(300);

  const hubVueltaA = await clientA.joinOrCreate("hub", { name: "CoopA" });
  const hubVueltaB = await clientB.joinOrCreate("hub", { name: "CoopB" });
  await esperar(300);
  comprobar("el objetivo desaparece de state.fauna del Hub, visto por A", !hubVueltaA.state.fauna.has(objetivoId));
  comprobar("el objetivo desaparece de state.fauna del Hub, visto por B", !hubVueltaB.state.fauna.has(objetivoId));
  hubVueltaA.leave(); hubVueltaB.leave();
} catch (err) {
  console.error("ERROR en el smoke test:", err);
  fallos++;
} finally {
  matar();
  rmSync(BD_RUTA, { force: true });
}

console.log(fallos === 0 ? "\n✅ combateCoop.e2e: todo OK" : `\n❌ combateCoop.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
