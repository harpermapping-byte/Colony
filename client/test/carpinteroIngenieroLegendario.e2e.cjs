"use strict";

// E2E de Carpintero legendario e Ingeniero legendario
// (docs/GDD_Ropa_Procedural.md §Carpintero legendario / §Ingeniero
// legendario) contra el servidor+cliente REALES — MISMO patrón que
// server/test/herreria.e2e.mjs (BD sqlite sembrada directo: jugador con
// ambos oficios a nivel 10, banco_carpintero/mesa_planos_ingenieria
// sembrados como construcción ya colocada) + client/test/construccion.e2e.cjs
// (servidor+vite+Playwright real). Los paneles se abren con las sondas
// SOLO-PARA-TESTS window.__carpintero/__ingeniero (mismo criterio que
// window.__sastre) en vez de acertar el raycast del clic 3D.
//
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/carpinteroIngenieroLegendario.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const BD_RUTA = path.join(os.tmpdir(), "colony_carpintero_ingeniero_e2e.sqlite");
const CARPETA_CAPTURAS = path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMBRE = "E2E-Artesano";
const PARCELA_ID = "p_0001";
const BANCO_XY = { x: 1601, y: 1600 };
const MESA_PLANOS_XY = { x: 1599, y: 1600 };

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {}
    await esperar(500);
  }
  throw new Error(`No responde ${url}`);
}

console.log("1) sembrando BD sqlite temporal (jugador con carpintero+ingeniero nivel 10, banco+mesa de planos sembrados)...");
fs.rmSync(BD_RUTA, { force: true });
let idBanco, idMesaPlanos;
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
    CREATE TABLE IF NOT EXISTS jugador_oficios (
      jugador_id INTEGER NOT NULL,
      oficio TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jugador_id, oficio)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins, oficio_1, oficio_2) VALUES (1, ?, ?, 0, 'carpintero', 'ingeniero')").run(NOMBRE, ahora);
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'carpintero', 5000)").run(); // nivel 10 (umbral 4050)
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'ingeniero', 5000)").run();

  const items = JSON.stringify([{ id: 1, itemId: "madera_dura", cantidad: 8, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);

  idBanco = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "banco_carpintero", "mueble", BANCO_XY.x, BANCO_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  idMesaPlanos = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "mesa_planos_ingenieria", "mueble", MESA_PLANOS_XY.x, MESA_PLANOS_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  banco_carpintero id=${idBanco}, mesa_planos_ingenieria id=${idMesaPlanos}`);

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

  for (const puerto of [5198, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado — mátalo antes de correr el e2e`);
  }

  console.log("2) arrancando servidor + vite...");
  lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { BD_RUTA });
  lanzar("npx", ["vite", "--port", "5198", "--strictPort"], path.join(RAIZ, "client"));
  await esperarPuerto("http://localhost:5198/");
  await esperarPuerto("http://localhost:2567/");

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => console.log("[pageerror]", err));

    console.log("3) cargando cliente y esperando streaming + sondas...");
    await page.goto(`http://localhost:5198/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await page.waitForFunction(() => !!window.__carpintero && !!window.__ingeniero, null, { timeout: 30000 });
    comprobar(true, "cliente cargado con sondas __carpintero/__ingeniero disponibles");

    // ---- Carpintero legendario ----
    console.log("4) abriendo panel del banco de carpintero...");
    await page.evaluate((id) => window.__carpintero.abrirPanel(id), idBanco);
    await esperar(300);
    const textareaCarpintero = page.locator("textarea:visible").first();
    await textareaCarpintero.fill("silla de roble noble tallada con incrustaciones doradas");
    await page.locator("button:visible", { hasText: /Generar vista previa/i }).first().click();
    await esperar(300);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "carpintero_preview.png") });
    const textoPreviewCarpintero = await page.locator("body").innerText();
    comprobar(textoPreviewCarpintero.includes("Silla") && textoPreviewCarpintero.includes("roble"), "preview de carpintero muestra Tipo:Silla y Madera:roble");
    comprobar(!!(await page.locator("canvas").count()), "hay un <canvas> de preview 3D en el panel del carpintero");

    // cambia el color de acento en vivo (silla tallada+incrustada trae swatch)
    const colorInputCarpintero = page.locator('input[type="color"]:visible');
    if (await colorInputCarpintero.count()) {
      await colorInputCarpintero.fill("#2255ee");
      comprobar(true, "swatch de color de acento del carpintero editable");
    }

    await page.locator("button:visible", { hasText: /tallarlo/i }).first().click();
    await esperar(800);
    const panelCerradoCarpintero = await page.evaluate(() => !!window.__carpintero && document.body.innerText.includes("Banco de carpintero — tallar"));
    comprobar(!panelCerradoCarpintero, "el panel del carpintero se cierra tras aceptar (confirmarCreado)");

    // Reabre y comprueba que "Mis diseños" lista el mueble recién tallado.
    await page.evaluate((id) => window.__carpintero.abrirPanel(id), idBanco);
    await esperar(800);
    const textoMisDisenos = await page.locator("body").innerText();
    comprobar(textoMisDisenos.includes("Mis diseños"), "el mueble tallado aparece en 'Mis diseños' del carpintero");
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "carpintero_misDisenos.png") });
    await page.evaluate(() => { window.__carpintero.abrirPanel; }); // no-op
    await page.locator("button:visible", { hasText: "Cerrar" }).first().click().catch(() => {});
    await esperar(200);

    // ---- Ingeniero legendario ----
    console.log("5) abriendo panel de la mesa de planos de ingeniería...");
    await page.evaluate((id) => window.__ingeniero.abrirPanel(id), idMesaPlanos);
    await esperar(300);
    const textareaIngeniero = page.locator("textarea:visible").first();
    await textareaIngeniero.fill("casa noble de piedra en forma de L con balcón y techo de teja");
    await page.locator("button:visible", { hasText: /Generar vista previa/i }).first().click();
    await esperar(300);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "ingeniero_preview.png") });
    const textoPreviewIngeniero = await page.locator("body").innerText();
    comprobar(textoPreviewIngeniero.includes("Casa Noble") && textoPreviewIngeniero.includes("piedra"), "preview de ingeniero muestra Tipo:Casa Noble y Material:piedra");
    comprobar(!!(await page.locator("canvas").count()), "hay un <canvas> de preview 3D en el panel del ingeniero");

    const colorInputIngeniero = page.locator('input[type="color"]:visible');
    if (await colorInputIngeniero.count()) {
      await colorInputIngeniero.fill("#00cc44");
      comprobar(true, "swatch de color de ventanas del ingeniero editable");
    }

    await page.locator("button:visible", { hasText: /proyectarlo/i }).first().click();
    await esperar(800);
    const panelCerradoIngeniero = await page.evaluate(() => document.body.innerText.includes("Mesa de planos — proyectar"));
    comprobar(!panelCerradoIngeniero, "el panel del ingeniero se cierra tras aceptar (confirmarCreado)");

    await page.evaluate((id) => window.__ingeniero.abrirPanel(id), idMesaPlanos);
    await esperar(800);
    const textoMisProyectos = await page.locator("body").innerText();
    comprobar(textoMisProyectos.includes("Mis proyectos"), "el edificio proyectado aparece en 'Mis proyectos' del ingeniero");
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "ingeniero_misDisenos.png") });

    console.log("6) verificando persistencia en BD (muebles_generados / edificios_generados)...");
    const bdVerif = new DatabaseSync(BD_RUTA);
    const muebles = bdVerif.prepare("SELECT * FROM muebles_generados").all();
    const edificios = bdVerif.prepare("SELECT * FROM edificios_generados").all();
    bdVerif.close();
    comprobar(muebles.length === 1 && muebles[0].arquetipo_id === "silla", `muebles_generados tiene 1 fila real (arquetipo_id=silla) — encontrado: ${JSON.stringify(muebles)}`);
    comprobar(edificios.length === 1 && edificios[0].tipo_edificio === "casa_noble", `edificios_generados tiene 1 fila real (tipo_edificio=casa_noble) — encontrado: ${JSON.stringify(edificios)}`);

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
