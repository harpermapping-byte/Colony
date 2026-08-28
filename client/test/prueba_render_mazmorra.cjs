"use strict";
// Verificación visual del bakeador de mazmorras (docs/GDD_Bakeador_Dungeons.md):
// entra a una mazmorra tipo cueva (formaSala orgánica) y a una tipo edificio
// (formaSala rectangular), comprueba que hay enemigos activos (sonda
// __enemigos) y saca capturas. NO es parte de la suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_render_mazmorra.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_mazmorra");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "dungeon_test", "indice.json"), "utf8"));
const portalCueva = indice.portales.find((p) => p.esMazmorra && p.tipoEdificioId === "cueva_aranas");
const portalEdificio = indice.portales.find((p) => p.esMazmorra && p.tipoEdificioId === "torre_nigromante");

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

    for (const [nombre, portal] of [["cueva", portalCueva], ["torre_nigromante", portalEdificio]]) {
      const url = `http://localhost:5199/?sala=mazmorra&mapaId=dungeon_test&edificio=${encodeURIComponent(portal.edificio)}&nivel=0&nombre=Explorador`;
      await page.goto(url);
      await esperar(3500);
      const enemigos = await page.evaluate(() => (window).__enemigos ? (window).__enemigos() : null);
      console.log(`${nombre}: enemigos=`, JSON.stringify(enemigos));
      await page.screenshot({ path: path.join(CARPETA_CAPTURAS, `${nombre}.png`) });
      if (!enemigos || enemigos.total === 0) throw new Error(`${nombre}: sin enemigos activos`);
    }

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
