// E2E de chat entre jugadores (docs/GDD_Mecanicas.md §5.12, pedido
// 2026-09-02: "literalmente no existe ningún canal local/global para que
// dos jugadores se hablen" — hueco real señalado por el streamer, el único
// "hablar" que existía era npc:hablar con IA). Arranca el servidor Colyseus
// REAL contra el mapa demo y conecta DOS clientes al mismo Hub. Cubre:
//   1) canal "global": los dos reciben el mensaje aunque estén lejos.
//   2) canal "local": solo llega a quien esté dentro de RADIO_CHAT_LOCAL —
//      se aleja a B caminando de verdad (input real, no un teleport de
//      prueba) hasta quedar fuera de rango y se confirma que deja de
//      recibir los mensajes locales de A (pero sigue recibiendo los
//      globales).
//   3) rate-limit: dos mensajes seguidos sin esperar CHAT_COOLDOWN_MS —
//      el segundo se rechaza con chat:error.
//   4) atribución server-authoritative: `nombre` es el de player.name real,
//      nunca lo que mande el cliente en el payload (el payload ni siquiera
//      lo acepta).
//   node test/chat.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2601;

function lanzar(cmd, args, cwd, extraEnv) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS),
  RUTA_MAPA: rutaDemo,
  BD_RUTA: ":memory:",
});
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
function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }
/** Colecciona TODOS los mensajes de `tipo` que lleguen en `ventanaMs`, sin resolver antes (a diferencia de esperarMensaje de otros e2e, aquí hace falta saber si NO llegó nada). */
function recolectar(room, tipo, ventanaMs) {
  const recibidos = [];
  const off = room.onMessage(tipo, (m) => recibidos.push(m));
  return esperar(ventanaMs).then(() => { off(); return recibidos; });
}

try {
  await esperar(3000); // arranque del servidor

  const clienteA = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: "Astrid" });
  const clienteB = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: "Bjorn" });
  await esperar(500);
  comprobar("A y B en el mismo Hub", roomA.state.players.size === 2, `size=${roomA.state.players.size}`);

  // 1) Global: A habla, B (mismo punto de spawn, cerca) lo recibe.
  {
    const rxB = recolectar(roomB, "chat:mensaje", 800);
    roomA.send("chat:mensaje", { texto: "hola a todos", canal: "global" });
    const recibidos = await rxB;
    comprobar("global: B recibe el mensaje de A", recibidos.length === 1, JSON.stringify(recibidos));
    comprobar("global: nombre viene del server (player.name), no inventado", recibidos[0]?.nombre === "Astrid", recibidos[0]?.nombre);
    comprobar("global: texto llega tal cual", recibidos[0]?.texto === "hola a todos", recibidos[0]?.texto);
  }

  await esperar(700); // fuera de la ventana de rate-limit antes de la siguiente sección

  // 2) Local: recién unidos (mismo spawn), un mensaje local SÍ llega a B.
  {
    const rxB = recolectar(roomB, "chat:mensaje", 800);
    roomA.send("chat:mensaje", { texto: "cerca todavía", canal: "local" });
    const recibidos = await rxB;
    comprobar("local (cerca): B SÍ recibe el mensaje de A", recibidos.length === 1, JSON.stringify(recibidos));
  }

  await esperar(700);

  // 3) Aleja a B caminando de verdad (input real, servidor autoritativo)
  // hasta salir del radio de chat local, luego confirma que un mensaje
  // LOCAL de A ya no le llega, pero uno GLOBAL sigue llegando. El mapa demo
  // tiene mobiliario/paredes reales (no es una sala vacía) — prueba varias
  // direcciones por si una está bloqueada tras un par de casillas, en vez
  // de asumir una sola línea recta libre.
  function posB() { return roomA.state.players.get(roomB.sessionId); }
  function distanciaActual() {
    const a = roomA.state.players.get(roomA.sessionId);
    const b = posB();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  // El mapa demo tiene mobiliario real cerca del spawn (no una sala vacía):
  // "seguir la pared" en vez de asumir una línea recta libre — si una
  // dirección deja de avanzar (bloqueada), prueba la siguiente SIN volver
  // sobre una que ya deshaga lo andado. Diagonales incluidas para colarse
  // por esquinas. Tope de legs para no colgar el test si el mapa cambiara.
  const direcciones = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: -1 }];
  let dirIdx = 0;
  for (let leg = 0; leg < 12 && distanciaActual() <= 20; leg++) {
    const antes = { ...posB() };
    roomB.send("input", direcciones[dirIdx % direcciones.length]);
    await esperar(2000);
    const despues = posB();
    const avanzo = Math.hypot(despues.x - antes.x, despues.y - antes.y) > 1;
    if (!avanzo) dirIdx++; // esta dirección está bloqueada de verdad, prueba la siguiente
  }
  roomB.send("input", { x: 0, y: 0 });
  await esperar(300);
  const distancia = distanciaActual();
  comprobar("B se alejó de A lo suficiente (>20 casillas)", distancia > 20, `distancia=${distancia.toFixed(1)}`);

  {
    const rxB = recolectar(roomB, "chat:mensaje", 800);
    roomA.send("chat:mensaje", { texto: "ya lejos, local", canal: "local" });
    const recibidos = await rxB;
    comprobar("local (lejos): B YA NO recibe el mensaje de A", recibidos.length === 0, JSON.stringify(recibidos));
  }

  await esperar(700);

  {
    const rxB = recolectar(roomB, "chat:mensaje", 800);
    roomA.send("chat:mensaje", { texto: "ya lejos, global", canal: "global" });
    const recibidos = await rxB;
    comprobar("global (lejos): B SIGUE recibiendo (global no filtra por distancia)", recibidos.length === 1, JSON.stringify(recibidos));
  }

  await esperar(700);

  // 4) Rate-limit: dos mensajes seguidos sin esperar el cooldown.
  {
    let error = null;
    const offErr = roomA.onMessage("chat:error", (m) => { error = m; });
    roomA.send("chat:mensaje", { texto: "primero", canal: "global" });
    roomA.send("chat:mensaje", { texto: "segundo, demasiado rápido", canal: "global" });
    await esperar(400);
    offErr();
    comprobar("rate-limit: el segundo mensaje inmediato se rechaza con chat:error", !!error, JSON.stringify(error));
  }

  // 5) Mensaje vacío/solo espacios no llega a nadie (ni error, simplemente se ignora).
  await esperar(700);
  {
    const rxB = recolectar(roomB, "chat:mensaje", 500);
    roomA.send("chat:mensaje", { texto: "   ", canal: "global" });
    const recibidos = await rxB;
    comprobar("mensaje vacío/solo espacios: no genera chat:mensaje", recibidos.length === 0, JSON.stringify(recibidos));
  }

  console.log(fallos === 0 ? "\n✅ chat.e2e: todo OK" : `\n❌ chat.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("chat.e2e reventó:", err);
  process.exit(1);
}
