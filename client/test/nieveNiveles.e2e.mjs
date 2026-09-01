// Captura los 5 niveles de nieve acumulada (0-4, docs/GDD_Clima.md) uno al
// lado del otro, junto a los NPCs de spawn, para inspección visual directa
// — mismo arnés que climaVisual.e2e.mjs, JPG en vez de PNG (pedido).
//   node test/nieveNiveles.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2602;
const PUERTO_WEB = 5202;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

// Mismo día/hora SOLEADO fijo para los 5 (día 262, hora 13h — verificado
// con estadoClimaDelDia) + `?nieve=N` forzando el nivel visual aparte del
// calendario real: así solo cambia la capa de nieve entre capturas, nunca
// el clima/luz del día (si se usa un día real por nivel, cada uno puede
// tener un clima de fondo distinto ese día y la comparación sale sucia).
const NIVELES = [0, 1, 2, 3, 4].map((nivel) => ({ nivel, dia: 262 }));

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
let fallos = 0;

for (const esc of NIVELES) {
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, DIA_FORZADO: "262", HORA_FORZADA: "13",
  });
  const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
    VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
  });
  const matar = () => {
    for (const p of [servidor, vite]) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };
  try {
    await new Promise((r) => setTimeout(r, 3500));
    const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(`http://localhost:${PUERTO_WEB}/?dia=${esc.dia}&hora=13&nieve=${esc.nivel}`, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(4000);
    const ruta = join(capturas, `nieve_nivel_${esc.nivel}.jpg`);
    await page.screenshot({ path: ruta, type: "jpeg", quality: 90 });
    console.log(`${errores.length === 0 ? "OK" : "FALLO"} nivel ${esc.nivel} (día ${esc.dia}) -> ${ruta}${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
    if (errores.length) fallos++;
    await browser.close();
  } catch (e) {
    console.log(`FALLO nivel ${esc.nivel}: ${e}`);
    fallos++;
  } finally {
    matar();
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log(fallos === 0 ? "\nTodos los niveles cargaron sin errores." : `\n${fallos} nivel(es) con errores.`);
process.exit(fallos === 0 ? 0 : 1);
