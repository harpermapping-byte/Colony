"use strict";
// Prueba visual manual de escaleras=TP (docs/GDD_Sistema_Puertas.md): entra
// directo al interior de un castillo multi-planta (bake de prueba en
// assets/mapas/torre_test), camina hasta la escalera de la planta baja,
// interactúa y comprueba que cambia de planta (URL ?nivel=1, geometría
// distinta, aparece junto al conector). NO es parte de la suite automática.
// Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_escaleras.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_escaleras");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const MAPA_ID = "torre_test";
const EDIFICIO_ID = "castillo_torre-test:castillo:0";

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

async function andarHacia(page, tx, ty, tSegs) {
  const inicio = Date.now();
  let activas = new Set();
  let mejorDist = Infinity;
  let sinProgresoDesde = Date.now();
  const ponerTeclas = async (nuevas) => {
    for (const k of activas) if (!nuevas.has(k)) await page.keyboard.up(k);
    for (const k of nuevas) if (!activas.has(k)) await page.keyboard.down(k);
    activas = nuevas;
  };
  while ((Date.now() - inicio) / 1000 < tSegs) {
    const pos = await page.evaluate(() => (window).__colonyDebug || null);
    if (!pos) { await esperar(200); continue; }
    const dx = tx - pos.x, dy = ty - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) break;
    if (dist < mejorDist - 0.3) { mejorDist = dist; sinProgresoDesde = Date.now(); }
    const nuevas = new Set();
    if (Math.abs(dx) > 0.3) nuevas.add(dx > 0 ? "d" : "a");
    if (Math.abs(dy) > 0.3) nuevas.add(dy > 0 ? "s" : "w");
    if (Date.now() - sinProgresoDesde > 2000) {
      const perpendicular = Math.abs(dx) > Math.abs(dy) ? (Math.random() < 0.5 ? "w" : "s") : (Math.random() < 0.5 ? "a" : "d");
      nuevas.add(perpendicular);
      sinProgresoDesde = Date.now();
    }
    await ponerTeclas(nuevas);
    await esperar(200);
  }
  await ponerTeclas(new Set());
  await esperar(300);
  const final = await page.evaluate(() => (window).__colonyDebug || null);
  console.log(`  andarHacia(${tx},${ty}): llegó a`, JSON.stringify(final));
  return final;
}

async function main() {
  const procesos = [];
  const lanzar = (comando, args, cwd, env) => {
    const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, detached: true });
    p.stdout.on("data", (d) => process.stdout.write(`[${comando}] ${d}`));
    p.stderr.on("data", (d) => process.stderr.write(`[${comando}] ${d}`));
    procesos.push(p);
    return p;
  };
  const matarTodo = () => {
    for (const p of procesos) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };

  try {
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {});
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), {});
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => { if (msg.type() === "error") console.log("[consola]", msg.text()); });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    // --- Planta baja del castillo: conector hacia planta alta en (15,15), huella 1x3 ---
    const url0 = `http://localhost:5199/?sala=interior&mapaId=${encodeURIComponent(MAPA_ID)}&edificio=${encodeURIComponent(EDIFICIO_ID)}&nivel=0&nombre=Explorador`;
    await page.goto(url0);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_planta_baja.png") });
    console.log("captura 1: planta baja del castillo, url:", page.url());

    // Castillo con muchas salas: la dirección diagonal simple se atasca en
    // laberintos de puertas, así que el camino sala-a-sala se calcula antes
    // por BFS sobre la MISMA rejilla de colisión que carga el servidor
    // (server/src/mundo/interiorColision.ts) — ver waypoints_escalera.json.
    const waypoints = JSON.parse(fs.readFileSync("/tmp/waypoints_escalera.json", "utf8"));
    for (const wp of waypoints) {
      await andarHacia(page, wp.x, wp.y, 6);
    }
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_junto_a_escalera.png") });
    console.log("captura 2: junto a la escalera de planta baja");

    await page.keyboard.press("f");
    await esperar(3500);
    await esperar(2000);

    const url1 = page.url();
    console.log("URL tras usar la escalera:", url1);
    const nivelOk = /[?&]nivel=1(&|$)/.test(url1);
    console.log("¿cambió a nivel=1?", nivelOk);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "3_planta_alta.png") });

    const pos1 = await page.evaluate(() => (window).__colonyDebug || null);
    console.log("posición en planta alta (esperado cerca de 8.5,13.5):", JSON.stringify(pos1));

    if (!nivelOk) throw new Error("La escalera no cambió de planta (nivel no pasó a 1 en la URL)");

    console.log(`\nOK — capturas en ${CARPETA_CAPTURAS}`);
    await browser.close();
  } finally {
    matarTodo();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
