// E2E de la integración con Twitch (docs/GDD_Twitch.md, pedido 2026-08-30):
// arranca el servidor Colyseus REAL, se conecta con un cliente colyseus.js
// plano como jarl (JARL_NOMBRES incluye el nombre del cliente), y prueba de
// punta a punta los disparadores de PRUEBA jarl-only (twitch:forzarDirecto,
// twitch:simularComando, twitch:simularCanje) — el conector real de Twitch
// (chatBot.ts/estadoDirecto.ts) no se puede probar sin credenciales reales,
// pero llama a las MISMAS funciones que estos disparadores, así que esto
// verifica el mecanismo entero salvo el transporte.
//   node test/twitch.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2599;
const NOMBRE_JARL = "TwitchTester";

function lanzar(cmd, args, cwd, extraEnv = {}) {
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
  JARL_NOMBRES: NOMBRE_JARL,
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

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function esperarMensaje(room, tipo, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage(tipo, (msg) => { clearTimeout(timer); resolve(msg); });
  });
}

try {
  await esperar(3000); // arranque del servidor

  const client = new Client(`ws://localhost:${PUERTO_WS}`);
  const room = await client.joinOrCreate("hub", { name: NOMBRE_JARL });
  console.log("Conectado a la room, sessionId =", room.sessionId);
  await esperar(500); // deja que el primer patch llegue (vitales/atributos replicados)

  // 1) forzar "en directo" (sin credenciales de Twitch configuradas)
  let respuestaDirecto = esperarMensaje(room, "twitch:directoForzado");
  room.send("twitch:forzarDirecto", { on: true });
  comprobar("twitch:forzarDirecto confirma on:true", (await respuestaDirecto)?.on === true);

  // 2) !cagar sube caca primero (comiendo no hay ración a mano en este smoke
  // test) — en vez de eso, comprobamos !curar bajando la vida a propósito
  // no es posible sin combate; probamos !comer/!beber/!cagar mirando que no
  // lancen error y que el vital quede al máximo.
  const propioAntes = room.state.players.get(room.sessionId);
  console.log(`  vitales antes: comida=${propioAntes.vitales.comida} bebida=${propioAntes.vitales.bebida} caca=${propioAntes.vitales.caca}`);

  room.send("twitch:simularComando", { comando: "!comer" });
  room.send("twitch:simularComando", { comando: "!beber" });
  await esperar(50); // corto a propósito: los vitales decaen en tiempo REAL sin pausa, un 300ms ya se nota
  const propioDespues = room.state.players.get(room.sessionId);
  comprobar("!comer deja comida cerca del máximo (100)", propioDespues.vitales.comida > 99.9, `comida=${propioDespues.vitales.comida}`);
  comprobar("!beber deja bebida cerca del máximo (100)", propioDespues.vitales.bebida > 99.9, `bebida=${propioDespues.vitales.bebida}`);

  // 3) !curar tras un golpe artificial (bajamos vida directamente no es
  // posible desde el cliente — probamos que el comando no rompe nada y que
  // vida queda igual a vidaMax, que ya lo estaba desde el spawn)
  room.send("twitch:simularComando", { comando: "!curar" });
  await esperar(200);
  const propioCurado = room.state.players.get(room.sessionId);
  comprobar("!curar deja vida == vidaMax", propioCurado.vida === propioCurado.vidaMax, `${propioCurado.vida}/${propioCurado.vidaMax}`);

  // 4) canje "malo" — cooldown de 5 min, el primero debe salir ok
  let respuestaCanje = esperarMensaje(room, "twitch:canjeado");
  room.send("twitch:simularCanje", { tipo: "malo" });
  const canje1 = await respuestaCanje;
  comprobar("primer canje 'malo' se acepta", !!canje1, JSON.stringify(canje1));
  if (canje1) console.log(`  evento elegido: ${canje1.eventoId} (${canje1.nombre})`);

  // 5) segundo canje 'malo' inmediato debe rechazarse por cooldown
  let respuestaError = esperarMensaje(room, "twitch:error");
  room.send("twitch:simularCanje", { tipo: "malo" });
  const error2 = await respuestaError;
  comprobar("segundo canje 'malo' inmediato se rechaza (cooldown)", error2?.motivo === "todavía en cooldown", JSON.stringify(error2));

  // 6) el pool 'bueno' NO comparte cooldown con 'malo' — debería aceptarse
  let respuestaCanjeBueno = esperarMensaje(room, "twitch:canjeado");
  room.send("twitch:simularCanje", { tipo: "bueno" });
  const canjeBueno = await respuestaCanjeBueno;
  comprobar("canje 'bueno' no bloqueado por el cooldown de 'malo'", !!canjeBueno, JSON.stringify(canjeBueno));
  if (canjeBueno) console.log(`  evento elegido: ${canjeBueno.eventoId} (${canjeBueno.nombre})`);

  // 7) Login con Twitch (docs/GDD_Twitch.md §7) — sin credenciales
  // configuradas en este smoke test, /auth/twitch/login debe responder algo
  // sensato (503, "no configurado") en vez de un 404 perdido entre las
  // rutas de Colyseus o tumbar el servidor.
  const rLogin = await fetch(`http://localhost:${PUERTO_WS}/auth/twitch/login`);
  comprobar("GET /auth/twitch/login sin credenciales responde 503", rLogin.status === 503, `status=${rLogin.status}`);

  // 8) unirse con un twitchSession INVENTADO no debe romper el join — cae
  // de vuelta a identidad por nombre de PJ, exactamente igual que sin login.
  const clienteConSesionFalsa = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomConSesionFalsa = await clienteConSesionFalsa.joinOrCreate("hub", { name: "SesionFalsa", twitchSession: "token_inventado_que_no_existe" });
  await esperar(300); // primer patch de estado
  comprobar("join con twitchSession inválido no rompe (cae a nombre de PJ)", !!roomConSesionFalsa.state?.players?.get(roomConSesionFalsa.sessionId));

  console.log(fallos === 0 ? "\n✅ twitch.e2e: todo OK" : `\n❌ twitch.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("twitch.e2e reventó:", err);
  process.exit(1);
}
