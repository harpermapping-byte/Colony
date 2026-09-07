// E2E ligero (sin navegador, mismo criterio/plantilla que
// client/test/poblacionRegion.e2e.mjs) del cableado NUEVO de docs/
// GDD_IA_NPCs.md (pedido streamer 2026-09-08: "ahondar en el tema de las
// conversaciones con IA NPC"): confirma que `npc:hablar` YA funciona en
// RegionRoom (antes solo existía en HubRoom, gap ya documentado —
// client/test/poblacionRegion.e2e.mjs lo señalaba explícitamente) y que la
// biografía INDIVIDUAL de un NPC real de `poblacion.json` (ciudad_demo, 68
// NPCs bakeados) llega hasta `GestorConversacionesNpc` sin reventar nada,
// incluso sin GEMINI_API_KEY/GROQ_API_KEY en este entorno (el proveedor de
// IA en sí sigue sin poder probarse aquí — mismo límite ya documentado
// desde el día 1 de docs/GDD_IA_NPCs.md, no es nuevo de esta pasada).
//
//   node test/npcHablarIndividual.e2e.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirServidor = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO_WS = 2598;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS) });
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
function esperarMensaje(room, tipo, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage(tipo, (m) => {
      clearTimeout(t);
      resolve(m);
    });
  });
}

try {
  await esperar(4000); // arranque del servidor

  const client = new Client(`ws://localhost:${PUERTO_WS}`);
  const room = await client.joinOrCreate("region", { mapaId: "ciudad_demo", name: "Explorador" });
  console.log(`Conectado a RegionRoom ${room.roomId}`);

  await esperarCondicion(() => room.state?.npcs?.size > 0, 8000, 100);
  comprobar("los NPCs de ciudad_demo (poblacion.json) están cargados", room.state.npcs.size > 0, `${room.state.npcs.size} NPCs`);

  // Cualquier NPC no hostil real (todos los de ciudad_demo lo son) — mismo
  // slotId que usaría el cliente real tras esta pasada (game.ts::npcParaHablarMasCercano).
  const [npcId, npc] = [...room.state.npcs.entries()].find(([, n]) => !n.hostil) ?? [];
  comprobar("hay al menos un NPC no hostil de muestra", !!npcId, npcId ? `${npcId} (${npc.nombre})` : "ninguno");

  // Sin GEMINI_API_KEY/GROQ_API_KEY en este entorno, la respuesta esperada
  // es "npc:error" con el motivo de proveedor — lo importante que SÍ
  // podemos verificar aquí es que la petición llega, se resuelve el NPC
  // (individual o arquetipo) SIN reventar la room, y el error vuelve
  // exactamente al cliente que preguntó. Si algún día este entorno SÍ tiene
  // claves reales, "npc:respuesta" también sería una respuesta válida —
  // este test no asume una API caída, solo tolera las dos.
  const esperaRespuesta = esperarMensaje(room, "npc:respuesta", 6000);
  const esperaError = esperarMensaje(room, "npc:error", 6000);
  room.send("npc:hablar", { npcId, mensaje: "¿qué tal el día?" });
  const [respuesta, error] = await Promise.all([esperaRespuesta, esperaError]);
  const llego = respuesta ?? error;
  comprobar("npc:hablar en una RegionRoom responde de verdad (antes solo existía en HubRoom)", !!llego, JSON.stringify(llego));
  if (llego) comprobar("la respuesta/error es del NPC correcto", llego.npcId === npcId, `esperado ${npcId}, llegó ${llego.npcId}`);
  if (error) {
    comprobar(
      "el motivo es 'sin proveedor de IA' (sin claves en este entorno), NO 'NPC desconocido' (que sí sería un bug real de resolución)",
      /sin proveedor de IA configurado/.test(error.motivo),
      error.motivo,
    );
  }

  room.leave();
} catch (err) {
  console.error("Error en el test:", err);
  fallos++;
} finally {
  matar();
}

if (fallos > 0) {
  console.error(`\n${fallos} comprobación(es) fallida(s).`);
  process.exit(1);
} else {
  console.log("\nTodo OK.");
  process.exit(0);
}
