"use strict";
// Simulación/paseo por una aldea pequeña amurallada de verdad (ciudades/,
// tier aldea_pequena) — pedido del usuario: "enséñame varias partes de una
// aldea pequeña amurallada con la deco y todo". En vez de andar por el
// laberinto de calles (poco fiable con dirección simple, se atasca), se
// aparece DIRECTO en cada punto de interés vía entradaX/Y — mismo mecanismo
// que usa cualquier puerta real, solo sin el paseo previo — y se saca una
// captura por sitio: fuera de la muralla, la puerta, el templo, la calle de
// casas, la zona verde/parque y la plaza central. NO es parte de la suite
// automática. Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_render_aldea_amurallada.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_aldea_amurallada");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", "aldea_showcase", "indice.json"), "utf8"));
const puertaMuralla = indice.portales.find((p) => p.tipo === "exterior");
const templo = indice.edificios.find((e) => e.tipo === "templo");
const casas = indice.edificios.filter((e) => e.tipo === "casa_humilde");
const parque = (indice.zonasVerdes || []).find((z) => z.tipo === "parque") || indice.zonasVerdes?.[0];

const PUNTOS = [
  { nombre: "1_fuera_muralla", x: puertaMuralla.x, y: puertaMuralla.y + 8, nota: "fuera de la muralla, viendo la puerta" },
  { nombre: "2_dentro_de_la_puerta", x: puertaMuralla.x, y: puertaMuralla.y - 3, nota: "justo dentro de la puerta" },
  { nombre: "3_plaza_centro", x: indice.ciudad.x, y: indice.ciudad.y, nota: "plaza / centro de la aldea" },
  { nombre: "4_templo", x: templo.cx, y: templo.cy + 7, nota: "junto al templo" },
  { nombre: "5_calle_de_casas", x: casas[0].cx, y: casas[0].cy + 6, nota: "calle junto a las casas" },
  ...(parque ? [{ nombre: "6_zona_verde", x: parque.x, y: parque.y, nota: "zona verde/parque con vegetación y mobiliario urbano" }] : []),
];

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

    for (const punto of PUNTOS) {
      await page.goto(
        `http://localhost:5199/?sala=region&mapaId=aldea_showcase&entradaX=${punto.x}&entradaY=${punto.y}&nombre=Explorador`,
      );
      await esperar(3000);
      await page.screenshot({ path: path.join(CARPETA_CAPTURAS, `${punto.nombre}.png`) });
      console.log(`captura: ${punto.nota} -> ${punto.nombre}.png`);
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
