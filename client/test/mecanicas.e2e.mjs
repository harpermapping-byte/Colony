// E2E de la mecánica de colisiones/agua contra el juego REAL: arranca el
// servidor Colyseus y el cliente Vite, conduce al PJ con el teclado y
// comprueba la verdad del servidor a través de window.__colonyDebug.
// Coordenadas del mapa demo (semilla demo-cliente-01): spawn en (30.5,18.5),
// lago profundo al oeste (x<30) y pared de roca_inaccesible al este (x=34).
//   node test/mecanicas.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2599;
const PUERTO_WEB = 5199;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  // detached + kill del GRUPO entero al salir: npx lanza tsx/vite como
  // nietos, y matar solo al wrapper deja zombis en los puertos que rompen
  // la siguiente ronda de e2e de forma incomprensible.
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

// Este test depende de la GEOMETRÍA DEL DEMO (lago/roca en casillas
// concretas): se fuerza el demo en servidor y cliente aunque el juego real
// corra sobre el mapa principal por streaming.
const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo });
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
  VITE_RUTA_MAPA: "/assets/mapas/demo",
});
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 3500)); // arranque de ambos procesos

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}
const debug = () => page.evaluate(() => window.__colonyDebug);
const mantener = async (tecla, ms) => { await page.keyboard.down(tecla); await page.waitForTimeout(ms); await page.keyboard.up(tecla); };

await page.goto(`http://localhost:${PUERTO_WEB}/`);
await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 15000 });
let d = await debug();
comprobar("spawn en suelo firme junto al lago", d.estado === "tierra" && Math.abs(d.x - 30.5) < 0.6 && Math.abs(d.y - 18.5) < 0.6, JSON.stringify(d));
await page.screenshot({ path: join(capturas, "m1_spawn.png") });

// al oeste hay lago profundo: entrar andando debe pasar a nadar
await mantener("a", 1100);
await page.waitForTimeout(300);
d = await debug();
comprobar("entrar al agua cambia a nadando", d.estado === "nadando" && d.x < 30, JSON.stringify(d));
await page.screenshot({ path: join(capturas, "m2_nadando.png") });

// bucear: Q baja hasta -2 en agua profunda, E sube
await page.keyboard.press("q");
await page.waitForTimeout(250);
d = await debug();
comprobar("Q baja a nivel -1 (buceando)", d.estado === "buceando" && d.nivel === -1, JSON.stringify(d));
await page.keyboard.press("q");
await page.keyboard.press("q"); // el tercer Q no debe pasar de -2
await page.waitForTimeout(250);
d = await debug();
comprobar("el fondo del buceo es -2", d.nivel === -2, JSON.stringify(d));
await page.screenshot({ path: join(capturas, "m3_buceando.png") });
await page.keyboard.press("e");
await page.waitForTimeout(250);
d = await debug();
comprobar("E sube un nivel", d.nivel === -1, JSON.stringify(d));

// volver a tierra: el nivel se resetea y el estado vuelve a tierra
await mantener("d", 1600);
await page.waitForTimeout(300);
d = await debug();
comprobar("salir del agua devuelve a tierra con nivel 0", d.estado === "tierra" && d.nivel === 0, JSON.stringify(d));

// seguir al este hasta la pared de roca_inaccesible en x=34: se para en el borde
await mantener("d", 3000);
await page.waitForTimeout(400);
d = await debug();
comprobar("la pared bloquea (se queda pegado al borde de x=34)", d.x > 33.0 && d.x < 33.7, JSON.stringify(d));
await page.screenshot({ path: join(capturas, "m4_pared.png") });

comprobar("sin errores de página", errores.length === 0, errores.join(" | "));
await browser.close();
matar();
console.log(fallos ? `${fallos} comprobaciones FALLARON` : "E2E de mecánicas OK");
process.exit(fallos ? 1 : 0);
