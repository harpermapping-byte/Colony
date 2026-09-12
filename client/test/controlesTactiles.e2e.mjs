// E2E VISUAL de los controles táctiles para jugar desde el móvil (pedido
// streamer: "¿sería factible hacer controles para la versión web de los
// navegadores? para poder jugar a móvil" + "¿cómo reconoce que es versión
// móvil? si ponen la versión de PC en móvil/tablet ¿desaparece? ¿van a
// aparecer los controles siempre aunque estés en PC?"). Contra un servidor
// Colyseus real + Vite, con DOS contextos de navegador reales (Playwright
// `hasTouch`/`isMobile`, no un mock):
//   1) contexto de ESCRITORIO (ratón, sin touch) — los controles deben
//      quedar OCULTOS por defecto ("automático"), y el override "Siempre" de
//      Ajustes debe mostrarlos EN CALIENTE sin recargar la página.
//   2) contexto de MÓVIL (`hasTouch:true, isMobile:true`, viewport estrecho)
//      — los controles deben aparecer SOLOS en "automático" (sin tocar
//      Ajustes), arrastrar el joystick debe mover al jugador de verdad
//      (posición real leída de `window.__colonyDebug`, servidor autoritativo
//      de por medio), soltar debe PARAR el movimiento, el botón "☰ Más
//      acciones" debe abrir un panel con el resto de acciones reasignables,
//      y el override "Nunca" debe ocultarlos pese a ser un dispositivo táctil
//      real — confirma que el ajuste manda por encima de la detección.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/controlesTactiles.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2613;
const PUERTO_WEB = 5213;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const rutaDemo = join(dirRaiz, "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: ":memory:",
});
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
});
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 3500));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

const SEL_RAIZ = '[data-testid="controles-tactiles-raiz"]';
const SEL_JOYSTICK = '[data-testid="controles-tactiles-joystick"]';
const SEL_MAS = '[data-testid="controles-tactiles-mas"]';

async function controlesVisibles(page) {
  return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display !== "none", SEL_RAIZ);
}
async function debug(page) {
  return page.evaluate(() => window.__colonyDebug);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errores = [];

try {
  // ------------------------------------------------------------------
  // 1) Contexto de ESCRITORIO — ratón, sin touch, viewport ancho
  // ------------------------------------------------------------------
  console.log("=== Contexto ESCRITORIO (ratón, sin touch) ===");
  const ctxEscritorio = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  const pageEscritorio = await ctxEscritorio.newPage();
  pageEscritorio.on("pageerror", (e) => errores.push(`[escritorio] ${e}`));
  await pageEscritorio.goto(`http://localhost:${PUERTO_WEB}/?nombre=E2E-Escritorio`);
  await pageEscritorio.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
  await espera(500);

  comprobar("escritorio: controles OCULTOS por defecto ('automático' + ratón)", !(await controlesVisibles(pageEscritorio)));

  console.log("abriendo Ajustes y forzando 'Siempre'...");
  await pageEscritorio.locator('.dock-hud-icono[title="Ajustes"]').click();
  await pageEscritorio.locator('[data-testid="ajustes-controles-tactiles-siempre"]').click();
  await espera(200);
  comprobar("escritorio + override 'Siempre': controles VISIBLES en caliente, sin recargar", await controlesVisibles(pageEscritorio));
  await pageEscritorio.screenshot({ path: join(capturas, "controlesTactiles_escritorio_forzado.png") });

  console.log("volviendo a 'Automático' (deja el override limpio para el resto de la prueba)...");
  await pageEscritorio.locator('[data-testid="ajustes-controles-tactiles-auto"]').click();
  await espera(200);
  comprobar("escritorio + 'Automático' de nuevo: controles OCULTOS otra vez", !(await controlesVisibles(pageEscritorio)));
  await pageEscritorio.locator('.dock-hud-icono[title="Ajustes"]').click(); // cierra el panel
  await ctxEscritorio.close();

  // ------------------------------------------------------------------
  // 2) Contexto de MÓVIL — touch real de Playwright, viewport estrecho
  // ------------------------------------------------------------------
  console.log("\n=== Contexto MÓVIL (hasTouch+isMobile, viewport estrecho) ===");
  const ctxMovil = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pageMovil = await ctxMovil.newPage();
  pageMovil.on("pageerror", (e) => errores.push(`[móvil] ${e}`));
  await pageMovil.goto(`http://localhost:${PUERTO_WEB}/?nombre=E2E-Movil`);
  await pageMovil.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
  await espera(500);

  comprobar("móvil: controles VISIBLES solos, sin tocar Ajustes ('automático' + dispositivo táctil)", await controlesVisibles(pageMovil));
  await pageMovil.screenshot({ path: join(capturas, "controlesTactiles_movil_visible.png") });

  console.log("arrastrando el joystick hacia abajo (S)...");
  const cajaJoystick = await pageMovil.locator(SEL_JOYSTICK).boundingBox();
  const cx = cajaJoystick.x + cajaJoystick.width / 2;
  const cy = cajaJoystick.y + cajaJoystick.height / 2;
  const antes = await debug(pageMovil);
  await pageMovil.mouse.move(cx, cy);
  await pageMovil.mouse.down();
  await pageMovil.mouse.move(cx, cy + 60, { steps: 6 }); // más allá del radio máximo (42px) a propósito: se recorta solo
  await espera(1200);
  const durante = await debug(pageMovil);
  const avanceY = durante.y - antes.y;
  comprobar(`joystick hacia abajo mueve al jugador de verdad (Δy=${avanceY.toFixed(2)}, servidor autoritativo)`, avanceY > 0.5, `antes=${antes.y.toFixed(2)} durante=${durante.y.toFixed(2)}`);

  console.log("soltando el joystick — el movimiento debe PARAR...");
  await pageMovil.mouse.up();
  await espera(400);
  const trasSoltar1 = await debug(pageMovil);
  await espera(400);
  const trasSoltar2 = await debug(pageMovil);
  comprobar("soltar el joystick detiene el movimiento (posición estable tras soltar)", Math.abs(trasSoltar2.y - trasSoltar1.y) < 0.05, `${trasSoltar1.y.toFixed(3)} -> ${trasSoltar2.y.toFixed(3)}`);

  console.log("abriendo 'Más acciones'...");
  await pageMovil.locator(SEL_MAS).click();
  await espera(200);
  const botonesEnPanel = await pageMovil.evaluate((selRaiz) => {
    const raiz = document.querySelector(selRaiz);
    return raiz.querySelectorAll(".panel-colony .panel-colony-cuerpo button").length;
  }, SEL_RAIZ);
  comprobar("el panel 'Más acciones' lista el resto del catálogo reasignable (más de 15 botones, sin las 2 de debug)", botonesEnPanel > 15, `${botonesEnPanel} botones`);
  await pageMovil.screenshot({ path: join(capturas, "controlesTactiles_movil_mas_acciones.png") });
  // cerrar el panel con su propia X (dentro de .controles-tactiles, no debe interferir con el resto)
  await pageMovil.evaluate((selRaiz) => {
    document.querySelector(selRaiz).querySelector(".panel-colony-cerrar").click();
  }, SEL_RAIZ);
  await espera(150);

  console.log("forzando 'Nunca' — deben ocultarse pese a ser un dispositivo táctil real...");
  await pageMovil.locator('.dock-hud-icono[title="Ajustes"]').click();
  await pageMovil.locator('[data-testid="ajustes-controles-tactiles-nunca"]').click();
  await espera(200);
  comprobar("móvil + override 'Nunca': controles OCULTOS pese al touch real", !(await controlesVisibles(pageMovil)));
  await pageMovil.locator('[data-testid="ajustes-controles-tactiles-auto"]').click(); // deja el override limpio
  await ctxMovil.close();

  comprobar("sin errores de JS en ninguna página", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ controlesTactiles.e2e: todo OK" : `\n❌ controlesTactiles.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("controlesTactiles.e2e reventó:", err);
  process.exit(1);
} finally {
  await browser.close();
}
