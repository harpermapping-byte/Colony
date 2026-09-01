// Verificación VISUAL rápida del sistema de clima (docs/GDD_Clima.md,
// pasada 2026-09-01): arranca servidor+cliente reales sobre el mapa demo,
// fuerza día/hora concretos (mismo mecanismo DIA_FORZADO/?dia= que ya usa
// el resto del proyecto para pruebas) y captura pantalla en cada escenario
// — nieve acumulada al máximo, lluvia, niebla. No es un test de assert,
// es la comprobación "se ve, no rompe nada" que pide CLAUDE.md antes de
// dar por hecho un cambio visual.
//   node test/climaVisual.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2601;
const PUERTO_WEB = 5201;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

// Escenarios encontrados programáticamente (server/src/mundo/clima.ts +
// nieve.ts) — ver el cálculo en el mensaje de la sesión: día 270 acumula
// nieve al nivel máximo (4), día 7 a las 12h llueve, día 2 a las 0h hay niebla.
// "nieve_max" prueba la CAPA ACUMULADA (nivelNieve, server/src/mundo/nieve.ts),
// que es independiente del clima instantáneo de esa hora concreta — por
// eso no comprueba `esperado` de tipo de clima, solo que cargue sin roturas
// y se vea la capa blanca de fondo (revisar la captura a mano).
const ESCENARIOS = [
  { nombre: "nieve_max", dia: 270, hora: 13, esperado: null },
  { nombre: "lluvia", dia: 7, hora: 12, esperado: "lluvia" },
  { nombre: "niebla", dia: 3, hora: 6, esperado: "niebla" },
];

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
let fallos = 0;

for (const esc of ESCENARIOS) {
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, DIA_FORZADO: String(esc.dia), HORA_FORZADA: String(esc.hora),
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
    await page.goto(`http://localhost:${PUERTO_WEB}/?dia=${esc.dia}&hora=${esc.hora}`, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(4000); // conectar a la room + cargar sector + unas cuantas vueltas de partículas
    const climaResuelto = await page.evaluate(() => (window).__clima ? (window).__clima() : "(sin sonda)");
    const ruta = join(capturas, `clima_${esc.nombre}.png`);
    await page.screenshot({ path: ruta });
    const climaOk = esc.esperado === null || climaResuelto === esc.esperado;
    console.log(`${errores.length === 0 && climaOk ? "OK" : "FALLO"} ${esc.nombre} -> ${ruta} (clima resuelto: ${climaResuelto}, esperado: ${esc.esperado})${errores.length ? " ERRORES: " + errores.join(" | ") : ""}`);
    if (errores.length || !climaOk) fallos++;
    await browser.close();
  } catch (e) {
    console.log(`FALLO ${esc.nombre}: ${e}`);
    fallos++;
  } finally {
    matar();
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log(fallos === 0 ? "\nTodos los escenarios cargaron sin errores de página." : `\n${fallos} escenario(s) con errores.`);
process.exit(fallos === 0 ? 0 : 1);
