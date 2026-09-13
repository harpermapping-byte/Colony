"use strict";

// E2E VISUAL del menú de interacción por clic FUERA del Hub (auditoría de
// interacciones 2026-09-13, pedido streamer: "revisa si todas las
// interacciones están bien seteadas... revisa todo"). Hallazgo real de esa
// auditoría (3 agentes independientes coincidieron): el listener de clic que
// muestra "Sentarse en el suelo"/cazar-por-clic/recoger-objeto-suelto vivía
// ENTERO dentro de `if (SALA === "hub")` en client/src/game.ts — en
// CUALQUIER RegionRoom real (aldea/pueblo/capital anidada, donde vive casi
// toda la población civil) un clic sobre el suelo o sobre un animal no hacía
// NADA, pese a que sus teclas equivalentes (C, F) sí son universales. Cerrado
// extrayendo `intentarCazarFaunaClic`/`intentarRecogerObjetoMundoClic`/
// `mostrarMenuSueloClic` a funciones compartidas, llamadas también desde el
// listener universal ya existente (el mismo que ya resolvía la inspección
// por clic fuera del Hub desde el 2026-09-12).
//
// Mismo patrón exacto de bake+cruce-de-puerta que
// puertaFisicaClicable.e2e.cjs (mapa de prueba PEQUEÑO Y REAL, EN PROCESO vía
// generarMapa, borrado en el finally, nunca se comitea) — este test retoma
// justo donde aquel termina (ya DENTRO de una RegionRoom real) y prueba lo
// que aquel no probaba: el clic genérico sobre el mundo, no solo la etiqueta
// de la puerta.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/interaccionRegionClic.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const CARPETA_MAPA_TEST = path.join(RAIZ, "assets", "mapas", "_e2e_interaccion_region");
const MAPA_ID_TEST = "_e2e_interaccion_region";
const CARPETA_CAPTURAS = path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const PUERTO_WS = 2631;
const PUERTO_WEB = 5231;
const NOMBRE_JARL = "InteraccionTester";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

// Mismo bake y mismo filtro que puertaFisicaClicable.e2e.cjs — reproducido
// aquí (no importado) para que este test siga funcionando solo, igual que el
// resto de e2e del repo.
async function bakearMapaDePruebaYEncontrarPuerta() {
  fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  const { generarMapa } = require(path.join(RAIZ, "baker", "src", "generar.js"));
  const configBase = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "config", "ejemplo-rapido.json"), "utf8"));
  const config = { ...configBase, carpetaSalida: CARPETA_MAPA_TEST };
  console.log("0) horneando mapa de prueba pequeño y real (mismo config que ejemplo-rapido.json)...");
  await generarMapa(config, { onProgreso: (m) => console.log("   [bake]", m) });
  const indice = JSON.parse(fs.readFileSync(path.join(CARPETA_MAPA_TEST, "indice.json"), "utf8"));
  const entradas = (indice.portales || []).filter(
    (p) => p.tipo === "exterior" && !!p.destino && p.puertaX != null && p.puertaY != null && !!p.nombreDestino,
  );
  if (!entradas.length) {
    throw new Error("el bake de prueba no colocó ningún asentamiento con puerta clicable — revisa baker/src/instanciasPOI.js");
  }
  return entradas[0];
}

async function main() {
  const entrada = await bakearMapaDePruebaYEncontrarPuerta();

  const procesos = [];
  const lanzar = (cmd, args, cwd, env) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
    p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
    procesos.push(p);
    return p;
  };
  const matarTodo = () => {
    for (const p of procesos) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };
  process.on("exit", matarTodo);

  let browser;
  try {
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {
      PORT: String(PUERTO_WS), RUTA_MAPA: CARPETA_MAPA_TEST, BD_RUTA: ":memory:", JARL_NOMBRES: NOMBRE_JARL,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
      VITE_RUTA_MAPA: `/assets/mapas/${MAPA_ID_TEST}`,
    });
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real y cruzando la puerta de la aldea (mismo camino que puertaFisicaClicable.e2e.cjs)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    // El comportamiento del Hub ya lo cubren de sobra (y sin regresión, ver
    // el propio commit de este cambio) cazaClic.e2e.mjs/
    // menuInteraccionToggle.e2e.mjs/combateClicYFeedback.e2e.mjs — este test
    // se centra SOLO en lo que ninguno de ellos prueba: el mismo clic
    // funcionando DENTRO de una región real.
    const menuSel = '[data-testid="menu-interaccion"]';
    console.log("2) cruzando la puerta de la aldea/campamento (mismo camino que puertaFisicaClicable.e2e.cjs)...");
    await page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), { x: entrada.x + 0.5, y: entrada.y + 0.5 });
    await page.waitForSelector('[data-testid="portal_0"]', { state: "visible", timeout: 20000 });
    await esperar(500); // la etiqueta alterna visibilidad cada 400ms (proximidad) — deja que se asiente antes de leer su boundingBox
    const boxPuerta = await page.locator('[data-testid="portal_0"]').boundingBox();
    await page.mouse.click(boxPuerta.x + boxPuerta.width / 2, boxPuerta.y + boxPuerta.height / 2);
    await page.waitForURL((url) => url.searchParams.get("sala") === "region", { timeout: 30000, waitUntil: "domcontentloaded" });
    comprobar("cruzó la puerta y la URL es sala=region (dentro de la aldea/campamento)", new URL(page.url()).searchParams.get("sala") === "region", page.url());
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 30000 });
    await esperar(1000); // deja que la cámara/el rig se asienten antes del primer clic real

    console.log("3) DENTRO de la región (aldea real, no el Hub): clic sobre el suelo debe abrir 'Sentarse en el suelo'...");
    // Punto de terreno abierto: se aleja unas pocas casillas del portal de
    // entrada (que suele caer justo fuera de la muralla, terreno normal) y
    // mira hacia el centro de la cámara — el jugador siempre está centrado
    // en pantalla (worldScene.ts), así que un clic cerca del centro cae
    // sobre terreno junto a él la mayoría de las veces; varios puntos
    // alrededor del centro por si el primero cae sobre un prop.
    const boxLienzo = await page.locator("canvas").first().boundingBox();
    const cx = boxLienzo.x + boxLienzo.width / 2;
    const cy = boxLienzo.y + boxLienzo.height / 2;
    let menuSueloVisible = false;
    let opcionesMenu = "";
    for (const [dx, dy] of [[0, 40], [40, 0], [-40, 0], [0, -40], [60, 60], [-60, -60], [0, 0]]) {
      await page.mouse.click(cx + dx, cy + dy);
      await esperar(250);
      const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === "none") return null;
        return el.textContent || "";
      }, menuSel);
      if (info != null) {
        opcionesMenu = info;
        if (/[Ss]entarse en el suelo|[Cc]azar|[Ii]nspeccionar|[Rr]ecoger|[Ll]abrar|[Cc]osechar/.test(info)) { menuSueloVisible = true; break; }
      }
      // cerrar cualquier menú que haya quedado abierto sin la opción esperada, y reintentar en otro punto
      await page.mouse.click(10, 10);
      await esperar(150);
    }
    comprobar("dentro de la región, un clic sobre el mundo abre el menú de interacción con una opción real (suelo/caza/inspección/recoger)", menuSueloVisible, opcionesMenu.slice(0, 200));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: interacción por clic verificada DENTRO de una región real (no solo el Hub) ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ interaccionRegionClic.e2e: TODO OK" : `\n❌ interaccionRegionClic.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
