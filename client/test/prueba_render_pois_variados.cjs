"use strict";
// Renders de ejemplo de varios tipos de POI "edificio" (no aldea) recién
// horneados por baker/src/instanciasPOI.js — pedido del usuario tras ver
// la vinculación baker/<->ciudades/+interiores/: quiere ver cómo salen la
// torre de vigía, el campamento hostil y las ruinas. NO es parte de la
// suite automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_render_pois_variados.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_pois_variados");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "poi_test", "indice.json"), "utf8"));

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
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), { VITE_RUTA_MAPA: "/assets/mapas/poi_test" });
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => console.log("[error página]", String(err)));

    // Exterior del mapa (hub de prueba) cerca de cada POI, y su interior.
    for (const portal of indice.portales) {
      const nombre = portal.edificio.split(":").pop();
      console.log(`\n--- ${portal.tipoEdificioId} (${nombre}) ---`);

      // exterior: RegionRoom carga CUALQUIER mapa por mapaId (nested o no),
      // así que sirve para aparecer junto al POI sin andar todo el mapa
      // (384x384, demasiado lejos del spawn del hub para un paseo de prueba).
      await page.goto(`http://localhost:5199/?sala=region&mapaId=poi_test&entradaX=${portal.x}&entradaY=${portal.y + 6}&nombre=Explorador`);
      await esperar(3000);
      await page.screenshot({ path: path.join(CARPETA_CAPTURAS, `${portal.tipoEdificioId}_exterior.png`) });
      console.log(`  exterior -> ${portal.tipoEdificioId}_exterior.png`);

      // interior
      await page.goto(`http://localhost:5199/?sala=interior&mapaId=poi_test&edificio=${encodeURIComponent(portal.edificio)}&nivel=0&nombre=Explorador`);
      await esperar(2500);
      await page.screenshot({ path: path.join(CARPETA_CAPTURAS, `${portal.tipoEdificioId}_interior.png`) });
      console.log(`  interior -> ${portal.tipoEdificioId}_interior.png`);
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
