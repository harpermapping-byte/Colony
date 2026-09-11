"use strict";

// E2E del panel de crafteo genérico en mesa de oficio (docs/GDD_Crafteo.md,
// pedido streamer 2026-09-10: "hay que hacer la UI de elegir receta") —
// MISMO patrón que client/test/carpinteroIngenieroLegendario.e2e.cjs: BD
// sqlite sembrada directo (jugador herrero, yunque_tocon ya colocado como
// construcción, lingote_hierro en el inventario) + servidor+vite+Playwright
// reales. El panel se abre con la sonda SOLO-PARA-TESTS window.__crafteo
// (mismo criterio que window.__carpintero/__sastre/__ingeniero) para no
// depender del raycast del clic 3D sobre la mesa exacta.
//
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/panelCrafteo.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ, "assets", "mapas", "testflat");
const BD_RUTA = path.join(os.tmpdir(), "colony_panel_crafteo_e2e.sqlite");
const CARPETA_CAPTURAS = path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMBRE = "E2E-Herrero";
// "pt_<asentamiento>_..." es el mismo prefijo que ya usan las plantillas del
// jarl (aserradero...) para cargarse en `ctx.vivas` SIN pertenecer a una
// parcela real (RoomExteriorBase.ts, `prefijoPlantilla`) — atajo de test
// limpio, sin depender de `parcelas.json` (el de "principal"/Vetrheim está
// vacío desde el rehorneo, y el resto de e2e que sembraban una parcela fija
// ahí quedaron rotos por eso, ver CLAUDE.md). `asentamiento` es el nombre de
// carpeta de RUTA_MAPA ("testflat"), no el id interno del bake.
const PARCELA_ID = "pt_testflat_yunquetest";
const YUNQUE_XY = { x: 34, y: 32 };

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {}
    await esperar(500);
  }
  throw new Error(`No responde ${url}`);
}

console.log("1) sembrando BD sqlite temporal (jugador herrero nivel 1, yunque_tocon colocado, lingote_hierro en inventario)...");
fs.rmSync(BD_RUTA, { force: true });
let idYunque;
{
  const bd = new DatabaseSync(BD_RUTA);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0,
      vida INTEGER NOT NULL DEFAULT 100,
      vida_max INTEGER NOT NULL DEFAULT 100,
      oficio_1 TEXT NOT NULL DEFAULT '',
      oficio_2 TEXT NOT NULL DEFAULT '',
      cambios_oficio INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS inventarios (
      jugador_id INTEGER NOT NULL,
      contenedor_id TEXT NOT NULL,
      ancho INTEGER NOT NULL,
      alto INTEGER NOT NULL,
      siguiente_id INTEGER NOT NULL DEFAULT 1,
      items TEXT NOT NULL,
      PRIMARY KEY (jugador_id, contenedor_id)
    );
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propiedad TEXT NOT NULL,
      objeto TEXT NOT NULL,
      categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL,
      rot INTEGER NOT NULL DEFAULT 0,
      variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT,
      creado_en TEXT NOT NULL
    );
  `);
  const ahora = new Date().toISOString();
  // Nivel 1 = sin XP (server/src/progresion/nivel.ts) — clavos_hierro exige
  // nivelMinimo:1, así que ni siquiera hace falta sembrar jugador_oficios.
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins, oficio_1, oficio_2) VALUES (1, ?, ?, 0, 'herrero', '')").run(NOMBRE, ahora);

  const items = JSON.stringify([{ id: 1, itemId: "lingote_hierro", cantidad: 3, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);

  idYunque = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
}
console.log(`  yunque_tocon id=${idYunque}`);

const procesos = [];
function lanzar(cmd, args, cwd, env = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  procesos.push(p);
  return p;
}
function matarTodo() { for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} try { p.kill("SIGKILL"); } catch {} } }
process.on("exit", matarTodo);

(async () => {
  let fallos = 0;
  const comprobar = (cond, msg) => { console.log(`${cond ? "ok" : "FALLO"} - ${msg}`); if (!cond) fallos++; };

  for (const puerto of [5199, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado — mátalo antes de correr el e2e`);
  }

  console.log("2) arrancando servidor + vite...");
  lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { BD_RUTA, RUTA_MAPA });
  lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), { VITE_RUTA_MAPA: "/assets/mapas/testflat" });
  await esperarPuerto("http://localhost:5199/");
  await esperarPuerto("http://localhost:2567/");

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => console.log("[pageerror]", err));

    console.log("3) cargando cliente y esperando sondas...");
    await page.goto(`http://localhost:5199/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await page.waitForFunction(() => !!window.__crafteo, null, { timeout: 30000 });
    comprobar(true, "cliente cargado con la sonda __crafteo disponible");

    console.log("4) abriendo el panel sobre el yunque de tocón...");
    await page.evaluate((id) => window.__crafteo.abrirPanel(id, "Yunque de Tocón"), idYunque);
    await esperar(500);
    let texto = await page.locator("body").innerText();
    comprobar(texto.includes("Yunque de Tocón"), "el panel muestra el nombre real de la mesa");
    comprobar(texto.includes("Cargando recetas") || texto.includes("Clavos"), "el panel arranca cargando o ya muestra la receta");

    await page.waitForFunction(() => document.body.innerText.includes("Clavos"), null, { timeout: 8000 });
    texto = await page.locator("body").innerText();
    comprobar(texto.includes("Nivel 1"), "agrupa la receta bajo 'Nivel 1'");
    comprobar(texto.includes("Lingote de Hierro") || texto.includes("lingote_hierro"), "muestra el insumo requerido (lingote de hierro)");
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "crafteo1_receta_listada.png") });

    console.log("5) crafteando la receta real...");
    const botonCraftear = page.locator("button:visible", { hasText: "Craftear" }).first();
    comprobar((await botonCraftear.count()) > 0, "el botón 'Craftear' está disponible (insumos y nivel cumplidos)");
    await botonCraftear.click();
    await page.waitForFunction(() => document.body.innerText.includes("Crafteando"), null, { timeout: 6000 });
    comprobar(true, "el panel pasa a mostrar el crafteo en curso tras pulsar Craftear");
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "crafteo2_en_curso.png") });

    console.log("6) esperando a que termine y recolectando...");
    await page.waitForFunction(() => document.body.innerText.includes("Recolectar"), null, { timeout: 15000 });
    await page.locator("button:visible", { hasText: "Recolectar" }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes("Crafteando"), null, { timeout: 6000 });
    comprobar(true, "tras recolectar, el panel vuelve al listado de recetas (ya no muestra 'Crafteando')");
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "crafteo3_recolectado.png") });

    console.log("7) verificando el inventario REAL (Schema replicado, no la foto de BD — la persistencia es perezosa)...");
    const items = await page.evaluate(() => window.__crafteo.inventario());
    const clavos = items.find((it) => it.itemId === "clavos");
    comprobar(!!clavos && clavos.cantidad === 10, `el inventario real tiene 10 clavos tras recolectar — encontrado: ${JSON.stringify(items)}`);
    const lingotesRestantes = items.find((it) => it.itemId === "lingote_hierro");
    comprobar(!lingotesRestantes || lingotesRestantes.cantidad === 2, `se descontó 1 lingote_hierro de verdad (3→2) — encontrado: ${JSON.stringify(lingotesRestantes)}`);

    console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    await browser.close();
    matarTodo();
  }
})().catch((err) => {
  console.error(err);
  matarTodo();
  process.exitCode = 1;
});
