// E2E VISUAL del toggle real del menú de interacción por clic sobre el
// terreno (bug real reportado por el streamer 2026-09-10: "el click sobre
// terreno sentarse aqui si le das click otra vez sobre terreno no
// desaparece la pantalla de sentarse aqui si no que se mueve de sitio, la
// idea es click se abre pantalla clic se quita y si quiero volver a
// sentarme en un lado o abrir esa pantalla de interaccion he de dar click
// otra vez"). Causa real (`client/src/ui/menuInteraccion.ts` +
// `client/src/game.ts`): `mousedown` (el cierre "clic fuera" del propio
// menú) SIEMPRE se dispara antes que `click` (el listener del lienzo que
// decide qué abrir) para la MISMA pulsación — así que un clic en un punto
// DISTINTO del lienzo ya encontraba el menú oculto por el mousedown y
// procedía a abrir uno NUEVO en la posición nueva, en vez de solo cerrar.
//
// Tres clics reales con page.mouse.click(x,y) en coordenadas de pantalla
// DISTINTAS (no se invoca ningún handler a mano): 1) abre el menú, 2) en
// otro punto del lienzo debe CERRARLO sin más (nunca reabrir en el sitio
// nuevo), 3) un tercer clic aparte sí abre uno nuevo en su sitio.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/menuInteraccionToggle.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2598;
const PUERTO_WEB = 5198;
const NOMBRE = "E2E-MenuToggle";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const rutaDemo = join(dirRaiz, "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: ":memory:",
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
process.on("exit", matar);

await new Promise((r) => setTimeout(r, 3500));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

const menu = '[data-testid="menu-interaccion"]';
function visible(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== "none";
  }, menu);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

try {
  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${encodeURIComponent(NOMBRE)}`);
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
  await espera(600);

  // Tres puntos bien separados dentro del lienzo (esquinas opuestas +
  // centro) — cualquiera de los 3 puede caer sobre terreno vacío ("Suelo")
  // o sobre un prop decorativo del mapa demo; da igual para lo que se
  // prueba, solo importa que CADA clic aterrice en el <canvas> real.
  const A = { x: 300, y: 250 };
  const B = { x: 800, y: 550 };
  const C = { x: 550, y: 650 };

  console.log("1) primer clic (A) — debe ABRIR el menú...");
  await page.mouse.click(A.x, A.y);
  await page.waitForTimeout(150);
  comprobar("menú visible tras el 1er clic", await visible(page));
  await page.screenshot({ path: join(capturas, "menutoggle1_abierto.png") });

  console.log("2) segundo clic en un punto DISTINTO (B) — debe CERRARLO, nunca moverlo...");
  await page.mouse.click(B.x, B.y);
  await page.waitForTimeout(150);
  comprobar("menú OCULTO tras el 2º clic en otro sitio (no se movió, se cerró)", !(await visible(page)));
  await page.screenshot({ path: join(capturas, "menutoggle2_cerrado.png") });

  console.log("3) tercer clic aparte (C) — con el menú ya cerrado, este SÍ debe abrir uno nuevo...");
  await page.mouse.click(C.x, C.y);
  await page.waitForTimeout(150);
  comprobar("menú visible de nuevo tras el 3er clic (uno aparte, no el mismo gesto)", await visible(page));
  await page.screenshot({ path: join(capturas, "menutoggle3_reabierto.png") });

  console.log("4) con el menú YA abierto, clic en un icono del dock (fuera del lienzo) — no debe tragarse el SIGUIENTE clic real del lienzo...");
  const iconoDock = page.locator(".dock-hud-icono").first();
  await iconoDock.click(); // cierra el menú vía mousedown "fuera", pero este clic nunca llega al listener del lienzo (abre/cierra un panel del dock en su lugar)
  await page.waitForTimeout(150);
  comprobar("el menú se cerró también al tocar el dock (mousedown fuera, mismo mecanismo)", !(await visible(page)));
  await iconoDock.click(); // deja ese panel del dock como estaba (cerrado), sin dejar nada abierto de más
  await page.waitForTimeout(150);
  await page.mouse.click(A.x, A.y); // este SÍ debe abrir, no quedar tragado por una bandera colgada del paso anterior
  await page.waitForTimeout(150);
  comprobar("un clic real en el lienzo tras tocar el dock SÍ abre el menú (la bandera no se queda colgada)", await visible(page));

  comprobar("sin errores de JS en la página", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ menuInteraccionToggle.e2e: todo OK" : `\n❌ menuInteraccionToggle.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("menuInteraccionToggle.e2e reventó:", err);
  await page.screenshot({ path: join(capturas, "menutoggle_error.png") }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
