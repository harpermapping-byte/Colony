"use strict";
// Prueba visual manual (NO forma parte de la suite de tests): levanta
// servidor+cliente reales apuntando a la aldea de prueba bakeada en
// assets/mapas/aldea_test, conecta con Playwright, mueve al jugador y
// saca capturas. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_aldea.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_aldea");
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
    const rutaMapa = path.join(RAIZ, "assets", "mapas", "aldea_test");
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { RUTA_MAPA: rutaMapa });
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), { VITE_RUTA_MAPA: "/assets/mapas/aldea_test" });
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000); // margen tras "responde" para que Colyseus registre la room

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[consola]", msg.text());
    });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    await page.goto("http://localhost:5199/");
    await esperar(4000); // spawn + streaming del anillo inicial + props

    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_spawn_aldea.png") });
    console.log("captura 1: spawn en la aldea");

    // Mover al jugador manteniendo W (norte) + D (este) un rato, hacia la
    // plaza/edificios — WASD tal cual lee client/src/game.ts.
    await page.keyboard.down("w");
    await page.keyboard.down("d");
    await esperar(2500);
    await page.keyboard.up("w");
    await page.keyboard.up("d");
    await esperar(500);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_moviendose.png") });
    console.log("captura 2: tras moverse hacia la plaza");

    // Seguir hacia un edificio cercano (S+A un rato) para encuadrar una
    // fachada de cerca.
    await page.keyboard.down("s");
    await page.keyboard.down("a");
    await esperar(2000);
    await page.keyboard.up("s");
    await page.keyboard.up("a");
    await esperar(500);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "3_cerca_edificio.png") });
    console.log("captura 3: cerca de un edificio");

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
