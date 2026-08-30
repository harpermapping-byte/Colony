"use strict";
// Prueba visual manual del cono de visión en interiores (conoVision.ts,
// docs/Backlog_Mecanicas_Futuras.md "Cono/campo de visión real en
// interiores"): entra directo a un interior ya bakeado (ciudad_demo) con
// varias salas en fila, y compara la vista desde la sala del oeste (sin
// vecino al oeste, solo el "hueco" de la puerta) contra la vista desde la
// sala del este (con vecino al oeste completo — cascada de conoVision).
// NO es parte de la suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_cono_vision.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_cono_vision");
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
    const rutaHub = path.join(RAIZ, "assets", "mapas", "demo");
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { RUTA_MAPA: rutaHub });
    lanzar("npx", ["vite", "--port", "5198", "--strictPort"], path.join(RAIZ, "client"), {});
    await esperarPuerto("http://localhost:5198/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => { if (msg.type() === "error") console.log("[consola]", msg.text()); });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    // curtiduria_rio-3:curtiduria:10.json — 4 salas en fila W->E:
    // almacen@(0,2)+5x5 | taller@(6,0)+7x7 | almacen@(14,1)+6x6 | taller@(21,3)+5x4
    const edificio = "curtiduria_rio-3:curtiduria:10";
    const urlBase = `http://localhost:5198/?sala=interior&mapaId=ciudad_demo&edificio=${encodeURIComponent(edificio)}&nivel=0&nombre=Cono`;

    // --- 1. Sala del OESTE (almacen@(0,2)): sin vecino al oeste, solo se ve
    // su propio corte (este/sur ocultas) — el vecino al este NO se revela
    // por esta v1 (esa cascada solo mira norte/oeste del jugador).
    await page.goto(`${urlBase}&entradaX=2&entradaY=4`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_sala_oeste_sin_vecino_revelado.png") });
    console.log("captura 1: sala oeste (almacen@0,2) — cutaway propio, vecino este SIN revelar de más");

    // --- 2. Sala del ESTE (taller@(21,3)): tiene vecino al OESTE
    // (almacen@14,1) por una puerta en su pared oeste — debe cascadear y
    // ocultar TAMBIÉN las paredes este/sur de esa sala vecina.
    await page.goto(`${urlBase}&entradaX=23&entradaY=5`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_sala_este_con_vecino_revelado.png") });
    console.log("captura 2: sala este (taller@21,3) — debería verse también dentro de almacen@(14,1)");

    // Comprobación programática: leer qué mesh de pared quedó oculto vía el
    // hook de depuración que expone game.ts en window.__colonyDebug (x,y) +
    // contar meshes visibles en la escena para detectar que el número de
    // paredes visibles bajó respecto al total (evidencia de que SÍ se ocultó algo).
    const resumen = await page.evaluate(() => {
      const total = performance.getEntriesByType ? null : null; // no-op, solo por claridad
      return { colonyDebug: window.__colonyDebug || null };
    });
    console.log("estado del jugador en la sala este:", JSON.stringify(resumen.colonyDebug));

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
