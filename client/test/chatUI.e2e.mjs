// Verificación de la UI de chat en el NAVEGADOR real (docs/GDD_Mecanicas.md
// §5.12, pedido 2026-09-02) — CLAUDE.md exige probar cambios de UI en un
// navegador antes de darlos por hechos, no solo el protocolo de servidor
// (eso ya lo cubre client/test/chat.e2e.mjs). Arranca servidor+cliente
// reales sobre el mapa demo (mismo patrón que climaVisual.e2e.mjs) y
// comprueba, con un navegador de verdad:
//   1) el panel de chat existe y se puede escribir en él con Enter.
//   2) REGRESIÓN que este chat estuvo a punto de introducir: escribir un
//      mensaje que contenga letras de atajos de juego (b/i/d, movimiento
//      incluido) NO debe mover al jugador ni disparar esos atajos — antes
//      del guardia añadido en el keydown global de game.ts, cada letra
//      escrita en el chat le llegaba TAMBIÉN al juego entero.
//   3) el mensaje enviado aparece en el log del propio panel (canal local
//      incluye al que habla).
//   4) el botón de canal alterna Local/Global.
//   node test/chatUI.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2603;
const PUERTO_WEB = 5203;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: ":memory:" });
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, { VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo" });
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}
function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

try {
  await esperar(3500);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.goto(`http://localhost:${PUERTO_WEB}/`, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(4000); // conectar a la room + primer frame con __colonyDebug

  const panelExiste = await page.locator('[data-testid="panel-chat"]').count();
  comprobar("el panel de chat existe en el DOM", panelExiste === 1);

  const posAntes = await page.evaluate(() => (window).__colonyDebug);
  comprobar("__colonyDebug disponible (sonda de posición)", !!posAntes, JSON.stringify(posAntes));

  // Abre el chat con Enter (atajo universal) y escribe un mensaje que
  // incluye a propósito letras de atajos reales del juego: b (construcción),
  // i (inventario), d (¡movimiento!) — la combinación más peligrosa si el
  // guardia de foco fallara.
  await page.keyboard.press("Enter");
  const inputEnfocado = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  comprobar("Enter enfoca el input del chat", inputEnfocado === "panel-chat-input", inputEnfocado);

  const mensaje = "build door test bid";
  await page.locator('[data-testid="panel-chat-input"]').type(mensaje, { delay: 40 });
  await page.waitForTimeout(500); // margen para que un posible leak de movimiento se note en __colonyDebug

  const posDespues = await page.evaluate(() => (window).__colonyDebug);
  const distanciaMovida = Math.hypot(posDespues.x - posAntes.x, posDespues.y - posAntes.y);
  comprobar(
    "REGRESIÓN: escribir 'd'/'b'/'i' en el chat NO mueve al jugador ni dispara atajos (antes del guardia, sí lo hacía)",
    distanciaMovida < 0.05,
    `movido=${distanciaMovida.toFixed(3)} antes=${JSON.stringify(posAntes)} despues=${JSON.stringify(posDespues)}`,
  );

  const valorInputAntesDeEnviar = await page.locator('[data-testid="panel-chat-input"]').inputValue();
  comprobar("el texto escrito llegó completo al input (nada se lo tragó otro handler)", valorInputAntesDeEnviar === mensaje, valorInputAntesDeEnviar);

  await page.keyboard.press("Enter"); // envía
  await page.waitForTimeout(600);

  const logTexto = await page.locator('[data-testid="panel-chat"]').innerText();
  comprobar("el mensaje enviado aparece en el propio log (canal local incluye a quien habla)", logTexto.includes(mensaje), logTexto);
  comprobar("el log muestra la etiqueta [Local] por defecto", logTexto.includes("[Local]"), logTexto);

  // Alterna el canal y comprueba el label del botón.
  const botonCanal = page.locator('[data-testid="panel-chat"] button');
  const labelAntes = await botonCanal.innerText();
  await botonCanal.click();
  const labelDespues = await botonCanal.innerText();
  comprobar("el botón de canal alterna Local <-> Global", labelAntes !== labelDespues, `${labelAntes} -> ${labelDespues}`);

  const ruta = join(capturas, "chat_ui.png");
  await page.screenshot({ path: ruta });
  console.log("captura:", ruta);

  comprobar("sin errores de página durante toda la prueba", errores.length === 0, errores.join(" | "));

  await browser.close();
  console.log(fallos === 0 ? "\n✅ chatUI.e2e: todo OK" : `\n❌ chatUI.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("chatUI.e2e reventó:", err);
  process.exit(1);
}
