// Captura la prueba aislada de orillas verticales (orillasAislado.html) —
// mismo patrón que siluetaAisladaCaptura.mjs. Coordenadas: orillas reales
// del mapa principal (buscadas sobre el bake: ventanas 20x20 con más aristas
// tierra↔agua de los sectores 4_6 / 3_6).
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/orillasAisladoCaptura.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5210;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const vistas = [
  { nombre: "rio_cerca", sx: 4, sy: 6, x: 1310, y: 2010, mitad: 9 },
  { nombre: "rio_lejos", sx: 4, sy: 6, x: 1310, y: 2010, mitad: 24 },
  { nombre: "lago_3_6", sx: 3, sy: 6, x: 1190, y: 2090, mitad: 12 },
];
let fallos = 0;
for (const v of vistas) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errores.push(m.text()); });
  await page.goto(`http://localhost:${PUERTO_WEB}/test/orillasAislado.html?sx=${v.sx}&sy=${v.sy}&x=${v.x}&y=${v.y}&mitad=${v.mitad}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__listo === true, { timeout: 60000 }).catch(() => { errores.push("timeout esperando __listo"); });
  const ruta = join(capturas, `orillas_${v.nombre}.png`);
  await page.screenshot({ path: ruta });
  if (errores.length) fallos++;
  console.log(`${errores.length === 0 ? "OK" : "FALLO"} ${v.nombre} -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
matar();
process.exit(fallos ? 1 : 0);
