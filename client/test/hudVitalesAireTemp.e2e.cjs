"use strict";

// E2E VISUAL del HUD de vitales: temperatura (siempre visible) + aire
// (auditoría de interacciones 2026-09-13, hallazgo real: "aire"/"temperatura"
// YA replican desde el servidor (docs/GDD_Mecanicas.md §5.4, docs/
// GDD_Clima.md) pero NUNCA se leían en client/src/ui/hudVitales.ts — un
// jugador buceando no tenía NINGUNA forma de saber que se estaba quedando
// sin aire hasta que la vida ya empezaba a bajar de verdad (ahogarse mata en
// ~1 minuto sin aire, docs/GDD_Mecanicas.md).
//
// Usa `assets/mapas/test_mar_a` (100% agua, ya usado por
// combateArenaAcuatico.e2e.mjs) — CUALQUIER coordenada del mapa es agua real,
// así que el jugador spawnea ya nadando, sin tener que localizar un lago a
// mano en un mapa grande.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/hudVitalesAireTemp.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAR = path.join(RAIZ, "assets", "mapas", "test_mar_a");
const PUERTO_WS = 2651;
const PUERTO_WEB = 5251;
const NOMBRE = "HudVitalesTester";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return;
    } catch {}
    await esperar(500);
  }
  throw new Error(`No responde ${url}`);
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

async function main() {
  const procesos = [];
  const lanzar = (cmd, args, cwd, env) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
    p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
    procesos.push(p);
    return p;
  };
  const matarTodo = () => {
    for (const p of procesos) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };
  process.on("exit", matarTodo);

  let browser;
  try {
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_MAR, BD_RUTA: ":memory:",
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/test_mar_a",
    });
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real (mapa test_mar_a, 100% agua)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });
    await esperar(700); // deja que el primer tick de hudVitales.actualizar() (cada 500ms) se dispare

    // document.querySelector no entiende la sintaxis de selectores de
    // Playwright (:has-text/:text) — esta función corre DENTRO del
    // navegador vía page.evaluate, así que busca la fila por el texto real
    // de su emoji a mano, con DOM nativo.
    const filaInfo = (emoji) => `(() => {
      const fila = [...document.querySelectorAll(".hud-vitales-fila")].find(f => f.querySelector(".hud-vitales-emoji")?.textContent === "${emoji}");
      if (!fila) return null;
      return { visible: getComputedStyle(fila).display !== "none", ancho: fila.querySelector(".hud-vitales-relleno")?.style.width ?? null };
    })()`;

    console.log("2) el HUD arranca en la superficie (nadando, no buceando): temperatura siempre visible, aire OCULTO...");
    const infoTempInicial = await page.evaluate(filaInfo("🌡️"));
    comprobar("la fila de temperatura está visible desde el principio (siempre visible, no condicional)", !!infoTempInicial?.visible, JSON.stringify(infoTempInicial));
    comprobar("la barra de temperatura tiene un ancho real (~50%, valor por defecto)", /^\d+(\.\d+)?%$/.test(infoTempInicial?.ancho || "") && Math.abs(parseFloat(infoTempInicial.ancho) - 50) < 5, infoTempInicial?.ancho);

    const estadoInicial = (await page.evaluate(() => window.__colonyDebug)).estado;
    comprobar("en agua sin bucear el estado es 'nadando' (no 'buceando')", estadoInicial === "nadando", estadoInicial);
    const infoAireInicial = await page.evaluate(filaInfo("🫧"));
    comprobar("la fila de aire está OCULTA mientras solo se nada (no bucea todavía)", !infoAireInicial?.visible, JSON.stringify(infoAireInicial));

    console.log("3) buceando de verdad (nivel:-1) — la fila de aire debe aparecer con un valor real...");
    await page.evaluate(() => window.__test.enviar("nivel", -1));
    await page.waitForFunction(() => window.__colonyDebug?.estado === "buceando", null, { timeout: 5000 });
    await esperar(700); // siguiente tick de hudVitales

    const infoAireBuceando = await page.evaluate(filaInfo("🫧"));
    comprobar("la fila de aire aparece SOLA al bucear de verdad, sin tocar ningún panel", !!infoAireBuceando?.visible, JSON.stringify(infoAireBuceando));
    comprobar("la barra de aire tiene un ancho real (empieza llena, ~100%, y ya ha empezado a decaer buceando)", /^\d+(\.\d+)?%$/.test(infoAireBuceando?.ancho || ""), infoAireBuceando?.ancho);

    console.log("4) volviendo a la superficie (nivel:1) — la fila de aire debe ocultarse de nuevo...");
    await page.evaluate(() => window.__test.enviar("nivel", 1));
    await page.waitForFunction(() => window.__colonyDebug?.estado !== "buceando", null, { timeout: 5000 });
    await esperar(700);
    const infoAireAlSalir = await page.evaluate(filaInfo("🫧"));
    comprobar("la fila de aire se oculta de nuevo al salir a la superficie", !infoAireAlSalir?.visible, JSON.stringify(infoAireAlSalir));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: temperatura/aire ya son visibles en el HUD, ahogarse deja de ser invisible ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ hudVitalesAireTemp.e2e: TODO OK" : `\n❌ hudVitalesAireTemp.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
