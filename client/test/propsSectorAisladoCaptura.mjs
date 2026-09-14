// Mide (sin captura, solo números) el hueco máximo entre frames durante
// `crearPropsSector` — mismo criterio que patronSueloAisladoCaptura.mjs.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/propsSectorAisladoCaptura.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");

const PUERTO_WEB = 5217;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));
page.on("console", (m) => console.log(`[console] ${m.text()}`));
await page.goto(`http://localhost:${PUERTO_WEB}/test/propsSectorAislado.html`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => (window).__listo === true, { timeout: 60000 }).catch(() => errores.push("timeout esperando __listo"));
await browser.close();
matar();
if (errores.length) console.log("ERRORES:", errores.join(" | "));
process.exit(errores.length ? 1 : 0);
