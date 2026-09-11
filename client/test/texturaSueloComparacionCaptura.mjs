// Captura la comparación aislada de 3 técnicas de render de suelo
// (texturaSueloComparacion.html) — mismo patrón que orillasAisladoCaptura.mjs.
// Dos zooms: "detalle" (mitad=6, para ver el patrón de cerca) y "juego"
// (mitad=8, el mismo TAMANO_MUNDO_VISIBLE/2 real de worldScene.ts) para
// juzgar cómo se lee cada técnica a la distancia de cámara real del juego.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/texturaSueloComparacionCaptura.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5211;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const vistas = [
  { nombre: "detalle", mitad: 6 },
  { nombre: "zoom_juego_real", mitad: 8 },
];
let fallos = 0;
for (const v of vistas) {
  const page = await browser.newPage({ viewport: { width: 1560, height: 460 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(`http://localhost:${PUERTO_WEB}/test/texturaSueloComparacion.html?mitad=${v.mitad}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__listo === true, { timeout: 30000 }).catch(() => { errores.push("timeout esperando __listo"); });
  const ruta = join(capturas, `suelo_comparacion_${v.nombre}.png`);
  await page.screenshot({ path: ruta });
  if (errores.length) fallos++;
  console.log(`${errores.length === 0 ? "OK" : "FALLO"} ${v.nombre} -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
matar();
process.exit(fallos ? 1 : 0);
