// E2E visual del login/panel de admin (docs/GDD_Admin.md, pedido
// 2026-08-30): arranca servidor + cliente Vite REALES, comprueba que sin
// sesión aparece el formulario de login, que loguearse desde el propio
// formulario (clic real, no fetch directo) deja ver el panel de
// superadmin tras la recarga, y que sus botones de PvP/Twitch/gestión de
// cuentas están ahí. La parte HTTP/Colyseus pura (autorización real por
// mapa, 1 jarl por mapa, gestión de cuentas) ya la cubre admin.e2e.mjs —
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
  CLIENT_URL: `http://localhost:${PUERTO_WEB}`, // login de admin es fetch() cross-origin de verdad (Vercel/Render en prod) — necesita CORS, ver rutasAdmin.ts
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
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

try {
  // 1) Sin sesión: aparece el formulario de login de admin.
  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=VisualTester`);
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('input[placeholder="usuario"]', { timeout: 8000 });
  comprobar("sin sesión: el formulario de login de admin está visible", await page.locator('input[placeholder="usuario"]').isVisible());
  await page.screenshot({ path: join(capturas, "admin1_login.png") });

  // 2) Login real desde el formulario (clic, no fetch directo) con la
  // cuenta de superadmin sembrada por seedAdmin.ts.
  await page.fill('input[placeholder="usuario"]', "superadmin");
  await page.fill('input[placeholder="contraseña"]', "colony-superadmin-2026");
  await Promise.all([
    page.waitForNavigation({ timeout: 8000 }).catch(() => null), // onLoginOk hace location.reload()
    page.click('button:has-text("Entrar")'),
  ]);

  // 3) Tras la recarga, el join manda adminSession y el panel de superadmin aparece.
  await page.waitForSelector('text=Panel de superadmin', { timeout: 10000 });
  comprobar("tras loguearse, aparece el Panel de superadmin", await page.locator("text=Panel de superadmin").isVisible());
  comprobar("el estado muestra 'Superadmin: superadmin'", await page.locator("text=Superadmin: superadmin").isVisible());
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
