// E2E visual del login/panel de admin (docs/GDD_Admin.md, pedido
// 2026-08-30) — REESCRITO 2026-09-09 tras unificar el login de admin dentro
// de la pantalla de bienvenida (docs/GDD_Cuentas.md, pedido streamer: "el
// login deberia ser para todos, no solo admin, el admin a tener su cuenta o
// contraseña podria hacerlo"): el panel flotante `admin/panelLoginAdmin.ts`
// que este test verificaba se ELIMINÓ del repo al quedarse sin ningún
// consumidor — ahora el login de admin (usuario/contraseña de
// `admin_cuentas`) es una sección opcional dentro de `inicio/
// pantallaBienvenida.ts`, sumada a la cuenta de JUGADOR obligatoria (nunca
// la sustituye), sin recarga de página. Este test arranca servidor+cliente
// REALES, entra por la pantalla de bienvenida de verdad (SIN `?nombre=` —
// ese query param salta la pantalla entera, ver `debeSaltarBienvenida()`,
// así que hay que espantar `navigator.webdriver` como cualquier "jugador
// real" para poder llegar al formulario), registra un personaje nuevo Y
// rellena la sección de admin con la cuenta de superadmin sembrada por
// seedAdmin.ts, y comprueba que el Panel de superadmin aparece sin
// necesitar ninguna recarga. La parte HTTP/Colyseus pura (autorización real
// por mapa, 1 jarl por mapa, gestión de cuentas) ya la cubre admin.e2e.mjs —
// esto es SOLO la capa de UI encima.
//   node test/adminPanel.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2596;
const PUERTO_WEB = 5196;

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
  CLIENT_URL: `http://localhost:${PUERTO_WEB}`, // login de admin/jugador es fetch() cross-origin de verdad (Vercel/Render en prod) — necesita CORS, ver rutasAdmin.ts/rutasAuthJugador.ts
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

await new Promise((r) => setTimeout(r, 3500)); // arranque de ambos procesos + siembra de cuentas de test

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// `navigator.webdriver` en false: sin esto `debeSaltarBienvenida()` salta
// la pantalla entera (bypass real para toda la suite e2e de Playwright) —
// aquí se quiere justo lo contrario, llegar al formulario como jugador real.
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

try {
  // 1) Sin sesión: la pantalla de bienvenida (fullscreen, obligatoria) tapa todo.
  await page.goto(`http://localhost:${PUERTO_WEB}/`);
  await page.waitForSelector('[data-testid="pantalla-bienvenida"]', { timeout: 8000 });
  comprobar("sin sesión: la pantalla de bienvenida está visible", await page.locator('[data-testid="pantalla-bienvenida"]').isVisible());
  comprobar("sin botón de 'seguir como invitado' (login obligatorio)", (await page.locator("text=Seguir como invitado").count()) === 0);
  await page.screenshot({ path: join(capturas, "admin1_login.png") });

  // 2) Cuenta de JUGADOR nueva (obligatoria) + sección de admin desplegada
  // con la cuenta de superadmin sembrada por seedAdmin.ts — ambas desde el
  // MISMO formulario, un único "Crear cuenta".
  await page.locator("button:has-text('Crear cuenta')").first().click();
  await page.locator('[data-testid="bienvenida-nombre"]').fill("VisualTesterAdmin");
  await page.locator('[data-testid="bienvenida-password"]').fill("clave-de-test-123");
  await page.locator("text=¿Eres jarl o admin?").click();
  await page.locator('input[placeholder="usuario de admin"]').fill("superadmin");
  await page.locator('input[placeholder="contraseña de admin"]').fill("colony-superadmin-2026");
  await page.locator('[data-testid="bienvenida-entrar"]').click();

  // Creador de personaje obligatorio (docs/GDD_Personaje.md §7, pedido
  // streamer 2026-09-10, pasada aparte de esta misma noche): cualquier
  // cuenta nueva lo ve justo tras el login, ANTES de entrar al mundo —
  // confirmar con los valores por defecto basta, este e2e no prueba esa
  // pantalla en sí, solo tiene que atravesarla como cualquier jugador real.
  await page.waitForSelector('[data-testid="creador-personaje"]', { timeout: 15000 });
  await page.locator('[data-testid="creador-confirmar"]').click();

  // 3) Sin recarga de página (a diferencia del viejo flujo): el mismo join
  // ya manda `adminSession` desde el principio.
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 });
  await page.waitForSelector('[data-testid="pantalla-bienvenida"]', { state: "detached", timeout: 15000 });
  await page.waitForSelector("text=Panel de superadmin", { timeout: 10000 });
  comprobar("tras loguearse (mismo formulario, sin recarga), aparece el Panel de superadmin", await page.locator("text=Panel de superadmin").isVisible());
  comprobar("sección de PvP presente", await page.locator("text=PvP global").isVisible());
  comprobar("sección de gestión de cuentas presente (extra de superadmin)", await page.locator("text=Gestión de cuentas de admin").isVisible());
  await page.screenshot({ path: join(capturas, "admin2_panel_superadmin.png") });

  comprobar("sin errores de JS en la página", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ adminPanel.e2e: todo OK" : `\n❌ adminPanel.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("adminPanel.e2e reventó:", err);
  process.exit(1);
} finally {
  await browser.close();
}
