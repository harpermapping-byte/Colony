// E2E real de la caza por CLIC + persecución automática (docs/GDD_Caza.md
// §4ter, 2026-09-10): servidor Colyseus real + Vite + UNA página Playwright
// sobre el mapa principal. Con una sola página (a diferencia del playtest
// multijugador de 4, donde la latencia CDP bajo carga hace que un clic sobre
// un animal en movimiento llegue tarde) el camino REAL se puede probar de
// punta a punta:
//   1) clic real (page.mouse.click) sobre el rig de un animal no peligroso
//      → menú de interacción con "Cazar <especie>";
//   2) clic en "Cazar" → combate:iniciar → caza:iniciada, y el cliente
//      activa la persecución automática (__cazaAuto());
//   3) SIN tocar ninguna tecla, el jugador alcanza a la presa
//      (caza:atrapado) y la persecución se apaga sola.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/cazaClic.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const CAPTURAS = join(dirCliente, "test", "capturas");
mkdirSync(CAPTURAS, { recursive: true });
const BD = join(tmpdir(), "colony_caza_clic_e2e.sqlite");
const WS = 2618, WEB = 5218, NOMBRE = "Cazador";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (n, ok, d) => { console.log(`${ok ? "OK" : "FALLO"} ${n}${d ? ` (${d})` : ""}`); if (!ok) fallos++; };

const procesos = [];
const lanzar = (cmd, args, cwd, env) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); procesos.push(p); return p; };
const matarTodo = () => { for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} } rmSync(BD, { force: true }); };
process.on("exit", matarTodo);

rmSync(BD, { force: true });
lanzar("npx", ["tsx", "src/index.ts"], join(dirRaiz, "server"), { PORT: String(WS), RUTA_MAPA: join(dirRaiz, "assets", "mapas", "principal"), BD_RUTA: BD, JARL_NOMBRES: NOMBRE });
lanzar("npx", ["vite", "--port", String(WEB), "--strictPort"], dirCliente, { VITE_COLYSEUS_URL: `ws://localhost:${WS}`, VITE_RUTA_MAPA: "/assets/mapas/principal" });
for (const url of [`http://localhost:${WS}/`, `http://localhost:${WEB}/`]) for (let i = 0; i < 240; i++) { try { await fetch(url); break; } catch {} await esperar(500); }

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e?.stack || e).split("\n").slice(0, 2).join(" | ")));
  await page.goto(`http://localhost:${WEB}/?nombre=${NOMBRE}`, { waitUntil: "commit", timeout: 120000 });
  await page.waitForFunction(() => window.__colonyDebug && window.__test && window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 150000 });

  // Zona junto al río con fauna variada (misma que el playtest multijugador).
  await page.evaluate(() => window.__test.enviar("admin:debug:teleport", { x: 1310.5, y: 2040.5 }));
  await page.waitForFunction(() => Math.abs(window.__colonyDebug.x - 1310.5) < 1.5, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__fauna().length > 0, null, { timeout: 30000 }).catch(() => {});
  const fauna = await page.evaluate(() => window.__fauna());
  comprobar("hay fauna viva replicada cerca", fauna.length > 0, `${fauna.length}`);
  const DIMINUTA = /raton|ardilla|avispa|avispon|abeja|mariposa|libelula|escarabajo|hormiga|grillo|saltamontes|mosquito|lombriz|caracol|rana|sapo|lagart|carpa|trucha|pez|bacalao|sardina|salmon|anguila|lucio|barbo|cangrejo|medusa|pulpo|calamar|almeja|mejillon|ostra|erizo|estrella|anemona|pepino|tiburon|orca|ballena|delfin|foca|morsa/;
  const PELIGROSA = /avispa|avispon|abeja|lobo|oso|jabal|serpiente|vibora|escorpion|tiburon|orca|cocodrilo|puma|lince/;
  const sinPeligroCerca = (f) => !fauna.some((g) => PELIGROSA.test(g.especieId) && Math.hypot(g.x - f.x, g.y - f.y) < 12);
  const presa = fauna.find((f) => !DIMINUTA.test(f.especieId) && !PELIGROSA.test(f.especieId) && sinPeligroCerca(f)) || fauna.find((f) => !PELIGROSA.test(f.especieId));
  if (!presa) throw new Error("sin presa no peligrosa cerca del río — cambia la zona del test");
  console.log(`   presa: ${presa.especieId} (${presa.id}) en (${presa.x.toFixed(1)},${presa.y.toFixed(1)})`);

  // A 7 casillas (fuera de radioHuida=4), cámara estable antes de proyectar.
  await page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), { x: presa.x + 7, y: presa.y });
  await page.waitForFunction((x) => Math.abs(window.__colonyDebug.x - x) < 3, presa.x + 7, { timeout: 30000 });
  await page.waitForFunction(() => {
    const p = window.__proyectarMundo(window.__colonyDebug.x, window.__colonyDebug.y);
    const ok = window.__ultimaProj && Math.hypot(window.__ultimaProj.x - p.x, window.__ultimaProj.y - p.y) < 1.5;
    window.__ultimaProj = p;
    return ok;
  }, null, { timeout: 60000, polling: 300 });

  const boton = page.getByRole("button", { name: /^Cazar / });
  let menuOk = false;
  for (const altura of [0.3, 0.6, 0.15, 0.9]) {
    const ahora = await page.evaluate((id) => window.__fauna().find((f) => f.id === id) || null, presa.id);
    if (!ahora) break;
    const px = await page.evaluate(({ x, y, h }) => window.__proyectarMundo(x, y, h), { x: ahora.x, y: ahora.y, h: altura });
    await page.mouse.click(px.x, px.y);
    menuOk = await boton.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    if (menuOk) break;
    await page.keyboard.press("Escape");
  }
  comprobar("clic sobre el animal abre el menú con 'Cazar <especie>'", menuOk, menuOk ? await boton.textContent() : "sin menú");
  await page.screenshot({ path: join(CAPTURAS, "caza_clic_menu.png") });

  if (menuOk) {
    await boton.click();
    const arranque = await page.waitForFunction(() => window.__test.ultimoMensaje("caza:iniciada") || window.__test.ultimoMensaje("combate:error"), null, { timeout: 20000 })
      .then(() => page.evaluate(() => ({ iniciada: window.__test.ultimoMensaje("caza:iniciada"), error: window.__test.ultimoMensaje("combate:error") })))
      .catch(() => null);
    comprobar("'Cazar' arranca la caza (caza:iniciada)", !!arranque?.iniciada, JSON.stringify(arranque));
    if (arranque?.iniciada) {
      const auto = await page.evaluate(() => window.__cazaAuto());
      comprobar("la persecución automática queda activa en el cliente", auto === presa.id, String(auto));
      const t0 = Date.now();
      const pos0 = await page.evaluate(() => ({ x: window.__colonyDebug.x, y: window.__colonyDebug.y }));
      const atrapado = await page.waitForFunction(() => !!window.__test.ultimoMensaje("caza:atrapado"), null, { timeout: 90000 }).then(() => true).catch(() => false);
      const pos1 = await page.evaluate(() => ({ x: window.__colonyDebug.x, y: window.__colonyDebug.y }));
      const recorrido = Math.hypot(pos1.x - pos0.x, pos1.y - pos0.y);
      comprobar("el jugador alcanza a la presa SOLO, sin tocar teclas (caza:atrapado)", atrapado, `${((Date.now() - t0) / 1000).toFixed(1)}s, recorrió ${recorrido.toFixed(1)} casillas`);
      comprobar("la persecución se movió de verdad (el jugador no se quedó quieto)", recorrido > 1, `${recorrido.toFixed(1)} casillas`);
      const autoTras = await page.evaluate(() => window.__cazaAuto());
      comprobar("la persecución automática se apaga sola al atrapar", autoTras === null, String(autoTras));
      await page.screenshot({ path: join(CAPTURAS, "caza_clic_atrapado.png") });
    }
  }
  comprobar("sin errores de página", errores.length === 0, errores.slice(0, 3).join(" || "));
} catch (e) {
  fallos++;
  console.error("❌", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  matarTodo();
}
console.log(fallos === 0 ? "\n✅ cazaClic.e2e: TODO OK" : `\n❌ cazaClic.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
