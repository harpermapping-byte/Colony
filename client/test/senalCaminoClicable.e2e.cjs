"use strict";

// E2E VISUAL de las señales de dirección en los caminos (docs/GDD_Sistema_
// Señales.md, pedido streamer 2026-09-13: "faltaría añadir nombres a las
// ciudades aldeas o POIS... para poner un sistema de SEÑALES en los caminos
// que te indiquen hacia donde va ese camino... dando click sobre el prop [...]
// te dice hacia que POI vas"). Verifica de punta a punta: (1) el asentamiento
// civil tiene un topónimo real del catálogo (nunca su id técnico), (2) el
// bake coloca al menos una señal real en el camino hacia él, (3) el cliente
// crea una etiqueta clicable oculta lejos y visible cerca de la señal, (4) un
// clic real sobre ella muestra el toast "El camino lleva hacia <Nombre>."
// (sin ningún mensaje al servidor — dato estático del propio bake).
//
// Mismo patrón EXACTO que puertaFisicaClicable.e2e.cjs (bake pequeño y real
// EN PROCESO, servidor+vite reales, Playwright real) — la única diferencia es
// la semilla: la del config base (`ejemplo-rapido.json`, "prueba-01") no
// coloca NINGÚN asentamiento civil con esta separación/tamaño de mapa (solo
// campamentos hostiles) — "prueba-13" sí, con una aldea nombrada ("Parderrubias")
// cuyo camino real hacia ella tiene tramo suficiente FUERA de su propia
// silueta (ver `radioSeguridadAsentamiento` en generar.js) para llevar una
// señal real y alcanzable a pie — confirmado con un barrido de 8 semillas
// candidatas antes de escribir este test (la mayoría de aldeas pequeñas en
// mapas de prueba minúsculos quedan demasiado cerca de la red para que su
// tramo "libre" supere el radio de seguridad de su propia muralla).
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/senalCaminoClicable.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const CARPETA_MAPA_TEST = path.join(RAIZ, "assets", "mapas", "_e2e_senal_camino");
const MAPA_ID_TEST = "_e2e_senal_camino";
const CARPETA_CAPTURAS = path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const PUERTO_WS = 2624;
const PUERTO_WEB = 5211;
const NOMBRE_JARL = "SenalTester";

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

/**
 * Bakea el mapa de prueba EN PROCESO (misma función que usa baker/src/index.js,
 * sin pasar por un subproceso) y devuelve la primera señal real que el
 * bakeador dejó lista para el cliente (`indice.senales`).
 */
async function bakearMapaDePruebaYEncontrarSenal() {
  fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  const { generarMapa } = require(path.join(RAIZ, "baker", "src", "generar.js"));
  const configBase = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "config", "ejemplo-rapido.json"), "utf8"));
  const config = { ...configBase, semilla: "prueba-13", carpetaSalida: CARPETA_MAPA_TEST };
  console.log("0) horneando mapa de prueba pequeño y real (config de ejemplo-rapido.json, semilla con asentamientos civiles reales)...");
  await generarMapa(config, { onProgreso: (m) => console.log("   [bake]", m) });
  const indice = JSON.parse(fs.readFileSync(path.join(CARPETA_MAPA_TEST, "indice.json"), "utf8"));
  const senales = indice.senales || [];
  if (!senales.length) {
    throw new Error(
      "el bake de prueba no colocó ninguna señal de dirección — con esta semilla debería (verificado antes de escribir este test); revisa baker/src/generar.js",
    );
  }
  console.log(`   ${senales.length} señal(es) encontradas, usando la primera: hacia "${senales[0].destino}" en (${senales[0].x},${senales[0].y})`);
  return senales[0];
}

async function main() {
  const senal = await bakearMapaDePruebaYEncontrarSenal();

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
      // ERR_CONNECTION_RESET/404: ruido benigno ya documentado de este
      // sandbox bajo carga (mismo criterio de exclusión que el resto de e2e
      // de esta sesión, p.ej. puertaFisicaClicable.e2e.cjs).
      if (process.env.DEBUG_E2E) console.log("[console]", msg.type(), t);
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real sobre el mapa de prueba recién horneado...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    const testid = "senal_0"; // primera señal de indice.senales, mismo orden que game.ts

    // La etiqueta CSS2D solo se ADJUNTA al DOM la primera vez que su
    // profundidad proyectada cae dentro del frustum de la cámara
    // (CSS2DRenderer.js::renderObject, `_vector.z >= -1 && _vector.z <= 1`)
    // — a diferencia de portales/señales muy cercanos al spawn (que ya caen
    // dentro del frustum inicial y por eso `waitForSelector` funciona
    // directo tras cargar), esta señal está lejos del spawn (~54 casillas)
    // y puede no estar en el frustum inicial: hay que acercarse ANTES de
    // esperar a que exista, igual que un jugador real tendría que hacerlo
    // para verla.
    console.log("2) teleport junto a la señal real -> la etiqueta debe existir y hacerse VISIBLE...");
    await page.evaluate(
      ({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }),
      { x: senal.x, y: senal.y },
    );
    await page.waitForSelector(`[data-testid="${testid}"]`, { state: "visible", timeout: 15000 }).catch(() => {});
    const visibleCerca = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta se hace VISIBLE junto a la señal real", visibleCerca);
    if (!visibleCerca) {
      const debugTestidsFinal = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")));
      console.log("[debug testids tras teleport a la señal]", JSON.stringify(debugTestidsFinal));
      console.log("[debug __colonyDebug]", JSON.stringify(await page.evaluate(() => window.__colonyDebug)));
      throw new Error("la etiqueta nunca se mostró — no se puede seguir con el clic");
    }

    const textoEtiqueta = await page.locator(`[data-testid="${testid}"]`).textContent();
    comprobar(
      `la etiqueta muestra "Hacia ${senal.destino}"`,
      textoEtiqueta === `Hacia ${senal.destino}`,
      `texto real="${textoEtiqueta}"`,
    );

    console.log("2b) alejarse -> la etiqueta debe OCULTARSE (sigue en el DOM, solo invisible)...");
    await page.evaluate(() => window.__test.enviar("admin:debug:teleport", { x: 5.5, y: 5.5 }));
    // waitForSelector(state:"hidden") reintenta de verdad hasta que la
    // etiqueta esté OCULTA (visibility Y display) — un `esperar(ms)` fijo
    // más una única comprobación puede caer justo entre dos ticks
    // independientes (el intervalo de 400ms que decide `visibility` y el
    // render por frame de CSS2DRenderer que decide `display` por frustum),
    // dando un falso "sigue visible" en un instante transitorio real tras
    // el salto de cámara del teleport.
    await page.waitForSelector(`[data-testid="${testid}"]`, { state: "hidden", timeout: 8000 }).catch(() => {});
    const visibleLejos = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta está OCULTA estando lejos de la señal", !visibleLejos);

    console.log("3) teleport de vuelta junto a la señal -> la etiqueta vuelve a hacerse VISIBLE...");
    await page.evaluate(
      ({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }),
      { x: senal.x, y: senal.y },
    );
    // waitForFunction con polling propio en vez de waitForSelector: en este
    // sandbox (sin GPU, `docs/GDD_Rendimiento.md` §7) un teleport de vuelta
    // desde muy lejos puede tardar más de lo esperado en que la posición
    // interpolada del jugador + el intervalo de 400ms + el render por
    // frame de CSS2DRenderer converjan los tres a la vez — reintenta de
    // verdad contra el DOM real (no un solo snapshot) con margen generoso.
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return !!el && el.style.visibility === "visible" && getComputedStyle(el).display !== "none";
      },
      testid,
      { timeout: 25000, polling: 300 },
    ).catch(() => {});
    const visibleDeVuelta = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta se hace VISIBLE de nuevo al volver", visibleDeVuelta);
    if (!visibleDeVuelta) {
      console.log("[debug __colonyDebug tras volver]", JSON.stringify(await page.evaluate(() => window.__colonyDebug)));
      const estilo = await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? { visibility: el.style.visibility, display: getComputedStyle(el).display } : null;
      }, testid);
      console.log("[debug estilo etiqueta tras volver]", JSON.stringify(estilo));
      throw new Error("la etiqueta no volvió a mostrarse — no se puede seguir con el clic");
    }

    const captura = path.join(CARPETA_CAPTURAS, "senal_camino_etiqueta_visible.png");
    await page.screenshot({ path: captura });
    console.log(`   captura (etiqueta visible junto a la señal): ${captura}`);

    console.log("4) clic REAL en pantalla sobre la etiqueta (page.mouse.click en coordenadas reales, NUNCA se invoca el handler a mano)...");
    const box = await page.locator(`[data-testid="${testid}"]`).boundingBox();
    comprobar("la etiqueta tiene una posición de pantalla real (boundingBox)", !!box, JSON.stringify(box));
    if (!box) throw new Error("sin boundingBox, no se puede hacer clic real");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    console.log("5) confirmando el toast local con el destino real (sin ningún mensaje al servidor: dato estático del bake)...");
    await esperar(400);
    const textoTrasClic = await page.evaluate(() => document.body.innerText);
    comprobar(
      `el toast "El camino lleva hacia ${senal.destino}." aparece en pantalla`,
      textoTrasClic.includes(`El camino lleva hacia ${senal.destino}.`),
      textoTrasClic.slice(0, 400).replace(/\n+/g, " | "),
    );

    console.log("6) alejarse de nuevo -> la etiqueta vuelve a OCULTARSE...");
    await page.evaluate(() => window.__test.enviar("admin:debug:teleport", { x: 5.5, y: 5.5 }));
    // Mismo criterio que el paso 2b: esperar de verdad a que se oculte
    // (reintentando) en vez de un `esperar(ms)` fijo + una única
    // comprobación, que puede caer en el instante transitorio real entre
    // el intervalo de 400ms (visibility) y el render por frame de
    // CSS2DRenderer (display por frustum) justo tras el salto de cámara.
    await page.waitForSelector(`[data-testid="${testid}"]`, { state: "hidden", timeout: 8000 }).catch(() => {});
    const visibleTrasAlejarse = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta vuelve a OCULTARSE al alejarse", !visibleTrasAlejarse);

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: señal de dirección clicable verificada de punta a punta (etiqueta oculta/visible por distancia, clic real, toast con destino real) — capturas en ${CARPETA_CAPTURAS} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ senalCaminoClicable.e2e: TODO OK" : `\n❌ senalCaminoClicable.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
