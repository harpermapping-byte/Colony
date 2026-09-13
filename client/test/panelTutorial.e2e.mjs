// E2E VISUAL de la Guía rápida + Novedades (docs/GDD_UI_Paneles.md, pedido
// streamer 2026-09-13: "justo al inicio, cuando te logeas, un panel con un
// resumen... también un changelog... y en Ajustes o abajo Tutoriales, lo
// mismo que el inicio"). Servidor Colyseus real + Vite + Playwright:
//   1) se abre SOLA nada más entrar al mundo, con el aviso de fase BETA;
//   2) pestaña "Guía rápida" muestra mecánicas reales del juego;
//   3) pestaña "Novedades" muestra el changelog, más reciente primero;
//   4) la X la cierra, y el icono 📖 del dock la vuelve a abrir (Tutoriales);
//   5) marcar "no mostrar automáticamente" + recargar la página YA NO la
//      auto-abre — pero sigue accesible desde el dock.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/panelTutorial.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2603;
const PUERTO_WEB = 5203;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}
const procesos = [];
const matarTodo = () => {
  for (const p of procesos) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matarTodo);

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
procesos.push(lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: ":memory:" }));
procesos.push(lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
}));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
for (const url of [`http://localhost:${PUERTO_WS}/`, `http://localhost:${PUERTO_WEB}/`]) {
  for (let i = 0; i < 240; i++) { try { await fetch(url); break; } catch {} await esperar(500); }
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

async function panelInfo(page) {
  return page.evaluate(() => {
    const marco = document.querySelector('[data-testid="panel-tutorial"]');
    if (!marco) return null;
    return {
      visible: getComputedStyle(marco).display !== "none",
      texto: marco.querySelector(".panel-colony-cuerpo")?.textContent ?? "",
    };
  });
}

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  console.log("1) A entra al mundo por primera vez...");
  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=TutorialTester`, { waitUntil: "commit", timeout: 120000 });
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 30000 });
  await esperar(500);

  const trasEntrar = await panelInfo(page);
  comprobar("el panel se abre SOLO al entrar por primera vez", trasEntrar?.visible === true, JSON.stringify(trasEntrar?.visible));
  comprobar("avisa de que el juego está en fase BETA", !!trasEntrar?.texto?.includes("BETA"), trasEntrar?.texto?.slice(0, 80));
  comprobar("la pestaña 'Guía rápida' está activa por defecto y lista mecánicas reales", !!trasEntrar?.texto?.includes("Moverte") && !!trasEntrar?.texto?.includes("Oficios"), trasEntrar?.texto?.slice(0, 200));
  await page.screenshot({ path: join(capturas, "tutorial_1_auto_abierto.png"), timeout: 45000 }).catch(() => {});

  console.log("2) cambiando a la pestaña Novedades...");
  await page.click('[data-testid="panel-tutorial"] button:has-text("Novedades")');
  await esperar(150);
  const enNovedades = await panelInfo(page);
  comprobar("la pestaña Novedades muestra el changelog (fecha más reciente)", !!enNovedades?.texto?.includes("2026-09-13"), enNovedades?.texto?.slice(0, 200));

  console.log("3) cerrando con la X...");
  await page.click('[data-testid="panel-tutorial"] .panel-colony-cerrar');
  await esperar(150);
  const trasCerrar = await panelInfo(page);
  comprobar("la X cierra el panel de verdad", trasCerrar?.visible === false, JSON.stringify(trasCerrar));

  console.log("4) reabriendo desde el icono 📖 del dock (Tutoriales)...");
  await page.click('.dock-hud-icono[title="Tutoriales"]');
  await esperar(150);
  const trasReabrir = await panelInfo(page);
  comprobar("el icono del dock reabre el mismo panel", trasReabrir?.visible === true, JSON.stringify(trasReabrir?.visible));

  console.log("5) marcando 'no mostrar automáticamente' y recargando la página...");
  await page.check('[data-testid="panel-tutorial"] input[type="checkbox"]');
  await esperar(150);
  await page.reload({ waitUntil: "commit", timeout: 30000 });
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 30000 });
  await esperar(600);
  const trasRecargar = await panelInfo(page);
  comprobar("con la preferencia marcada, YA NO se auto-abre al recargar", trasRecargar === null || trasRecargar.visible === false, JSON.stringify(trasRecargar));
  await page.click('.dock-hud-icono[title="Tutoriales"]');
  await esperar(150);
  const abiertoAMano = await panelInfo(page);
  comprobar("pero sigue accesible a mano desde el dock", abiertoAMano?.visible === true, JSON.stringify(abiertoAMano?.visible));

  comprobar("sin errores de JS en toda la sesión", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ panelTutorial.e2e: todo OK" : `\n❌ panelTutorial.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("panelTutorial.e2e reventó:", err);
  process.exit(1);
} finally {
  if (browser) await browser.close();
}
