// E2E ligero (sin navegador, mismo criterio que combateCoop.e2e.mjs) del
// sistema de IA de pueblos/aldeas (docs/GDD_Agentes_Moviles.md): dos
// clientes colyseus.js reales conectados a la MISMA RegionRoom sobre
// "ciudad_demo" (assets/mapas/ciudad_demo/poblacion.json, 68 NPCs con
// rutina real, ya bakeado — no hace falta sembrar nada, RegionRoom.onCreate
// lo carga solo si el fichero existe).
//
// Aviso explícito (pedido del streamer, "sistema de IAs de los pueblos"):
// esto verifica la parte de MOVIMIENTO/SINCRONIZACIÓN multijugador de los
// NPCs con rutina (agentes.ts) — NO la IA GENERATIVA de diálogo
// (npc:hablar), que:
//   (a) solo existe hoy en HubRoom.ts, no en RegionRoom — un pueblo/aldea
//       normal no tiene ese handler, es una separación real y ya
//       documentada del proyecto (CLAUDE.md: "cablear la biografía
//       individual de poblacion/ al diálogo de IA es el pendiente real"),
//       no un bug de esta pasada;
//   (b) exige GEMINI_API_KEY/GROQ_API_KEY, no disponibles en este entorno.
//
//   node test/poblacionRegion.e2e.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const PUERTO_WS = 2597;

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

try {
  await esperar(4000); // arranque del servidor

  const clientA = new Client(`ws://localhost:${PUERTO_WS}`);
  const clientB = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomA = await clientA.joinOrCreate("region", { mapaId: "ciudad_demo", name: "PobA" });
  const roomB = await clientB.joinOrCreate("region", { mapaId: "ciudad_demo", name: "PobB" });
  console.log(`Conectados: A=${roomA.sessionId} B=${roomB.sessionId} (room ${roomA.roomId})`);
  comprobar("A y B están en la MISMA RegionRoom de ciudad_demo", roomA.roomId === roomB.roomId, `A=${roomA.roomId} B=${roomB.roomId}`);

  await esperarCondicion(() => roomA.state?.npcs?.size > 0 && roomB.state?.npcs?.size > 0, 8000, 100);
  const nA = roomA.state.npcs.size, nB = roomB.state.npcs.size;
  comprobar("los 68 NPCs de poblacion.json están cargados y replicados", nA === 68 && nB === 68, `A ve ${nA}, B ve ${nB}`);

  // Mismos slotId en ambos, mismas posiciones — replicación correcta desde
  // el primer patch, no solo "el mismo número".
  const idsA = new Set(roomA.state.npcs.keys());
  const idsB = new Set(roomB.state.npcs.keys());
  const mismosIds = idsA.size === idsB.size && [...idsA].every((id) => idsB.has(id));
  comprobar("los MISMOS slotId de NPC en A y B", mismosIds, `diff=${[...idsA].filter((id) => !idsB.has(id)).length}`);

  let peorDist = 0, npcPeor = null;
  for (const [id, npcA] of roomA.state.npcs.entries()) {
    const npcB = roomB.state.npcs.get(id);
    if (!npcB) continue;
    const d = Math.hypot(npcA.x - npcB.x, npcA.y - npcB.y);
    if (d > peorDist) { peorDist = d; npcPeor = id; }
  }
  comprobar("TODAS las posiciones de NPC coinciden EXACTO entre A y B (estado replicado, no cosmético por cliente)", peorDist < 0.01, `peor diferencia=${peorDist.toFixed(3)} en ${npcPeor}`);

  // Foto inicial de posiciones + un oficio real de muestra (confirma que
  // los datos de poblacion.json, no solo x/y, llegaron completos).
  const muestra = [...roomA.state.npcs.entries()][0];
  console.log(`  muestra: ${muestra[0]} en (${muestra[1].x.toFixed(1)},${muestra[1].y.toFixed(1)}) nombre="${muestra[1].nombre}" oficio="${muestra[1].oficio || "(civil)"}"`);
  const posicionesIniciales = new Map([...roomA.state.npcs.entries()].map(([id, n]) => [id, { x: n.x, y: n.y }]));

  // Simulado a 10hz (comentario real de RegionRoom.ts) — una ventana de
  // pocos segundos reales ya cubre bastantes ticks si algún NPC está en
  // mitad de una acción "caminar" de su rutina ahora mismo. Si NINGUNO se
  // mueve en la ventana no es necesariamente un fallo (puede que ningún NPC
  // tenga una transición de rutina activa justo ahora) — se informa así,
  // sin forzarlo a "OK" ni a "FALLO".
  await esperar(8000);
  let algunoSeMovio = false, sincronizadosTrasMover = true, ejemploMovido = null;
  for (const [id, inicial] of posicionesIniciales) {
    const npcA = roomA.state.npcs.get(id);
    const npcB = roomB.state.npcs.get(id);
    if (!npcA || !npcB) continue;
    const seMovio = Math.hypot(npcA.x - inicial.x, npcA.y - inicial.y) > 0.05;
    if (seMovio) {
      algunoSeMovio = true;
      if (!ejemploMovido) ejemploMovido = id;
      const dAB = Math.hypot(npcA.x - npcB.x, npcA.y - npcB.y);
      if (dAB > 0.01) sincronizadosTrasMover = false;
    }
  }
  if (algunoSeMovio) {
    comprobar("al menos 1 NPC se movió en 8s reales Y su posición sigue EXACTA entre A y B tras moverse", sincronizadosTrasMover, `ejemplo=${ejemploMovido}`);
  } else {
    console.log("INFO - ningún NPC cambió de posición en la ventana de 8s (puede que ninguna rutina tuviera una transición activa justo ahora) — no cuenta como fallo, replicación estática ya confirmada arriba.");
  }

  roomA.leave(); roomB.leave();
} catch (err) {
  console.error("ERROR en el smoke test:", err);
  fallos++;
} finally {
  matar();
}

console.log(fallos === 0 ? "\n✅ poblacionRegion.e2e: todo OK" : `\n❌ poblacionRegion.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
