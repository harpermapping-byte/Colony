"use strict";
// Prueba visual manual de la vinculación baker/ <-> ciudades/ + interiores/
// (POI "edificio"/"asentamiento" generados automáticamente al hornear el
// mapa exterior, baker/src/instanciasPOI.js — docs/GDD_Sistema_Puertas.md).
// El POI vive lejos del spawn del hub de prueba (mapa grande, 384x384) así
// que en vez de caminar todo el mapa se entra DIRECTO a las dos salas que
// generó el bake — mismo mecanismo (sala=interior / sala=region) que usa
// cualquier puerta real, solo sin el paseo previo. NO es parte de la suite
// automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_poi.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_poi");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "poi_test", "indice.json"), "utf8"));
const portalEdificio = indice.portales.find((p) => p.tipo === "interior");
const portalAsentamiento = indice.portales.find((p) => p.tipo === "exterior");

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

    // --- 1. Interior del POI "edificio" (una ruina, generada por el bake) ---
    console.log("portal edificio:", portalEdificio);
    const urlInterior = `http://localhost:5199/?sala=interior&mapaId=poi_test&edificio=${encodeURIComponent(portalEdificio.edificio)}&nivel=0&nombre=Explorador`;
    await page.goto(urlInterior);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_interior_edificio_poi.png") });
    const pos1 = await page.evaluate(() => (window).__colonyDebug || null);
    console.log("captura 1: interior del POI edificio, posición:", JSON.stringify(pos1));
    if (!pos1) throw new Error("No conectó a la sala interior del POI edificio");

    // --- 2. Región del POI "asentamiento" (nested, horneada por ciudades/) ---
    console.log("portal asentamiento:", portalAsentamiento);
    const urlRegion = `http://localhost:5199/?sala=region&mapaId=${encodeURIComponent(portalAsentamiento.destino.mapaId)}&nombre=Explorador`;
    await page.goto(urlRegion);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_region_asentamiento_poi.png") });
    const pos2 = await page.evaluate(() => (window).__colonyDebug || null);
    console.log("captura 2: región del POI asentamiento, posición:", JSON.stringify(pos2));
    if (!pos2) throw new Error("No conectó a la región del POI asentamiento");

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
