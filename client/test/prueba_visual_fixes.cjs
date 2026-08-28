"use strict";
// Verificación visual de dos arreglos pedidos por el usuario tras revisar
// capturas anteriores:
//   1. Pasillitos entre puertas de conexión (interiorVisual.ts): antes se
//      veía un agujero sin suelo entre dos salas; ahora hay una casilla de
//      suelo real en cada puerta.
//   2. Caja 3D por PIEZA de un edificio en L/T/U (ciudades/src/index.js):
//      antes una sola caja del tamaño del cuerpo dejaba el ala fuera,
//      asomando tierra "solar_edificio" sucia; ahora una caja por pieza.
// NO es parte de la suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_fixes.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_fixes");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indicePoi = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "poi_test", "indice.json"), "utf8"));
const indiceAldea = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "aldea_footprint_test", "indice.json"), "utf8"));
const portalRuina = indicePoi.portales.find((p) => p.edificio.includes("granja_abandonada"));
const posada = indiceAldea.edificios.find((e) => e.piezas.length > 1);

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

    // --- 1. Interior de la ruina: pasillito entre las 2 salas ---
    const urlInterior = `http://localhost:5199/?sala=interior&mapaId=poi_test&edificio=${encodeURIComponent(portalRuina.edificio)}&nivel=0&nombre=Explorador`;
    await page.goto(urlInterior);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_pasillo_entre_salas.png") });
    console.log("captura 1: interior con pasillito entre salas");

    // --- 2. Región con la posada en L: caja cubre cuerpo + ala ---
    const urlRegion = `http://localhost:5199/?sala=region&mapaId=aldea_footprint_test&entradaX=${posada.puerta.x + 3}&entradaY=${posada.puerta.y - 3}&nombre=Explorador`;
    await page.goto(urlRegion);
    await esperar(3000);
    // cámara isométrica sigue al jugador — aparece ya cerca de la posada
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_posada_en_L.png") });
    console.log(`captura 2: posada en L (cx=${posada.cx}, cy=${posada.cy}, piezas=${posada.piezas.length})`);

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
