"use strict";

// E2E VISUAL del peso actual/máximo transportable en el panel de jugador
// (auditoría de interacciones 2026-09-13, hallazgo real: `pesoMaximoTransportable`
// ya bloqueaba coger/craftear de verdad desde el diseño original — el
// jugador solo se enteraba de su límite cuando un "coger:error" ya lo
// rechazaba, sin ninguna forma de saber cuánto llevaba encima o cuánto le
// quedaba antes de eso).
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/panelJugadorPeso.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const PUERTO_WS = 2653;
const PUERTO_WEB = 5253;
const NOMBRE_JARL = "PesoTester";

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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_DEMO, BD_RUTA: ":memory:", JARL_NOMBRES: NOMBRE_JARL,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
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

    console.log("1) cargando cliente real (mapa demo, jarl real)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    console.log("2) abriendo el panel de jugador (tecla I) sin nada en el cuerpo: peso 0.0/20 kg (fuerza nivel 1)...");
    await page.keyboard.press("i");
    await esperar(300);
    const textoInicial = await page.evaluate(() => document.body.innerText);
    comprobar("el panel muestra 'Peso' con 0.0/20 kg antes de dar nada", /⚖\s*0(\.0)?\/20\s*kg/.test(textoInicial), textoInicial.split("\n").find((l) => l.includes("⚖")));

    console.log("3) dando 4x piedra_comun (2.5kg cada una = 10.0kg reales) — el panel debe reflejarlo...");
    await page.evaluate(() => window.__test.enviar("admin:debug:darItem", { itemId: "piedra_comun", cantidad: 4 }));
    // El panel solo redibuja en cada patch/onChange de player — cerrar y
    // reabrir fuerza un render fresco. La latencia real del patch de red en
    // este sandbox es variable (CDP sin GPU), así que en vez de un `esperar`
    // fijo se reintenta el toggle hasta que el peso realmente cambie, con un
    // tope generoso — más robusto que adivinar un tiempo fijo de sobra.
    let textoConPeso = "";
    for (let intento = 0; intento < 20; intento++) {
      await page.keyboard.press("i");
      await esperar(150);
      await page.keyboard.press("i");
      await esperar(150);
      textoConPeso = await page.evaluate(() => document.body.innerText);
      if (/⚖\s*10(\.0)?\/20\s*kg/.test(textoConPeso)) break;
    }
    comprobar("el panel refleja el peso real tras dar 4x piedra_comun (10.0/20 kg)", /⚖\s*10(\.0)?\/20\s*kg/.test(textoConPeso), textoConPeso.split("\n").find((l) => l.includes("⚖")));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: peso actual/máximo transportable ya es visible en el panel de jugador ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ panelJugadorPeso.e2e: TODO OK" : `\n❌ panelJugadorPeso.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
