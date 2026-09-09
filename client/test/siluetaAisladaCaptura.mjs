// Captura la prueba aislada de silueta de asentamiento (siluetaAislada.html)
// — mismo patrón que nieveAisladoCaptura.mjs. Requiere haber corrido antes
// `node client/test/generarSiluetaTestSector.js [tier]` para tener
// client/test/siluetaTestSector.json listo.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5209;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const vista of ["cerca", "lejos"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(`http://localhost:${PUERTO_WEB}/test/siluetaAislada.html?vista=${vista}`, { waitUntil: "load", timeout: 20000 });
  await page.waitForFunction(() => (window).__listo === true, { timeout: 15000 }).catch(() => {});
  const ruta = join(capturas, `silueta_aislada_${vista}.png`);
  await page.screenshot({ path: ruta });
  console.log(`${errores.length === 0 ? "OK" : "FALLO"} ${vista} -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
matar();
