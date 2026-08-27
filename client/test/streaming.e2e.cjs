"use strict";

// E2E del streaming sobre el MAPA PRINCIPAL real: levanta servidor Colyseus
// + vite dev, abre el cliente con Playwright y comprueba que al spawnear en
// la ciudad se materializa el anillo inicial de sectores (y solo ese), que
// el render pinta sin errores de consola y deja una captura para revisión
// visual. La lógica fina de caminatas/histéresis se prueba en Node
// (streaming.test.ts) — aquí se valida la integración real.
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/streaming.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
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

async function main() {
  const procesos = [];
  const lanzar = (comando, args, cwd) => {
    const p = spawn(comando, args, { cwd, stdio: "pipe", env: { ...process.env } });
    procesos.push(p);
    return p;
  };

  let fallos = 0;
  const comprobar = (condicion, mensaje) => {
    console.log(`${condicion ? "ok" : "FALLO"} - ${mensaje}`);
    if (!condicion) fallos++;
  };

  try {
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"));
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"));
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      // El 404 de la sonda .glb es esperado (especies sin arte aún).
      if (msg.type() === "error" && !msg.text().includes("404")) erroresConsola.push(msg.text());
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    await page.goto("http://localhost:5199/");

    // Esperar a que el streaming exista y materialice su anillo inicial.
    await page
      .waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 })
      .catch(() => {});
    // Margen para que acaben los props del último sector.
    await esperar(3000);

    const stats = await page.evaluate(() => (window.__streaming ? window.__streaming() : null));
    console.log("estadísticas del streaming:", JSON.stringify(stats));

    comprobar(stats !== null, "el streaming está activo (sonda __streaming presente)");
    // El spawn de la ciudad (1600,1600) cae en la juntura de 4 sectores:
    // el anillo inicial correcto son esos 4 — ni el mapa entero ni 0.
    comprobar(stats && stats.materializados === 4, `anillo inicial de 4 sectores materializados (hay ${stats && stats.materializados})`);
    comprobar(stats && stats.clavesMaterializadas.join(",") === "4_4,4_5,5_4,5_5", `los sectores correctos alrededor de la ciudad (${stats && stats.clavesMaterializadas})`);
    comprobar(stats && stats.enVuelo === 0 && stats.materializando === 0, "sin cargas colgadas");
    comprobar(erroresConsola.length === 0, `sin errores de consola (${erroresConsola.slice(0, 3).join(" | ")})`);

    await page.screenshot({ path: path.join(__dirname, "streaming_spawn.png") });
    console.log("captura: client/test/streaming_spawn.png");

    await browser.close();
  } finally {
    for (const p of procesos) p.kill("SIGKILL");
  }

  console.log(fallos === 0 ? "E2E OK" : `E2E con ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
