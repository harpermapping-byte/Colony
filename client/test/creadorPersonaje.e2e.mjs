// E2E visual del creador de personaje (docs/GDD_Personaje.md, pedido
// streamer 2026-09-10: "Creador completo elegible por el jugador (sexo,
// morfología, piel/pelo/ojos)... con UI también del estilo que ya
// tenemos y justo después del login... debe quedarse guardado en base de
// datos") — servidor+cliente REALES, entra por la pantalla de bienvenida
// de verdad (SIN `?nombre=`, mismo criterio que adminPanel.e2e.mjs: hay que
// espantar `navigator.webdriver` para no saltarse la pantalla entera).
// Cubre el flujo completo: cuenta nueva -> creador obligatorio -> elegir
// rasgos -> confirmar -> el mundo carga -> recargar con la MISMA sesión ya
// NO vuelve a pedir el creador (la ficha quedó guardada de verdad en BD).
//   node test/creadorPersonaje.e2e.mjs [dirCapturas]
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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

try {
  // 1) Cuenta nueva -> el creador debe aparecer, la bienvenida debe desaparecer.
  await page.goto(`http://localhost:${PUERTO_WEB}/`);
  await page.waitForSelector('[data-testid="pantalla-bienvenida"]', { timeout: 8000 });
  await page.locator("button:has-text('Crear cuenta')").first().click();
  await page.locator('[data-testid="bienvenida-nombre"]').fill("VisualTesterCreador");
  await page.locator('[data-testid="bienvenida-password"]').fill("clave-de-test-123");
  await page.locator('[data-testid="bienvenida-entrar"]').click();

  await page.waitForSelector('[data-testid="creador-personaje"]', { timeout: 10000 });
  comprobar("cuenta nueva: el creador de personaje aparece", await page.locator('[data-testid="creador-personaje"]').isVisible());
  comprobar("la pantalla de bienvenida ya no está (se retiró al pasar al creador)", (await page.locator('[data-testid="pantalla-bienvenida"]').count()) === 0);

  const canvas = page.locator(".creador-preview-canvas");
  const caja = await canvas.boundingBox();
  comprobar("el canvas de la vista previa 3D tiene tamaño real", !!caja && caja.width > 50 && caja.height > 50, JSON.stringify(caja));
  await page.screenshot({ path: join(capturas, "creador1_inicial.png") });

  // 2) Cambiar varios rasgos (sexo, peinado, color) — no debe reventar nada,
  // y la vista previa (mismo canvas) debe seguir presente tras cada cambio.
  await page.locator("button:has-text('♀ Mujer')").click();
  await page.locator("select").nth(0).selectOption("melena_larga"); // primer <select> = peinado
  await page.locator(".creador-swatch").first().click(); // primer color de pelo
  await page.waitForTimeout(300); // deja correr un par de frames de rAF de verdad
  comprobar("tras cambiar sexo/peinado/color, el canvas sigue vivo", await canvas.isVisible());
  await page.screenshot({ path: join(capturas, "creador2_personalizado.png") });

  // 3) Confirmar -> guarda en BD real (via POST /auth/jugador/personaje) y
  // entra al mundo, sin volver a mostrar ni bienvenida ni creador.
  await page.locator('[data-testid="creador-confirmar"]').click();
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 });
  comprobar("tras confirmar, el creador ya no está en pantalla", (await page.locator('[data-testid="creador-personaje"]').count()) === 0);
  comprobar("tras confirmar, entramos al mundo (window.__colonyDebug real)", !!(await page.evaluate(() => window.__colonyDebug)));
  comprobar("tras confirmar, la ficha YA llega en el primer snapshot (sin la carrera de la carga fire-and-forget)", (await page.evaluate(() => window.__colonyDebug.tieneFichaPersonaje)) === true);
  await page.screenshot({ path: join(capturas, "creador3_mundo.png") });

  // 4) Recargar con la MISMA sesión (localStorage.playerSession persiste) —
  // el login debe devolver `personaje` ya relleno (BD real), así que el
  // creador NO debe volver a aparecer nunca para esta cuenta. Bug real
  // encontrado jugando (2026-09-10): sin awaitear la carga de la ficha en
  // `RoomExteriorBase.crearJugador`, el personaje volvía a aparecer con el
  // rig genérico placeholder en CADA F5 — este es exactamente el escenario
  // que lo reprodujo, verificado ahora con `tieneFichaPersonaje` en vez de
  // solo comprobar que el creador no reaparece.
  await page.reload();
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 });
  comprobar("al recargar con la misma cuenta, NO vuelve a pedir el creador", (await page.locator('[data-testid="creador-personaje"]').count()) === 0);
  comprobar("al recargar, tampoco pide login de nuevo (sesión + ficha ya guardadas)", (await page.locator('[data-testid="pantalla-bienvenida"]').count()) === 0);
  comprobar("al recargar, la ficha llega YA en el primer snapshot — nunca el rig genérico", (await page.evaluate(() => window.__colonyDebug.tieneFichaPersonaje)) === true);

  comprobar("sin errores de JS en toda la sesión", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ creadorPersonaje.e2e: todo OK" : `\n❌ creadorPersonaje.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("creadorPersonaje.e2e reventó:", err);
  process.exit(1);
} finally {
  await browser.close();
}
