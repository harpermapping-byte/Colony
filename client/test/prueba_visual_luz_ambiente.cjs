"use strict";
// Prueba visual manual de la luz ambiente por hora del día en interiores
// (luzInteriores.ts, docs/Backlog_Mecanicas_Futuras.md "Luz ambiente por
// hora del día en interiores"): mismo interior generado a propósito con
// ventanas reales (assets/mapas/demo/interiores/prueba_luz_ambiente.json,
// casa_humilde/modesta, dormitorio_individual con sumaAporteLuz≈1.5),
// comparado de noche (?hora=2) contra mediodía (?hora=12) — la sala
// debería verse claramente más iluminada a mediodía. NO es parte de la
// suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_visual_luz_ambiente.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_luz_interiores");
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
    lanzar("npx", ["vite", "--port", "5197", "--strictPort"], path.join(RAIZ, "client"), {});
    await esperarPuerto("http://localhost:5197/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => { if (msg.type() === "error") console.log("[consola]", msg.text()); });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    const urlBase = "http://localhost:5197/?sala=interior&mapaId=demo&edificio=prueba_luz_ambiente&nivel=0&nombre=Luz&entradaX=2&entradaY=8";

    await page.goto(`${urlBase}&hora=2`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_de_noche.png") });
    console.log("captura 1: de noche (hora=2) — solo luz de luna filtrada por la ventana + antorchas si hay");

    await page.goto(`${urlBase}&hora=12`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_mediodia.png") });
    console.log("captura 2: mediodía (hora=12) — la sala con ventana debería verse claramente más clara");

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
