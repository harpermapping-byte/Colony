// E2E ligero (sin navegador, mismo criterio/plantilla que
// server/test/npcHablarIndividual.e2e.mjs) del NPC pregonero (docs/
// GDD_IA_NPCs.md v3bis, pedido streamer: "un npc llamado pregonero que te
// cuente... las novedades del día") — confirma que existe un pregonero
// REAL en un mapa bakeado (ciudad_demo, `rio-3|pregonero_0`, ya censado en
// poblacion/catalogo/censo.json) y que hablarle no revienta la room aunque
// el log de novedades esté vacío (BD de dev fresca, sin ningún suceso
// registrado todavía) — ejercita de verdad la rama "no tienes ninguna
// novedad real que contar" de `npcChat.ts` en un servidor real, no solo con
// fakes (ver server/test/ia.test.ts para esa cobertura unitaria).
// Mismo límite ya documentado desde el día 1 de docs/GDD_IA_NPCs.md: sin
// GEMINI_API_KEY/GROQ_API_KEY en este entorno, no se puede observar la
// respuesta narrada real — solo que la petición llega y resuelve sin error
// de "NPC desconocido".
//
//   node test/pregoneroNovedades.e2e.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirServidor = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO_WS = 2599;

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

  // slotId FIJO leído directo de assets/mapas/ciudad_demo/poblacion.json
  // (censado ahí desde el bake, no cambia entre ejecuciones) — a propósito
  // NO se busca en `room.state.npcs` (interest-management/StateView, ver
  // docs/GDD_Rendimiento.md §5, puede dejarlo fuera del radio de visión del
  // spawn de ESTE cliente sin que eso sea un bug: `npc:hablar` lo resuelve
  // server-side contra el Map completo de `poblacion.json`, independiente
  // de qué vea replicado un cliente concreto).
  const npcId = "rio-3|pregonero_0";

  const esperaRespuesta = esperarMensaje(room, "npc:respuesta", 6000);
  const esperaError = esperarMensaje(room, "npc:error", 6000);
  room.send("npc:hablar", { npcId, mensaje: "¿qué novedades hay hoy?" });
  const [respuesta, error] = await Promise.all([esperaRespuesta, esperaError]);
  const llego = respuesta ?? error;
  comprobar("hablarle al pregonero responde de verdad (el proveedor de novedades no revienta la room)", !!llego, JSON.stringify(llego));
  if (llego) comprobar("la respuesta/error es del pregonero correcto", llego.npcId === npcId, `esperado ${npcId}, llegó ${llego.npcId}`);
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
