"use strict";

// E2E VISUAL de "Plantar <especie>" en el menú de clic sobre el suelo
// (auditoría de interacciones 2026-09-13, pedido streamer: "revisa si
// todas las funciones/interacciones están bien seteadas... revisa todo").
// Hallazgo real: `arbol:plantar` existía en el servidor (HubRoom.ts) desde
// el diseño original de bosques vivos — talar un árbol adulto suelta una
// `semilla_<especie>` la mitad de las veces — pero NINGÚN fichero de
// cliente lo mandaba nunca (confirmado por grep). La semilla se quedaba
// sin ningún uso posible: no encajaba en `cultivoCasilla:plantar` (eso es
// para semillas de CULTIVO en un bancal labrado, filtradas por
// `.cultivo`, un campo de catálogo DISTINTO de `.crecimientoArbol`) y no
// existía ninguna otra opción de menú que la usara.
//
// Verifica de punta a punta, con servidor+cliente reales: dar una semilla
// de roble real, clicar suelo ABIERTO (sin labrar) cerca del jugador debe
// ofrecer "Plantar Semilla de Roble (1)", clicarla manda arbol:plantar de
// verdad y el toast "Has plantado un roble." confirma que el servidor lo
// aceptó (no un error silencioso).
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/arbolPlantarClic.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_TESTFLAT = path.join(RAIZ, "assets", "mapas", "testflat");
const PUERTO_WS = 2645;
const PUERTO_WEB = 5245;
const NOMBRE_JARL = "PlantarTester";

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

async function main() {
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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_TESTFLAT, BD_RUTA: ":memory:", JARL_NOMBRES: NOMBRE_JARL,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
      VITE_RUTA_MAPA: "/assets/mapas/testflat",
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

    console.log("1) cargando cliente real (mapa testflat, jarl real)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    // Lejos de los 19 muebles de semillaTestZone.ts (todos al norte del
    // spawn, x:28-34 y:12-20) — terreno abierto real, sin labrar.
    const PUNTO_ABIERTO = { x: 50, y: 50 };
    console.log("2) dando una semilla_roble real y moviendo al jugador a terreno abierto...");
    await page.evaluate(() => window.__test.enviar("admin:debug:darItem", { itemId: "semilla_roble", cantidad: 1 }));
    await esperar(300);
    await page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), PUNTO_ABIERTO);
    await esperar(500);

    console.log("3) clicando el suelo abierto: debe ofrecer 'Plantar Semilla de Roble'...");
    const boxLienzo = await page.locator("canvas").first().boundingBox();
    const cx = boxLienzo.x + boxLienzo.width / 2;
    const cy = boxLienzo.y + boxLienzo.height / 2;
    const menuSel = '[data-testid="menu-interaccion"]';
    let opcionesMenu = "";
    let menuConPlantar = false;
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
        if (/Plantar.*[Rr]oble/.test(info)) { menuConPlantar = true; break; }
      }
      await page.mouse.click(10, 10);
      await esperar(150);
    }
    comprobar("el menú de suelo ofrece 'Plantar Semilla de Roble' con la semilla real en inventario", menuConPlantar, opcionesMenu.slice(0, 300));
    if (!menuConPlantar) throw new Error("no se pudo abrir el menú con la opción de plantar");

    console.log("4) clicando 'Plantar Semilla de Roble'...");
    const antesToast = await page.evaluate(() => document.body.innerText);
    const botonPlantar = page.locator(`${menuSel} >> text=/Plantar.*[Rr]oble/`).first();
    await botonPlantar.click();
    await page.waitForFunction((antes) => document.body.innerText !== antes && document.body.innerText.includes("Has plantado"), antesToast, { timeout: 5000 });
    const textoFinal = await page.evaluate(() => document.body.innerText);
    comprobar("arbol:plantar se acepta de verdad y muestra el toast 'Has plantado un roble.'", /Has plantado un roble/.test(textoFinal), textoFinal.split("\n").find((l) => l.includes("Has plantado")));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: plantar árbol por clic ya funciona de punta a punta ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ arbolPlantarClic.e2e: TODO OK" : `\n❌ arbolPlantarClic.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
