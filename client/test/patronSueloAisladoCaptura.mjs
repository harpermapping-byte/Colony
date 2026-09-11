// Captura + mide la prueba aislada del patrón de suelo horneado
// (patronSueloAislado.html) — sector real del mapa principal, tiempo real
// de crearSectorVisual con `performance.now()` (mismo criterio que el resto
// de "Aislado" del proyecto: números reales, no afirmados).
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/patronSueloAisladoCaptura.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5212;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// sector_009_001 es el más pesado del mapa principal (ver CLAUDE.md); dos
// vistas: una cercana (ver el patrón de verdad) y una al zoom real del
// juego (TAMANO_MUNDO_VISIBLE/2 = 8).
const CASOS = [
  { nombre: "cercano", mitad: 4 },
  { nombre: "zoom_juego_real", mitad: 8 },
];
let fallos = 0;
const tiempos = [];
for (const { nombre, mitad } of CASOS) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(`http://localhost:${PUERTO_WEB}/test/patronSueloAislado.html?sx=9&sy=1&x=2890&y=350&mitad=${mitad}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => (window).__listo === true, { timeout: 30000 }).catch(() => { errores.push("timeout esperando __listo"); });
  const tiempoMs = await page.evaluate(() => (window).__tiempoTerrenoMs).catch(() => null);
  if (tiempoMs != null) tiempos.push(tiempoMs);
  const ruta = join(capturas, `patron_suelo_${nombre}.png`);
  await page.screenshot({ path: ruta });
  if (errores.length) fallos++;
  console.log(`${errores.length === 0 ? "OK" : "FALLO"} ${nombre} (crearSectorVisual: ${tiempoMs?.toFixed?.(1) ?? "?"}ms) -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
matar();
console.log(`\nTiempos reales de crearSectorVisual (sector 320x320 real, mapa principal): ${tiempos.map((t) => t.toFixed(1)).join(", ")} ms`);
process.exit(fallos ? 1 : 0);
