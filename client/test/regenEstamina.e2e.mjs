// E2E de la regeneración real de estamina (docs/GDD_Personaje.md §3.4,
// pedido streamer 2026-09-13: "la stamina cuando paras de correr se
// recupera cada X segundos hasta llenarse, ahora se acaba y ya, eso hay
// que hacerlo y ver si al golpear o moverse se recupera menos"). Antes de
// esta pasada, `tickVitales` la regeneraba a VITAL_MAX/1h (~0.03/s) —
// invisible frente al gasto de sprint (15/s): en la práctica la estamina
// se quedaba vacía y NO se notaba que recuperase dentro de una sesión de
// juego real. Servidor Colyseus REAL + cliente colyseus.js plano (mismo
// patrón que vitalesPersistencia.e2e.mjs): sprinta para drenar, PARA del
// todo y confirma que sube rápido, luego CAMINA (sin sprint) y confirma
// que sigue subiendo pero más despacio que parado — nunca se queda plana.
//   node client/test/regenEstamina.e2e.mjs
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
  const room = await client.joinOrCreate("hub", { name: "RegenTester" });
  await esperarCondicion(() => room.state && room.state.players?.get(room.sessionId), 5000, 100);
  const propio = () => room.state.players.get(room.sessionId);

  console.log("1) corriendo ~3s para drenar estamina de sobra (deja margen sin tocar el tope)...");
  room.send("input", { x: 1, y: 0, correr: true });
  await esperar(3000);
  room.send("input", { x: 0, y: 0, correr: false });
  await esperar(250);
  const trasDrenar = propio()?.vitales?.estamina;
  comprobar("el sprint drena de verdad (bien por debajo de 100)", typeof trasDrenar === "number" && trasDrenar < 65, `estamina=${trasDrenar}`);

  console.log("2) PARADO del todo ~1.2s — antes se quedaba plana para siempre, ahora debe subir de verdad y rápido...");
  await esperar(1200);
  const trasQuieto = propio()?.vitales?.estamina;
  const subidaQuieto = trasQuieto - trasDrenar;
  comprobar("parado del todo, la estamina SUBE de verdad (ya no se queda plana)", subidaQuieto > 5, `subió ${subidaQuieto.toFixed(2)} (de ${trasDrenar.toFixed(2)} a ${trasQuieto.toFixed(2)})`);

  console.log("3) CAMINANDO (sin sprint) ~1.2s — debe seguir subiendo, pero más despacio que parado...");
  room.send("input", { x: 1, y: 0, correr: false });
  await esperar(1200);
  room.send("input", { x: 0, y: 0, correr: false });
  await esperar(150);
  const trasCaminar = propio()?.vitales?.estamina;
  const subidaCaminando = trasCaminar - trasQuieto;
  comprobar("caminando (sin sprint) la estamina SIGUE subiendo (nunca cero)", subidaCaminando > 0, `subió ${subidaCaminando.toFixed(2)} (de ${trasQuieto.toFixed(2)} a ${trasCaminar.toFixed(2)})`);
  comprobar(
    "caminando sube MENOS que estando parado del todo, en la misma ventana de tiempo",
    subidaCaminando < subidaQuieto,
    `parado=${subidaQuieto.toFixed(2)} vs. caminando=${subidaCaminando.toFixed(2)}`,
  );

  console.log("4) parado otra vez ~1.2s — vuelve a subir rápido (no se quedó 'enganchada' al ritmo lento)...");
  await esperar(1200);
  const trasQuieto2 = propio()?.vitales?.estamina;
  const subidaQuieto2 = trasQuieto2 - trasCaminar;
  comprobar("vuelve al ritmo rápido en cuanto se para del todo", subidaQuieto2 > subidaCaminando, `subió ${subidaQuieto2.toFixed(2)} (antes, caminando: ${subidaCaminando.toFixed(2)})`);

  room.leave();
} catch (err) {
  console.error("ERROR en el smoke test:", err);
  fallos++;
} finally {
  matar();
}

console.log(fallos === 0 ? "\n✅ regenEstamina.e2e: todo OK" : `\n❌ regenEstamina.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
