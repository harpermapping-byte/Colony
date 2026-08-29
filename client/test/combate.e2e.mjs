// E2E de combate táctico (docs/GDD_Combate.md, ✅ confirmado 2026-08-30):
// arranca el servidor Colyseus REAL sobre el mapa demo (tiene sectores de
// fauna salvaje bakeados), se conecta con un cliente colyseus.js plano (sin
// navegador — solo hace falta comprobar mensajes/estado, no render), inicia
// combate contra el primer animal salvaje que aparezca cerca del spawn, y lo
// juega hasta el final para comprobar que el flujo entero (turnos, daño,
// muerte, cadáver) funciona contra el servidor de verdad, no solo los tests
// puros de arenaCombate.ts.
//   node test/combate.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2598;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
// BD_RUTA=:memory: — aislado de server/datos.sqlite (el dev DB persistente):
// este smoke test MATA fauna de verdad (matarIndividuo, "nunca revive") y no
// debe ir agotando la población del mapa demo en el disco de cada dev/CI.
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: ":memory:" });
const matar = () => {
  try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
  try { servidor.kill("SIGKILL"); } catch {}
};
process.on("exit", matar);

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

try {
  await esperar(3000); // arranque del servidor

  const client = new Client(`ws://localhost:${PUERTO_WS}`);
  const room = await client.joinOrCreate("hub", { name: "ComTester" });
  console.log("Conectado a la room, sessionId =", room.sessionId);
  await esperarCondicion(() => room.state && room.state.fauna && room.state.players, 5000, 100);
  console.log("  state listo:", !!room.state, !!room.state?.fauna, !!room.state?.players);

  // 1) esperar a que aparezca algún animal salvaje cerca del spawn (la
  // activación de sector es asíncrona — GestorFaunaSalvaje.actualizarPorJugadores
  // corre cada 8s en HubRoom, ver src/rooms/HubRoom.ts).
  const objetivoId = await esperarCondicion(() => {
    const fauna = room.state.fauna;
    for (const [id] of fauna.entries()) return id;
    return null;
  }, 15000, 500);
  comprobar("aparece fauna salvaje activa cerca del spawn", !!objetivoId, objetivoId ?? "ninguna en 15s");
  if (!objetivoId) throw new Error("sin fauna, no se puede seguir el resto del smoke test");

  const vidaInicial = room.state.fauna.get(objetivoId).vida;
  console.log(`  objetivo=${objetivoId} vida=${vidaInicial}`);

  let errorRecibido = null;
  room.onMessage("combate:error", (msg) => { errorRecibido = msg; console.log("  combate:error", msg); });

  // 2) caminar hacia el objetivo hasta estar dentro de RADIO_INTERACCION
  // (2.2 casillas) — el spawn del jugador y el del animal no coinciden,
  // así que hace falta acercarse de verdad, igual que jugando.
  const propio = room.state.players.get(room.sessionId);
  const distanciaInicial = () => {
    const f = room.state.fauna.get(objetivoId);
    return f ? Math.hypot(f.x - propio.x, f.y - propio.y) : Infinity;
  };
  const llego = await esperarCondicion(() => {
    const f = room.state.fauna.get(objetivoId);
    if (!f) return false;
    const dx = f.x - propio.x, dy = f.y - propio.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 2.0) { room.send("input", { x: 0, y: 0 }); return true; }
    const norma = Math.hypot(dx, dy) || 1;
    room.send("input", { x: dx / norma, y: dy / norma });
    return false;
  }, 15000, 100);
  comprobar("el jugador llega a menos de RADIO_INTERACCION del objetivo", !!llego, `distancia final=${distanciaInicial().toFixed(2)}`);

  // 3) iniciar combate.
  room.send("combate:iniciar", { objetivoId });
  const combateId = await esperarCondicion(() => {
    for (const [id, c] of room.state.combates.entries()) {
      if (c.unidades.has(objetivoId)) return id;
    }
    return null;
  }, 3000, 100);
  comprobar("combate:iniciar crea un CombateSchema con las dos unidades", !!combateId, errorRecibido ? JSON.stringify(errorRecibido) : "sin combateId");
  if (!combateId) throw new Error("no se pudo iniciar combate (probablemente demasiado lejos del animal en el spawn de prueba)");

  // 4) jugar hasta que el objetivo muera o se agote el tope de rondas —
  // en cada turno propio: si el objetivo está en alcance, atacar; si no,
  // moverse un paso hacia él; si no es su turno, pasar turno y esperar.
  let rondas = 0;
  let objetivoMuerto = false;
  while (rondas < 80) {
    rondas++;
    const combate = room.state.combates.get(combateId);
    if (!combate) { objetivoMuerto = true; break; } // el combate ya se resolvió y se borró del Map
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== room.sessionId) {
      await esperar(150); // le toca a la IA (fauna) o el estado aún no llegó — el servidor la resuelve solo
      continue;
    }
    const propia = combate.unidades.get(room.sessionId);
    const objetivo = combate.unidades.get(objetivoId);
    if (!objetivo) { objetivoMuerto = true; break; }
    // El cliente NO conoce `alcance` (campo solo-servidor, deliberado — el
    // servidor es la única autoridad de si un golpe llega o no): intenta
    // atacar directamente y, si el servidor dice "fuera de alcance", se
    // acerca un paso — mismo patrón "pide y el servidor decide" del resto
    // del proyecto, ninguna lógica de alcance duplicada en el cliente.
    errorRecibido = null;
    room.send("combate:accion", { combateId, objetivoId });
    await esperar(150);
    if (errorRecibido?.motivo === "fuera de alcance") {
      const dx = Math.sign(objetivo.gx - propia.gx);
      const dy = Math.sign(objetivo.gy - propia.gy);
      room.send("combate:mover", { combateId, gx: propia.gx + dx, gy: propia.gy + dy });
      await esperar(150);
    }
    if (propia.ap <= 0 || propia.mp <= 0) {
      room.send("combate:pasarTurno", { combateId });
      await esperar(150);
    }
  }
  comprobar("el combate termina (el objetivo muere o el combate se borra del Map)", objetivoMuerto, `rondas jugadas=${rondas}`);
  const propioFinal = room.state.players.get(room.sessionId);
  console.log(`  vida del jugador al terminar: ${propioFinal.vida}/${propioFinal.vidaMax} (si bajó de 100, la IA de la fauna llegó a atacar)`);
  comprobar("el objetivo desaparece de state.fauna al morir (cadáver creado por matarIndividuo)", !room.state.fauna.has(objetivoId));

  room.leave();
} catch (err) {
  console.error("ERROR en el smoke test:", err);
  fallos++;
} finally {
  matar();
}

console.log(fallos === 0 ? "\n✅ combate.e2e: todo OK" : `\n❌ combate.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
