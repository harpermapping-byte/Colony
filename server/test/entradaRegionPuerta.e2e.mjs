// E2E: quien entra a una región anidada (asentamiento) sin `entradaX/Y`
// aparece PEGADO a un portal de salida (docs/GDD_Sistema_Puertas.md, bug
// real del playtest multijugador 2026-09-10: el spawn de `capital_regional`
// queda a 4.5 casillas del único portal de salida cercano, fuera de
// RADIO_INTERACCION, y F no encontraba "puerta cerca" nada más entrar).
// Servidor real + colyseus.js puro (sin navegador) sobre el mapa principal.
//   node server/test/entradaRegionPuerta.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync, readFileSync } from "node:fs";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "entrada_region_puerta_e2e.sqlite");
const PUERTO = 2617;
const MAPA_REGION = "principal/pois/capital_regional_1534_2138";
try { unlinkSync(rutaBd); } catch {}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => { const t = String(d); if (/Región|error|Error/.test(t)) process.stdout.write(`[srv] ${t}`); });
  procesos.push(p);
  return p;
}
function matarTodo() { for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} } }
process.on("exit", matarTodo);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarPuerto(url, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { await fetch(url); return; } catch {} await esperar(300); }
  throw new Error("timeout esperando " + url);
}
let fallos = 0;
const comprobar = (n, ok, d) => { console.log(`${ok ? "OK" : "FALLO"} ${n}${d ? ` (${d})` : ""}`); if (!ok) fallos++; };

try {
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: join(raiz, "assets", "mapas", "principal"), BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  const indice = JSON.parse(readFileSync(join(raiz, "assets", "mapas", MAPA_REGION, "indice.json"), "utf8"));
  const salidas = (indice.portales || []).filter((p) => p.tipo === "exterior" && !p.destino);
  comprobar("la región tiene portales de salida en su índice", salidas.length > 0, `${salidas.length}`);

  console.log("1) entra a la región SIN entradaX/Y (como al cruzar la puerta desde el exterior)...");
  const room = await new Client(`ws://localhost:${PUERTO}`).joinOrCreate("region", { name: "EntradaPuerta", mapaId: MAPA_REGION });
  await esperar(800);
  const yo = room.state.players.get(room.sessionId);
  const dSalida = Math.min(...salidas.map((p) => Math.hypot(p.x + 0.5 - yo.x, p.y + 0.5 - yo.y)));
  comprobar("aparece a ≤2.2 casillas de un portal de salida (RADIO_INTERACCION)", dSalida <= 2.2, `pos ${yo.x.toFixed(1)},${yo.y.toFixed(1)}, distancia ${dSalida.toFixed(2)}, spawn del bake ${indice.ciudad?.x},${indice.ciudad?.y}`);

  console.log("2) F (portal:usar) nada más entrar debe responder portal:ir tipo 'volver'...");
  const respuesta = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    room.onMessage("portal:ir", (m) => { clearTimeout(t); resolve({ ir: m }); });
    room.onMessage("portal:error", (m) => { clearTimeout(t); resolve({ error: m }); });
    room.send("portal:usar");
  });
  comprobar("portal:usar desde el punto de entrada devuelve al exterior", respuesta?.ir?.tipo === "volver", JSON.stringify(respuesta));

  console.log("3) con entradaX/Y explícitos (portal real de otra planta/mapa) se respeta ESE punto...");
  const room2 = await new Client(`ws://localhost:${PUERTO}`).joinOrCreate("region", { name: "EntradaExplicita", mapaId: MAPA_REGION, entradaX: 90.5, entradaY: 90.5 });
  await esperar(800);
  const yo2 = room2.state.players.get(room2.sessionId);
  comprobar("entradaX/Y explícitos mandan sobre el punto de entrada por defecto", Math.abs(yo2.x - 90.5) < 0.01 && Math.abs(yo2.y - 90.5) < 0.01, `${yo2.x},${yo2.y}`);
  await room.leave(); await room2.leave();
} catch (e) {
  fallos++;
  console.error("❌", e?.stack || e);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
console.log(fallos === 0 ? "\n✅ entradaRegionPuerta.e2e: TODO OK" : `\n❌ entradaRegionPuerta.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
