"use strict";
// Verificación visual de tres arreglos pedidos por el usuario sobre las
// murallas de ciudades/:
//   1. Confinamiento: fuera del recinto amurallado ya no se puede caminar
//      (antes: el anillo "decorativo" entero era explorable). Se intenta
//      cruzar la puerta hacia fuera y se confirma que el jugador NO avanza.
//   2. Puerta de piedra = gatehouse (dos torreones flanqueando el hueco).
//   3. Puerta de empalizada = dos palos simples (sin sillería).
// NO es parte de la suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_render_murallas.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_murallas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indiceMadera = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "aldea_showcase", "indice.json"), "utf8"));
const indicePiedra = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "pueblo_showcase", "indice.json"), "utf8"));
const puertaMadera = indiceMadera.portales.find((p) => p.tipo === "exterior");
const puertaPiedra = indicePiedra.portales.find((p) => p.tipo === "exterior");

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
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    // --- 1. Puerta de empalizada (madera) desde dentro ---
    await page.goto(`http://localhost:5199/?sala=region&mapaId=aldea_showcase&entradaX=${puertaMadera.x}&entradaY=${puertaMadera.y - 4}&nombre=Explorador`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "1_puerta_empalizada.png") });
    console.log("captura 1: puerta de empalizada (dos palos)");

    // --- 2. Confinamiento: caminar hacia fuera desde justo dentro, comprobar que se detiene ---
    const antes = await page.evaluate(() => (window).__colonyDebug || null);
    await page.keyboard.down("s"); // hacia +Y, fuera de la muralla en esta orientación
    await esperar(2500);
    await page.keyboard.up("s");
    await esperar(300);
    const despues = await page.evaluate(() => (window).__colonyDebug || null);
    const avance = Math.hypot((despues?.x ?? 0) - (antes?.x ?? 0), (despues?.y ?? 0) - (antes?.y ?? 0));
    console.log(`  antes=${JSON.stringify(antes)} después=${JSON.stringify(despues)} avance=${avance.toFixed(2)}`);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "2_confinamiento_no_avanza.png") });

    // --- 3. Puerta de piedra (gatehouse) ---
    await page.goto(`http://localhost:5199/?sala=region&mapaId=pueblo_showcase&entradaX=${puertaPiedra.x}&entradaY=${puertaPiedra.y - 5}&nombre=Explorador`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "3_puerta_piedra_gatehouse.png") });
    console.log("captura 3: puerta de piedra (dos torreones)");

    // --- 4. Torre en un vértice de la muralla de piedra ---
    const torre = indicePiedra.muralla.modulos.find((m) => m.tipo === "torre");
    await page.goto(`http://localhost:5199/?sala=region&mapaId=pueblo_showcase&entradaX=${torre.x - 6}&entradaY=${torre.y}&nombre=Explorador`);
    await esperar(3000);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "4_torre_muralla.png") });
    console.log("captura 4: torre de la muralla");

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
