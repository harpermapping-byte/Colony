"use strict";

// E2E VISUAL de "Subir a bordo"/"Bajar del barco" por clic sobre el propio
// barco (auditoría de interacciones 2026-09-13, continuación de la pieza de
// mascotaMonturaClic.e2e.cjs — mismo hallazgo, mismo patrón: J (colocar)/P
// (subir/bajar, docs/GDD_Barcos.md) siempre auto-apuntaban "el más cercano
// con hueco", sin targeting real — clicar el barco directamente no ofrecía
// ninguna acción de embarcar/desembarcar.
//
// Siembra la BD directo con un barco YA anclado (barco_1, 1 plaza) muy cerca
// del spawn, en un mapa 100% agua (test_mar_a, el mismo que ya usa
// server/test/barcos.e2e.mjs) — así el barco nunca se reancla lejos del
// spawn (HubRoom.onCreate solo reancla si la casilla sembrada NO es agua) y
// no hace falta calcular a mano una casilla de agua real del mapa demo.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/barcoClic.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAR_A = path.join(RAIZ, "assets", "mapas", "test_mar_a");
const BD_RUTA = path.join(os.tmpdir(), "colony_barco_clic_e2e.sqlite");
const PUERTO_WS = 2667;
const PUERTO_WEB = 5267;
const NOMBRE = "BarcoClicTester";

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
  console.log("0) sembrando BD sqlite temporal (jugador + barco_1 anclado muy cerca del spawn, en agua)...");
  fs.rmSync(BD_RUTA, { force: true });
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
        farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
      );
      CREATE TABLE IF NOT EXISTS barcos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, tipo_id TEXT NOT NULL,
        mapa_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, creado_en TEXT NOT NULL
      );
    `);
    const ahora = new Date().toISOString();
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
    // Spawn de test_mar_a: centro geométrico del mapa 16x16 -> ~(8.5,8.5)
    // (mapaColision.ts: sin `ciudad`/`spawn` en el índice, cae al centro).
    // El barco a (9,8), a menos de 1 casilla — dentro de RADIO_INTERACCION
    // (2.2) para el mensaje de embarcar y bien visible sin mover al jugador.
    bd.prepare("INSERT INTO barcos (jugador_id, tipo_id, mapa_id, x, y, creado_en) VALUES (1, 'barco_1', 'test_mar_a', 9, 8, ?)").run(ahora);
    bd.close();
  }

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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_MAR_A, BD_RUTA,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/test_mar_a",
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

    const menuSel = '[data-testid="menu-interaccion"]';
    // Alturas de proyección del casco (mismo criterio que cazaClic.e2e.mjs/
    // mascotaMonturaClic.e2e.cjs — un rig con volumen no tiene una única
    // altura de impacto correcta).
    const ALTURAS_PROBAR = [0.2, 0.4, 0.6, 0.1, 0.8];
    async function esperarMundoListo() {
      console.log("1) cargando cliente real (mismo nombre que el jugador sembrado, con su barco real anclado cerca)...");
      await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
      // El panel "Guía y novedades" (docs/GDD_UI_Paneles.md §14, 2026-09-13)
      // se auto-abre CENTRADO la primera vez que se entra al mundo en un
      // navegador sin preferencia guardada — tapa la zona donde se clica.
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="panel-tutorial"]');
        return !el || getComputedStyle(el).display === "none";
      }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => (window.__barcos?.() ?? []).length > 0, null, { timeout: 10000 });
      await esperar(300);
    }
    async function intentarClicarBarcoYLeerMenu() {
      let ultimaInfo = "";
      for (let intento = 0; intento < ALTURAS_PROBAR.length; intento++) {
        const b = await page.evaluate(() => window.__barcos?.()?.[0] ?? null);
        if (!b) throw new Error("el barco desapareció de room.state.barcos");
        const altura = ALTURAS_PROBAR[intento];
        const px = await page.evaluate(([x, y, h]) => window.__proyectarMundo(x, y, h), [b.x, b.y, altura]);
        await page.mouse.click(px.x, px.y);
        await esperar(200);
        const info = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el || getComputedStyle(el).display === "none") return null;
          return el.textContent || "";
        }, menuSel);
        if (info != null) return info;
        ultimaInfo = `(sin menú, barco en ${b.x.toFixed(2)},${b.y.toFixed(2)} -> pantalla ${px.x.toFixed(0)},${px.y.toFixed(0)} altura=${altura})`;
        // Escape, nunca otro clic — misma lección documentada en
        // mascotaMonturaClic.e2e.cjs (docs/GDD_UI_Paneles.md §2bis).
        await page.keyboard.press("Escape");
        await esperar(200);
      }
      return ultimaInfo;
    }

    console.log("1) cargando cliente real (mismo nombre que el jugador sembrado, con su barco real anclado cerca)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    await esperarMundoListo();

    console.log("2) clicando la posición real del barco (proyección mundo→pantalla): 'Subir a bordo'...");
    const opcionesMenu = await intentarClicarBarcoYLeerMenu();
    const menuConSubir = /Subir a bordo/.test(opcionesMenu);
    comprobar("el menú al clicar el barco (sin embarcar todavía) ofrece 'Subir a bordo'", menuConSubir, opcionesMenu.slice(0, 200));
    if (!menuConSubir) throw new Error("no se encontró el barco clicando su posición real");

    console.log("3) clicando 'Subir a bordo' — debe embarcar de verdad (Player.barcoId)...");
    await page.locator(`${menuSel} >> text=Subir a bordo`).click();
    const barcoIdEmbarcado = await page.waitForFunction(() => {
      const miId = window.__test?.sessionId?.();
      const yo = window.__jugadores?.()?.find((j) => j.id === miId);
      return yo?.barcoId > 0 ? yo.barcoId : null;
    }, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
    comprobar("tras 'Subir a bordo', Player.barcoId apunta al barco real", !!barcoIdEmbarcado, `barcoId=${barcoIdEmbarcado}`);

    console.log("4) clicando de nuevo el barco: ya embarcado, debe ofrecer 'Bajar del barco' en vez de 'Subir a bordo'...");
    const opcionesMenu2 = await intentarClicarBarcoYLeerMenu();
    const menuConBajar = /Bajar del barco/.test(opcionesMenu2);
    comprobar("ya embarcado, el menú ya no ofrece 'Subir a bordo' otra vez", !/Subir a bordo/.test(opcionesMenu2), opcionesMenu2.slice(0, 200));
    comprobar("ya embarcado, el menú ofrece 'Bajar del barco'", menuConBajar, opcionesMenu2.slice(0, 200));

    if (menuConBajar) {
      console.log("5) clicando 'Bajar del barco' — el jugador debe desembarcar de verdad...");
      await page.locator(`${menuSel} >> text=Bajar del barco`).click();
      const desembarcado = await page.waitForFunction(() => {
        const miId = window.__test?.sessionId?.();
        const yo = window.__jugadores?.()?.find((j) => j.id === miId);
        return yo && !yo.barcoId;
      }, null, { timeout: 5000 }).then(() => true).catch(() => false);
      comprobar("tras 'Bajar del barco', Player.barcoId vuelve a 0", desembarcado);
      // A diferencia de una mascota montada (desaparece del Schema), el
      // barco SIEMPRE sigue en state.barcos (varias plazas, docs/GDD_Barcos.md)
      // — confirma que desembarcar no lo borra por accidente.
      const sigueAnclado = await page.evaluate(() => (window.__barcos?.() ?? []).length === 1);
      comprobar("el barco sigue anclado en room.state.barcos tras desembarcar", sigueAnclado);
    }

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: subir a bordo/bajar del barco por clic ya funciona ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ barcoClic.e2e: TODO OK" : `\n❌ barcoClic.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
