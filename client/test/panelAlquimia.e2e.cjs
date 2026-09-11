"use strict";

// E2E del panel de alquimia/pociones (docs/GDD_Pociones.md, pedido streamer
// 2026-09-10: "el tema de la alquimia... necesitamos funcione también como
// el resto, marcaban que salía si metías X y tal") — MISMO patrón que
// client/test/panelCrafteo.e2e.cjs: BD sqlite sembrada directo (jugador
// curandero nivel 2, ingredientes reales + frasco de poción, un "caldero"
// ya colocado como construcción) + servidor+vite+Playwright reales. El
// panel se abre con la sonda SOLO-PARA-TESTS window.__alquimia (mismo
// criterio que window.__crafteo/__carpintero/__sastre/__ingeniero).
//
// Confirma de punta a punta: preview de color EN VIVO al marcar 3
// catalizadores (mezcla avanzada -> "Radiante"), preparar consume frasco +
// ingredientes de verdad, la sesión muestra la barra de temperatura real
// (mismo motor que forja), avivar hasta la ventana + esperar la duración
// mínima real + colar entrega el resultado con el color/efectos correctos,
// y sin frasco un segundo intento se rechaza mostrando el aviso real.
//
//   node client/test/panelAlquimia.e2e.cjs [dirCapturas]
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const { chromium } = require("playwright");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ, "assets", "mapas", "testflat");
const BD_RUTA = path.join(os.tmpdir(), "colony_panel_alquimia_e2e.sqlite");
const CARPETA_CAPTURAS = process.argv[2] || path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMBRE = "E2E-Curandero";
// "pt_<asentamiento>_..." — mismo atajo que costeConstruirMesaOficio.e2e.mjs
// y la versión corregida de server/test/alquimia.e2e.mjs: se carga en
// ctx.vivas sin depender de una parcela real de parcelas.json (el de
// "principal"/Vetrheim quedó vacío tras el rehorneo).
const PARCELA_ID = "pt_testflat_caldero_panel_e2e";
const CALDERO_XY = { x: 55, y: 55 }; // lejos de los 19 muebles de semillaTestZone.ts

console.log("1) sembrando BD sqlite temporal (curandero nivel 2, ingredientes + frasco, caldero colocado)...");
fs.rmSync(BD_RUTA, { force: true });
let idCaldero;
{
  const bd = new DatabaseSync(BD_RUTA);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS inventarios (
      jugador_id INTEGER NOT NULL, contenedor_id TEXT NOT NULL, ancho INTEGER NOT NULL, alto INTEGER NOT NULL,
      siguiente_id INTEGER NOT NULL DEFAULT 1, items TEXT NOT NULL, PRIMARY KEY (jugador_id, contenedor_id)
    );
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propiedad TEXT NOT NULL, objeto TEXT NOT NULL, categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL, rot INTEGER NOT NULL DEFAULT 0, variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT, creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jugador_oficios (
      jugador_id INTEGER NOT NULL, oficio TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jugador_id, oficio)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'curandero', 150)").run(); // nivel 2, caldero pide nivel 2

  const items = JSON.stringify([
    { id: 1, itemId: "hierba_venenosa", cantidad: 2, x: 0, y: 0, rot: 0 }, // corruptivo
    { id: 2, itemId: "hierba_curativa", cantidad: 2, x: 1, y: 0, rot: 0 }, // catalizador
    { id: 3, itemId: "flor_medicinal", cantidad: 2, x: 2, y: 0, rot: 0 }, // catalizador
    { id: 4, itemId: "hongo_medicinal", cantidad: 2, x: 3, y: 0, rot: 0 }, // catalizador
    { id: 5, itemId: "frasco_pocion", cantidad: 1, x: 4, y: 0, rot: 0 },
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 6, ?)").run(items);

  idCaldero = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "caldero", "mueble", CALDERO_XY.x, CALDERO_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  caldero id=${idCaldero}`);

const PUERTO_WS = 2652;
const PUERTO_WEB = 5200;
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

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

const panel = '[data-testid="panel-alquimia"]';

(async () => {
  let browser;
  try {
    console.log("2) arrancando servidor + vite...");
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), { PORT: String(PUERTO_WS), BD_RUTA, RUTA_MAPA });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/testflat",
    });
    for (const url of [`http://localhost:${PUERTO_WEB}/`, `http://localhost:${PUERTO_WS}/`]) {
      for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await esperar(500); } }
    }

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));

    console.log("3) cargando cliente y esperando la sonda __alquimia...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await page.waitForFunction(() => !!window.__alquimia, null, { timeout: 30000 });
    comprobar("cliente cargado con la sonda __alquimia disponible", true);

    console.log("4) abriendo el panel sobre el caldero...");
    await page.evaluate((id) => window.__alquimia.abrirPanel(id), idCaldero);
    await esperar(400);
    let texto = await page.locator(panel).innerText();
    comprobar("muestra el frasco disponible", texto.includes("Frasco de poción"), texto.slice(0, 200));
    comprobar("lista los 4 ingredientes reales del inventario", /Hierba Venenosa/.test(texto) && /Hierba Curativa/.test(texto) && /Flor Medicinal/.test(texto) && /Hongo Medicinal/.test(texto));

    console.log("5) marcando los 3 catalizadores (mezcla avanzada) — preview EN VIVO debe decir 'Radiante'...");
    for (const nombreIngrediente of ["Hierba Curativa", "Flor Medicinal", "Hongo Medicinal"]) {
      await page.locator(`${panel} label`, { hasText: nombreIngrediente }).locator("input[type=checkbox]").check();
    }
    await esperar(150);
    texto = await page.locator(panel).innerText();
    comprobar("preview en vivo dice 'Radiante' con 3 catalizadores marcados", /Radiante/.test(texto), texto.slice(0, 300));
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "alquimia1_preview_radiante.png") });

    console.log("6) preparando la poción...");
    const botonPreparar = page.locator(`${panel} button`, { hasText: "Preparar poción" });
    comprobar("botón 'Preparar poción' habilitado (frasco + 3 ingredientes)", await botonPreparar.isEnabled());
    await botonPreparar.click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.innerText.includes("Temperatura"), panel, { timeout: 6000 });
    texto = await page.locator(panel).innerText();
    comprobar("pasa a la sesión con la barra de temperatura real", /Temperatura/.test(texto));
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "alquimia2_sesion_temperatura.png") });

    console.log("7) avivando hasta la ventana óptima y esperando la duración mínima real...");
    for (let i = 0; i < 4; i++) {
      await page.locator(`${panel} button`, { hasText: "Avivar" }).click();
      await esperar(200);
    }
    await esperar(9000); // duracionMinimaSeg=8 real, sin acelerar nada — el servidor decide de verdad, "Colar" nunca se deshabilita en el cliente

    console.log("8) colando — debe entregar la poción Radiante con 4 efectos positivos...");
    await page.locator(`${panel} button`, { hasText: "Colar" }).click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.innerText.includes("preparada"), panel, { timeout: 6000 });
    texto = await page.locator(panel).innerText();
    comprobar("resultado muestra 'Poción Radiante preparada'", /Poción Radiante preparada/.test(texto), texto.slice(0, 200));
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "alquimia3_resultado.png") });

    console.log("9) sin frasco de poción (ya consumido), un segundo intento se rechaza...");
    await page.locator(`${panel} button`, { hasText: "Preparar otra" }).click();
    await esperar(300);
    texto = await page.locator(panel).innerText();
    comprobar("sin frasco, el aviso real aparece en la pantalla de selección", /Sin frasco de poción/.test(texto), texto.slice(0, 200));

    comprobar("sin errores de JS en la página", errores.length === 0, errores.join(" | "));

    console.log(fallos === 0 ? "\n✅ panelAlquimia.e2e: todo OK" : `\n❌ panelAlquimia.e2e: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } catch (err) {
    console.error("panelAlquimia.e2e reventó:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    matarTodo();
  }
})();
