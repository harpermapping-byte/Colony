// Captura la prueba aislada (nieveAislado.html) — solo Vite, sin servidor
// Colyseus, sin mapa real: verifica la geometría real de la nieve
// (crearSectorVisual) contra el borde de su propio sector y un cubo de
// referencia con la altura real de una persona.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WEB = 5205;
const vite = spawn("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], { cwd: dirCliente, stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
vite.stderr.on("data", (d) => process.stdout.write(`[vite] ${d}`));
const matar = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch {} try { vite.kill("SIGKILL"); } catch {} };
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const CASOS = [
  { nivel: 0, tipo: "borde" },
  { nivel: 4, tipo: "borde" },
  { nivel: 4, tipo: "agua" },
];
for (const { nivel, tipo } of CASOS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(`http://localhost:${PUERTO_WEB}/test/nieveAislado.html?nivel=${nivel}&tipo=${tipo}`, { waitUntil: "load", timeout: 20000 });
  await page.waitForFunction(() => (window).__listo === true, { timeout: 15000 }).catch(() => {});
  const ruta = join(capturas, `nieve_aislado_${tipo}_nivel_${nivel}.jpg`);
  await page.screenshot({ path: ruta, type: "jpeg", quality: 92 });
  console.log(`${errores.length === 0 ? "OK" : "FALLO"} ${tipo} nivel ${nivel} -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
matar();
