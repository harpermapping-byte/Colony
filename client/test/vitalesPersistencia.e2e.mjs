// E2E de persistencia de vitales (docs/GDD_Personaje.md §2, pedido
// 2026-09-01: "que persista en desconexiones o F5 que lo haga") — mismo
// patrón que combate.e2e.mjs: servidor Colyseus REAL + cliente colyseus.js
// plano (sin navegador). Drena estamina de verdad corriendo (sprint gasta
// ESTAMINA_GASTO_POR_SEG_CORRIENDO=15/seg — vaciar ~2s da una caída grande
// y rápida de observar, nada de esperar el decaimiento lento por hora de
// comida/bebida/sueño), se desconecta, y comprueba que el valor sobrevive
// al reconectar con el MISMO nombre — antes de esta pasada, un jugador
// nuevo/reconectado SIEMPRE arrancaba en 100/100/100/100, sin persistencia.
//   node test/vitalesPersistencia.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2599;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
// BD_RUTA=:memory: — la persistencia se prueba DENTRO de la vida del mismo
// proceso servidor (desconectar/reconectar el CLIENTE, nunca reiniciar el
// servidor), así que in-memory basta y no ensucia datos.sqlite de dev.
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

  const NOMBRE = "VitalTester";
  const client = new Client(`ws://localhost:${PUERTO_WS}`);
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await esperarCondicion(() => room.state && room.state.players?.get(room.sessionId), 5000, 100);
  const propio = () => room.state.players.get(room.sessionId);

  comprobar(
    "jugador nuevo nace con estamina 100 (base del Schema)",
    propio()?.vitales?.estamina === 100,
    `estamina=${propio()?.vitales?.estamina}`,
  );

  // 1) Sprint ~2.5s en tierra para drenar estamina de verdad (15/seg ->
  // debería bajar unos 35-40 puntos) — dirección fija, el demo map es tierra
  // alrededor del spawn (mismo terreno que ya camina combate.e2e.mjs).
  console.log("1) corriendo ~2.5s para drenar estamina...");
  room.send("input", { x: 1, y: 0, correr: true });
  await esperar(2500);
  room.send("input", { x: 0, y: 0, correr: false });
  await esperar(300); // margen para que el último patch de vuelta llegue

  const estaminaTrasCorrer = propio()?.vitales?.estamina;
  comprobar(
    "correr baja la estamina de verdad (no queda en 100)",
    typeof estaminaTrasCorrer === "number" && estaminaTrasCorrer < 90,
    `estamina tras correr=${estaminaTrasCorrer}`,
  );

  // 2) Desconectar — onLeave debe guardar SIN esperar (awaited server-side).
  console.log("2) desconectando (room.leave, simula cierre de pestaña/F5)...");
  room.leave();
  await esperar(500);

  // 3) Reconectar con el MISMO nombre — sin persistencia, el Schema nuevo
  // arrancaría siempre en 100. Con persistencia, debe salir con el valor
  // guardado en el paso 1 (tolerancia pequeña: el jugador nuevo ya decae
  // comida/bebida/sueño en el rato que pasa, pero estamina solo baja
  // corriendo, así que debe llegar EXACTO salvo redondeo).
  console.log("3) reconectando con el mismo nombre...");
  const room2 = await client.joinOrCreate("hub", { name: NOMBRE });
  await esperarCondicion(() => room2.state && room2.state.players?.get(room2.sessionId), 5000, 100);
  // La carga es best-effort/asíncrona dentro de onJoin (ver HubRoom.ts) —
  // el Schema nace en 100 y se corrige en cuanto la promesa de BD resuelve;
  // hay que esperar a que el valor persistido reemplace al default antes de comprobar.
  const estaminaTrasReconectar = await esperarCondicion(() => {
    const v = room2.state.players.get(room2.sessionId)?.vitales?.estamina;
    return typeof v === "number" && v < 99 ? v : null;
  }, 5000, 100);

  comprobar(
    "tras reconectar con el mismo nombre, la estamina persistida sobrevive (no vuelve a 100)",
    typeof estaminaTrasReconectar === "number" && Math.abs(estaminaTrasReconectar - estaminaTrasCorrer) < 1,
    `esperada≈${estaminaTrasCorrer}, real=${estaminaTrasReconectar}`,
  );

  room2.leave();
} catch (err) {
  console.error("ERROR en el smoke test:", err);
  fallos++;
} finally {
  matar();
}

console.log(fallos === 0 ? "\n✅ vitalesPersistencia.e2e: todo OK" : `\n❌ vitalesPersistencia.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
