// E2E VISUAL del arrastre de paneles (pedido streamer 2026-09-13: "falta
// añadir qe los paneles se puedan mover por si se solapan al abrir con
// click sobre el y arrastrarlo") — contra un servidor Colyseus real + Vite,
// arrastrando de verdad con `page.mouse` (nunca invocando el handler a
// mano) sobre DOS paneles reales del dock:
//   1) Ajustes (centrado por defecto, left:50%/top:50% + transform) — se
//      arrastra por su cabecera y se comprueba que la caja se mueve
//      exactamente lo arrastrado, que sigue abierto durante el gesto, y que
//      la X sigue cerrándolo con normalidad después de moverlo.
//   2) Con "Jugador" (icono 🧍, dock: "Personaje / Inventario (I)") abierto
//      en su esquina de siempre (16px/16px, sin transform) y Ajustes
//      arrastrado ENCIMA de esa esquina, se comprueba con
//      `elementFromPoint` que el panel arrastrado queda de verdad AL
//      FRENTE en la zona de solape — el motivo real del pedido ("por si se
//      solapan al abrir").
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/panelArrastrable.e2e.mjs
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

const PUERTO_WS = 2651;
const PUERTO_WEB = 5251;

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errores = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=E2E-Drag`);
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
  await espera(500);

  // --- 1) Abrir Ajustes (centrado) y arrastrarlo ---------------------
  await page.locator('.dock-hud-icono[title="Ajustes"]').click();
  const cabeceraAjustes = page.locator('.panel-colony-cabecera', { hasText: "Ajustes" });
  const rootAjustes = cabeceraAjustes.locator("xpath=..");
  await rootAjustes.waitFor({ state: "visible" });

  const antes = await rootAjustes.boundingBox();
  comprobar("Ajustes abre visible con una caja real", !!antes && antes.width > 0 && antes.height > 0);

  const cajaCabecera = await cabeceraAjustes.boundingBox();
  const grabX = cajaCabecera.x + 30; // dentro del texto del título, lejos de la X (evita arrancar un drag "sobre cerrar" sin querer)
  const grabY = cajaCabecera.y + cajaCabecera.height / 2;
  // Ajustes es un panel alto (~630px en 800px de viewport, "maxHeight:78vh")
  // — un deltaY grande chocaría con el clamp de "no salirse de la pantalla"
  // (comportamiento CORRECTO, no un bug: ver la comprobación de clamp más
  // abajo). 60px de bajada cabe de sobra sin tocar ese límite.
  const deltaX = 160, deltaY = 60;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + deltaX / 2, grabY + deltaY / 2, { steps: 4 });
  // A MEDIO arrastre, el panel debe seguir abierto (no lo cierra el
  // 'mousedown' de clic-fuera ni nada del propio gesto).
  const elAjustes = await rootAjustes.elementHandle();
  const abiertoAMedias = await page.evaluate((el) => getComputedStyle(el).display !== "none", elAjustes);
  comprobar("Ajustes sigue ABIERTO a mitad de arrastre", abiertoAMedias);
  await page.mouse.move(grabX + deltaX, grabY + deltaY, { steps: 4 });
  await page.mouse.up();
  await espera(150);

  const despues = await rootAjustes.boundingBox();
  const movioX = despues.x - antes.x, movioY = despues.y - antes.y;
  comprobar(
    `arrastrar la cabecera mueve el panel exactamente lo arrastrado (Δ=${deltaX},${deltaY})`,
    Math.abs(movioX - deltaX) < 2 && Math.abs(movioY - deltaY) < 2,
    `movió (${movioX.toFixed(1)},${movioY.toFixed(1)})`,
  );
  await page.screenshot({ path: join(capturas, "panelArrastrable_tras_arrastrar.png") });

  comprobar("Ajustes sigue ABIERTO tras soltar", await page.evaluate((el) => getComputedStyle(el).display !== "none", elAjustes));

  // La X sigue funcionando con normalidad después de haber arrastrado el panel.
  await rootAjustes.locator(".panel-colony-cerrar").click();
  await espera(150);
  comprobar("la X sigue cerrando el panel tras haberlo arrastrado", !(await page.evaluate((el) => getComputedStyle(el).display !== "none", elAjustes)));

  // --- 2) Solape real: arrastrar Ajustes encima de "Jugador" y --------
  //        comprobar que queda AL FRENTE (z-index) donde se solapan -------
  await page.locator('.dock-hud-icono[title="Personaje / Inventario (I)"]').click();
  const cabeceraJugador = page.locator('.panel-colony-cabecera', { hasText: "Jugador" });
  const rootJugador = cabeceraJugador.locator("xpath=..");
  await rootJugador.waitFor({ state: "visible" });
  const cajaJugadorInicial = await rootJugador.boundingBox();
  comprobar("panel de Jugador abre en su esquina de siempre (16px/16px aprox.)", cajaJugadorInicial.x < 40 && cajaJugadorInicial.y < 40);

  // Esa esquina (16,16) queda DEBAJO del HUD de vitales SIEMPRE-VISIBLE
  // (`.hud-vitales`, z-index:90 — por encima de cualquier panel normal,
  // z-index base 40): un punto de agarre ahí no llega ni a la cabecera de
  // Jugador (el HUD se lleva el evento) — hay que agarrar más a la derecha,
  // fuera del ancho del HUD. Mueve Jugador a un hueco limpio de pantalla
  // antes de solaparlo con Ajustes, para que el resultado del solape lo
  // decida de verdad el arrastre (y su z-index), no un HUD fijo ajeno a la prueba.
  const cabJugCaja = await cabeceraJugador.boundingBox();
  const hudVitalesCaja = await page.locator(".hud-vitales").boundingBox();
  const grabJugX = Math.min(cabJugCaja.x + cabJugCaja.width - 40, Math.max(cabJugCaja.x + 30, hudVitalesCaja.x + hudVitalesCaja.width + 10));
  await page.mouse.move(grabJugX, cabJugCaja.y + cabJugCaja.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 300, { steps: 6 });
  await page.mouse.up();
  await espera(150);
  const cajaJugador = await rootJugador.boundingBox();

  await page.locator('.dock-hud-icono[title="Ajustes"]').click();
  await rootAjustes.waitFor({ state: "visible" });
  const cajaCabecera2 = await cabeceraAjustes.boundingBox();
  const grab2X = cajaCabecera2.x + 30;
  const grab2Y = cajaCabecera2.y + cajaCabecera2.height / 2;
  const rectAjustesAntes2 = await rootAjustes.boundingBox();
  const offsetX2 = grab2X - rectAjustesAntes2.x;
  const offsetY2 = grab2Y - rectAjustesAntes2.y;
  // Objetivo: que la esquina superior-izquierda de Ajustes acabe EXACTAMENTE
  // sobre la de Jugador (ya reubicado, lejos de cualquier HUD fijo).
  const destinoX = cajaJugador.x + offsetX2;
  const destinoY = cajaJugador.y + offsetY2;
  // Lejos de la esquina redondeada (`border-radius:10px` — Chromium excluye
  // ese cuarto de círculo del hit-testing, un punto pegado a la esquina
  // puede dar `elementFromPoint` = null pese a estar "dentro" de la caja
  // rectangular) — 40px de margen cae de sobra dentro del rectángulo recto.
  const puntoSolapeX = cajaJugador.x + 40;
  const puntoSolapeY = cajaJugador.y + 40;

  await page.mouse.move(grab2X, grab2Y);
  await page.mouse.down();
  await page.mouse.move(destinoX, destinoY, { steps: 8 });
  await page.mouse.up();
  await espera(150);
  await page.screenshot({ path: join(capturas, "panelArrastrable_solape.png") });

  const elementoEnSolape = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const marco = el?.closest(".panel-colony");
      return marco?.querySelector(".panel-colony-cabecera")?.textContent ?? null;
    },
    { x: puntoSolapeX, y: puntoSolapeY },
  );
  comprobar(
    "en la zona de solape, el panel ARRASTRADO (Ajustes) queda al frente, no el de detrás (Jugador)",
    (elementoEnSolape ?? "").includes("Ajustes"),
    `elementFromPoint dio "${elementoEnSolape}"`,
  );

  const elJugador = await rootJugador.elementHandle();
  const elAjustes2 = await rootAjustes.elementHandle();
  const zAjustes = await page.evaluate((el) => Number(getComputedStyle(el).zIndex), elAjustes2);
  const zJugador = await page.evaluate((el) => Number(getComputedStyle(el).zIndex), elJugador);
  comprobar(`z-index del panel recién arrastrado (${zAjustes}) es mayor que el del otro panel abierto (${zJugador})`, zAjustes > zJugador);

  comprobar("sin errores de página en toda la prueba", errores.length === 0, errores.join(" | "));
} finally {
  await browser.close();
  matar();
}

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
