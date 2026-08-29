// E2E multi-jugador (revisión pedida 2026-08-30: "revisa todo lo que
// tenemos construido... testea varios players") — arranca el servidor
// Colyseus REAL y conecta DOS clientes colyseus.js a la vez contra el
// mismo Hub, algo que ningún E2E anterior probaba (todos usaban un único
// cliente). Cubre:
//   1) coexistencia básica: los dos se ven en state.players, sin cruzarse.
//   2) el bug real encontrado en esta revisión: identidad v1 no impide
//      nombres duplicados (docs/GDD_Twitch.md) — si dos jugadores entran
//      con el MISMO nombre y el primero se desconecta, el registro de
//      Twitch del segundo (que se queda jugando) NO debe desaparecer con
//      él (server/src/twitch/registro.ts:quitarJugador, corregido en esta
//      misma revisión).
//   node test/multijugador.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2600;
const NOMBRE_COMPARTIDO = "Ragnar"; // a propósito el MISMO para los dos clientes — el escenario del bug

function lanzar(cmd, args, cwd, extraEnv) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS),
  RUTA_MAPA: rutaDemo,
  BD_RUTA: ":memory:",
  JARL_NOMBRES: NOMBRE_COMPARTIDO, // los dos clientes son jarl (mismo nombre) — hace falta para twitch:simularComando
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
function esperarMensaje(room, tipo, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage(tipo, (msg) => { clearTimeout(timer); resolve(msg); });
  });
}

try {
  await esperar(3000); // arranque del servidor

  const clienteA = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomA = await clienteA.joinOrCreate("hub", { name: NOMBRE_COMPARTIDO });
  console.log("A conectado, sessionId =", roomA.sessionId);
  await esperar(300);

  const clienteB = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomB = await clienteB.joinOrCreate("hub", { name: NOMBRE_COMPARTIDO });
  console.log("B conectado, sessionId =", roomB.sessionId);
  await esperar(500);

  // 1) coexistencia: los dos se ven en el MISMO Hub (misma room, filterBy
  // de "hub" no distingue — es la room persistente única).
  comprobar("A ve 2 jugadores en state.players", roomA.state.players.size === 2, `size=${roomA.state.players.size}`);
  comprobar("B ve 2 jugadores en state.players", roomB.state.players.size === 2, `size=${roomB.state.players.size}`);
  comprobar("A y B tienen sessionId distinto", roomA.sessionId !== roomB.sessionId);

  // 2) forzar directo (jarl-only, cualquiera de los dos vale — comparten nombre)
  let respuestaDirecto = esperarMensaje(roomA, "twitch:directoForzado");
  roomA.send("twitch:forzarDirecto", { on: true });
  comprobar("twitch:forzarDirecto (desde A) confirma on:true", (await respuestaDirecto)?.on === true);

  // 3) A se desconecta — B debe seguir siendo capaz de usar comandos de
  // Twitch de PRUEBA (jarl-only) tras esto. Antes del fix, el onLeave de A
  // borraba el registro compartido por nombre y B se quedaba "invisible"
  // para gestorTwitch aunque siguiera jugando.
  roomA.leave();
  await esperar(500); // deja que el servidor procese onLeave

  comprobar("B sigue viendo su propia partida tras irse A", !!roomB.state.players.get(roomB.sessionId));

  // Prueba DECISIVA del fix (no basta con "cerca del máximo": comida decae
  // tan despacio que un valor cercano a 100 no distingue "se acaba de
  // rellenar" de "todavía no le ha dado tiempo a bajar mucho" — un falso OK
  // real que se coló en la primera versión de este test; y "exactamente
  // 100.0" TAMPOCO sirve: el tick de 30hz sigue decayendo el vital al
  // instante siguiente de rellenarlo, así que nunca se lee el 100.0 exacto
  // desde el cliente). Señal que sí es inequívoca: comida solo puede SUBIR
  // por un evento explícito (`restaurarVital`) — la decaída natural es
  // monótona a la baja. Si tras `!comer` el valor es MAYOR que justo antes
  // de mandarlo, el comando llegó de verdad; si el registro de B se hubiera
  // borrado por el leave de A (bug pre-fix), `!comer` sería un no-op
  // silencioso y comida solo podría haber seguido bajando.
  const comidaAntes = roomB.state.players.get(roomB.sessionId).vitales.comida;
  roomB.send("twitch:simularComando", { comando: "!comer" });
  await esperar(150); // margen para que llegue el siguiente patch (15/seg, ~66ms)
  const comidaDespues = roomB.state.players.get(roomB.sessionId).vitales.comida;
  comprobar("!comer (vía B) SUBE comida tras la desconexión de A (bug de registro corregido)", comidaDespues > comidaAntes, `${comidaAntes} -> ${comidaDespues}`);

  console.log(fallos === 0 ? "\n✅ multijugador.e2e: todo OK" : `\n❌ multijugador.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("multijugador.e2e reventó:", err);
  process.exit(1);
}
