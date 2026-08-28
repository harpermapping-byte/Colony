"use strict";
// Prueba visual manual del sistema de puertas (docs/GDD_Sistema_Puertas.md):
// hub de prueba -> puerta -> región (aldea real) -> puerta de un edificio ->
// interior -> puerta -> vuelta a la región. Saca capturas en cada etapa. NO
// es parte de la suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_puertas.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_puertas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

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

// Mantiene teclas de movimiento (diagonal si hace falta) hacia (tx,ty)
// hasta acercarse o agotar tSegs; si se queda atascado unos segundos sin
// avanzar, prueba una tecla "de escape" perpendicular para rodear el
// obstáculo (naive, pero basta para un e2e).
async function andarHacia(page, tx, ty, tSegs) {
  const TODAS = ["w", "a", "s", "d"];
  const inicio = Date.now();
  let activas = new Set();
  let mejorDist = Infinity;
  let sinProgresoDesde = Date.now();
  const soltarTodo = async () => { for (const k of activas) await page.keyboard.up(k); activas = new Set(); };
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
    // atascado >2s: añade una tecla perpendicular al azar para rodear
    if (Date.now() - sinProgresoDesde > 2000) {
      const perpendicular = Math.abs(dx) > Math.abs(dy) ? (Math.random() < 0.5 ? "w" : "s") : (Math.random() < 0.5 ? "a" : "d");
      nuevas.add(perpendicular);
      sinProgresoDesde = Date.now();
    }
    await ponerTeclas(nuevas);
    await esperar(200);
  }
  await soltarTodo();
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
    const rutaHub = path.join(RAIZ, "assets", "mapas", "hub_test");
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { RUTA_MAPA: rutaHub });
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), { VITE_RUTA_MAPA: "/assets/mapas/hub_test" });
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => { if (msg.type() === "error") console.log("[consola]", msg.text()); });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    // --- 1. Hub de prueba: aparece cerca de la puerta a la aldea ---
    await page.goto("http://localhost:5199/?nombre=Explorador");
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_hub.png") });
    console.log("captura 1: hub de prueba");

    await andarHacia(page, 32, 19, 6);
    await page.keyboard.press("f");
    await esperar(3500); // recarga de página al cruzar

    // --- 2. Región (aldea real) ---
    await esperar(2000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_region_aldea.png") });
    console.log("captura 2: dentro de la región (aldea)");

    const pos2 = await page.evaluate(() => (window).__colonyDebug || null);
    console.log("posición en la aldea:", JSON.stringify(pos2));

    await andarHacia(page, 79, 46, 30);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "3_junto_a_casa.png") });
    console.log("captura 3: junto a la puerta de la casa");

    await page.keyboard.press("f");
    await esperar(3500);

    // --- 3. Interior ---
    await esperar(2000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "4_interior.png") });
    console.log("captura 4: dentro del interior");

    await page.keyboard.press("f");
    await esperar(3500);

    // --- 4. Vuelta a la región, junto a la puerta de la casa ---
    await esperar(2000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "5_vuelta_a_la_aldea.png") });
    console.log("captura 5: de vuelta en la aldea, junto a la puerta");

    await browser.close();
    console.log(`\nCapturas en ${CARPETA_CAPTURAS}`);
  } finally {
    matarTodo();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
