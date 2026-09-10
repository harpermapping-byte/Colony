// E2E visual del selector de oficios dentro del panel de diálogo con el NPC
// "maestro de oficios" (docs/GDD_Profesiones.md, pedido streamer 2026-09-10:
// "como cojo las profesiones nada mas entrar?... habra que hacer la ui de la
// conver con el para elegir no? click sobre el elegir oficio?"). Cierra dos
// huecos reales encontrados investigando la pregunta: (1) el NPC "Maestro de
// Oficios" que el jarl puede plantar con admin:npcTutorial:colocar nunca
// satisfacía el gate real de oficio:elegir (bug en npcsFijos.ts, cerrado en
// el mismo commit — ver oficios.test.ts), (2) no existía NINGUNA UI de
// cliente para elegir/cambiar oficio, solo el protocolo probado por tests.
//
// Servidor+cliente REALES + Playwright: entra por la bienvenida de verdad
// (mismo patrón que adminPanel.e2e.mjs), se loguea como superadmin, coloca
// al maestro de oficios EN SU PROPIA posición (admin:npcTutorial:colocar
// sin más argumentos), abre el diálogo con la tecla H y confirma de punta a
// punta: el selector aparece, elegir un oficio en un slot vacío es gratis y
// el botón pasa a "✓", y con los 2 slots llenos aparece la confirmación de
// reemplazo (probada de verdad, con Farycoins reales dados por
// admin:debug:ajustarFarycoins) que consume el mensaje oficio:cambiar.
//   node test/oficioSelectorNpc.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2597;
const PUERTO_WEB = 5197;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS),
  RUTA_MAPA: rutaDemo,
  BD_RUTA: ":memory:",
  CLIENT_URL: `http://localhost:${PUERTO_WEB}`,
});
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
  VITE_RUTA_MAPA: "/assets/mapas/demo",
});
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

const panel = '[data-testid="panel-dialogo-npc"]';

try {
  // 1) Login real como jugador nuevo + superadmin (para poder plantar el NPC).
  await page.goto(`http://localhost:${PUERTO_WEB}/`);
  await page.waitForSelector('[data-testid="pantalla-bienvenida"]', { timeout: 8000 });
  await page.locator("button:has-text('Crear cuenta')").first().click();
  await page.locator('[data-testid="bienvenida-nombre"]').fill("VisualTesterOficios");
  await page.locator('[data-testid="bienvenida-password"]').fill("clave-de-test-123");
  await page.locator("text=¿Eres jarl o admin?").click();
  await page.locator('input[placeholder="usuario de admin"]').fill("superadmin");
  await page.locator('input[placeholder="contraseña de admin"]').fill("colony-superadmin-2026");
  await page.locator('[data-testid="bienvenida-entrar"]').click();
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 });
  await page.waitForSelector('[data-testid="pantalla-bienvenida"]', { state: "detached", timeout: 15000 });
  await page.waitForFunction(() => window.__test, null, { timeout: 10000 });

  // 2) Planta al "Maestro de Oficios" EN LA POSICIÓN ACTUAL del jugador —
  // mismo mecanismo real que usaría el streamer como jarl, sin atajos.
  // Confirmado con el conteo real de `window.__npcs()` (sonda ya existente
  // en game.ts) que el NPC nuevo llega a `state.npcs` en vez de una espera
  // fija a ciegas — el interest-management lo recoloca en su siguiente tick
  // (actualizarVistaDeInteres, cada 500ms), no de forma instantánea.
  const npcsAntes = await page.evaluate(() => window.__npcs().total);
  await page.evaluate(() => window.__test.enviar("admin:npcTutorial:colocar", { tipoTutorial: "tutorial_oficios" }));
  await page.waitForFunction((antes) => window.__npcs().total > antes, npcsAntes, { timeout: 8000 });

  // 3) Abre el diálogo (tecla H, mismo atajo que cualquier NPC) — el
  // selector de oficios debe aparecer solo porque ESTE NPC es el maestro.
  await page.keyboard.press("h");
  await page.waitForSelector(panel, { state: "visible", timeout: 8000 });
  comprobar("panel de diálogo visible tras H", await page.locator(panel).isVisible());
  // Bug real cerrado 2026-09-10: sin preventDefault, la MISMA pulsación de H
  // que abre el panel dejaba una "h" suelta escrita en el input recién
  // enfocado (el navegador insertaba el carácter contra el foco YA cambiado).
  comprobar("el input del panel queda VACÍO tras abrir con H (sin 'h' residual)", (await page.locator('[data-testid="panel-dialogo-npc-input"]').inputValue()) === "");
  comprobar("mensaje de 'sin ningún oficio todavía'", (await page.locator(`${panel}:has-text('Aún no tienes ningún oficio')`).count()) > 0);
  const botonesOficio = page.locator(`${panel} button:has-text('Herrero')`);
  comprobar("botón 'Herrero' presente en el selector", (await botonesOficio.count()) > 0);
  await page.screenshot({ path: join(capturas, "oficio1_selector_vacio.png") });

  // 4) Elegir el primer oficio (slot vacío = gratis) — de punta a punta: el
  // servidor lo acepta, el toast lo confirma y el botón pasa a "✓".
  await page.locator(`${panel} button`, { hasText: /^Herrero$/ }).click();
  await page.waitForSelector("text=Ahora eres herrero", { timeout: 6000 });
  comprobar("toast 'Ahora eres herrero' visible", (await page.locator("text=Ahora eres herrero").count()) > 0);
  await page.waitForSelector(`${panel} button:has-text('✓ Herrero')`, { timeout: 6000 });
  comprobar("el botón Herrero pasa a ✓ (deshabilitado) sin cerrar el panel", await page.locator(`${panel} button:has-text('✓ Herrero')`).isVisible());
  comprobar("panel sigue abierto (actualizarOficios no lo cierra)", await page.locator(panel).isVisible());
  await page.screenshot({ path: join(capturas, "oficio2_primer_elegido.png") });

  // 5) Segundo oficio (2º slot, también gratis).
  await page.locator(`${panel} button`, { hasText: /^Curandero$/ }).click();
  await page.waitForSelector("text=Ahora eres curandero", { timeout: 6000 });
  await page.waitForSelector(`${panel} button:has-text('✓ Curandero')`, { timeout: 6000 });
  comprobar("segundo oficio elegido, ambos slots llenos", await page.locator(`${panel} button:has-text('✓ Curandero')`).isVisible());

  // 6) Con los 2 slots llenos, clicar un TERCER oficio no lo elige directo
  // — pide confirmar qué slot reemplazar (cuesta Farycoins reales).
  await page.locator(`${panel} button`, { hasText: /^Molinero$/ }).click();
  await page.waitForSelector(`${panel} button:has-text('Reemplazar Herrero')`, { timeout: 6000 });
  comprobar("con 2 slots llenos, pide confirmar qué oficio reemplazar", await page.locator(`${panel} button:has-text('Reemplazar Herrero')`).isVisible());
  await page.screenshot({ path: join(capturas, "oficio3_confirmar_reemplazo.png") });

  // 7) Confirma el reemplazo de verdad — necesita Farycoins reales, se los
  // da el propio superadmin con el comando de debug ya existente.
  await page.evaluate(() => window.__test.enviar("admin:debug:ajustarFarycoins", { cantidad: 1000 }));
  await page.waitForTimeout(400);
  await page.locator(`${panel} button:has-text('Reemplazar Herrero')`).click();
  await page.waitForSelector("text=Has cambiado herrero por molinero", { timeout: 6000 });
  comprobar("toast de cambio real ('Has cambiado herrero por molinero (-50 Farycoins)')", (await page.locator("text=Has cambiado herrero por molinero").count()) > 0);
  await page.waitForSelector(`${panel} button:has-text('✓ Molinero')`, { timeout: 6000 });
  comprobar("Molinero ya sale con ✓ y Herrero volvió a ser elegible", (await page.locator(`${panel} button:has-text('✓ Molinero')`).count()) > 0 && (await page.locator(`${panel} button`, { hasText: /^Herrero$/ }).count()) > 0);
  await page.screenshot({ path: join(capturas, "oficio4_cambio_confirmado.png") });

  comprobar("sin errores de JS en la página", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ oficioSelectorNpc.e2e: todo OK" : `\n❌ oficioSelectorNpc.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("oficioSelectorNpc.e2e reventó:", err);
  await page.screenshot({ path: join(capturas, "oficio_error.png") }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
