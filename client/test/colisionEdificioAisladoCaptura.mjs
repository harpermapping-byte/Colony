// Captura la verificación visual del fix esquina-vs-centro de edificios
// (colisionEdificioAislado.html) — sector real de ciudad_demo, wireframe
// amarillo en el footprint de colisión REAL de cada edificio (centro+w/h
// reales, rotados) por encima del render real: si el fix es correcto, cada
// edificio cae DENTRO de su wireframe, no desplazado medio edificio.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/colisionEdificioAisladoCaptura.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5216;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));
await page.goto(`http://localhost:${PUERTO_WEB}/test/colisionEdificioAislado.html`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => (window).__listo === true, { timeout: 20000 }).catch(() => { errores.push("timeout esperando __listo"); });
const ruta = join(capturas, "colision_edificio_fix.png");
await page.screenshot({ path: ruta });
console.log(`${errores.length === 0 ? "OK" : "FALLO"} -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
await browser.close();
matar();
process.exit(errores.length ? 1 : 0);
