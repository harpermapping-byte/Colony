"use strict";

// E2E VISUAL de "Poner silla"/"Montar" por clic sobre la propia mascota
// (auditoría de interacciones 2026-09-13, pedido streamer: "revisa si
// todas las interacciones están bien seteadas... retira bindeos de teclas
// para que se hagan con click sobre el objeto como otros casos"). Hallazgo
// real: las teclas N (poner silla)/M (montar) ya auto-apuntaban a la
// mascota propia más cercana sin targeting — clicarla directamente solo
// ofrecía "Dar de comer"/"Inspeccionar", nunca estas dos.
//
// Siembra la BD directo con una mascota YA domesticada, "siguiendo" al
// jugador (mismo patrón que panelMascotasStats.e2e.cjs) — se posiciona
// junto al jugador en cuanto conecta y sigue de cerca, así que clicar cerca
// del centro de la pantalla (donde vive siempre el jugador local, cámara
// centrada) encuentra su rig real sin tener que calcular su posición exacta.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/mascotaMonturaClic.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const BD_RUTA = path.join(os.tmpdir(), "colony_mascota_montura_clic_e2e.sqlite");
const PUERTO_WS = 2657;
const PUERTO_WEB = 5257;
const NOMBRE = "MonturaClicTester";

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
  console.log("0) sembrando BD sqlite temporal (jugador + caballo domesticado, siguiendo, SIN silla todavía)...");
  fs.rmSync(BD_RUTA, { force: true });
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
        farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
      );
      CREATE TABLE IF NOT EXISTS mascotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, especie_id TEXT NOT NULL,
        ubicacion TEXT NOT NULL DEFAULT 'siguiendo', propiedad_id TEXT, creado_en TEXT NOT NULL,
        montura INTEGER NOT NULL DEFAULT 0, arnes INTEGER NOT NULL DEFAULT 0,
        arnes_peso_maximo REAL NOT NULL DEFAULT 0, montura_bonus_velocidad REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS inventarios (
        jugador_id INTEGER NOT NULL, contenedor_id TEXT NOT NULL, ancho INTEGER NOT NULL, alto INTEGER NOT NULL,
        siguiente_id INTEGER NOT NULL DEFAULT 1, items TEXT NOT NULL, PRIMARY KEY (jugador_id, contenedor_id)
      );
    `);
    const ahora = new Date().toISOString();
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
    bd.prepare(
      "INSERT INTO mascotas (id, jugador_id, especie_id, ubicacion, creado_en, montura) VALUES (1, 1, 'caballo', 'siguiendo', ?, 0)",
    ).run(ahora);
    // Una silla real en el cuerpo, para poder "Poner silla" de verdad por clic.
    const items = JSON.stringify([{ id: 1, itemId: "silla_montar", cantidad: 1, x: 0, y: 0, rot: 0 }]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 6, 4, 2, ?)").run(items);
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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_DEMO, BD_RUTA,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
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

    console.log("1) cargando cliente real (mismo nombre que el jugador sembrado, con su caballo real)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    // la mascota nace EXACTAMENTE en la posición del dueño (spawnearMascota,
    // RoomExteriorBase.ts) y solo luego se aleja a ~1.3 unidades — esperar a
    // que __mascotas() la reporte de verdad, en vez de un delay a ciegas.
    await page.waitForFunction(() => (window.__mascotas?.() ?? []).length > 0, null, { timeout: 10000 });

    console.log("2) clicando la posición real de la mascota (proyección mundo→pantalla, sin adivinar offsets): 'Poner silla'...");
    const menuSel = '[data-testid="menu-interaccion"]';
    // Mismo criterio que cazaClic.e2e.mjs: la altura del rig real (cuerpo de
    // caballo, no un punto fijo del suelo) no es un solo valor conocido de
    // antemano — probar varias alturas de proyección hasta que el rayo
    // atraviese de verdad la malla del animal.
    const ALTURAS_PROBAR = [0.3, 0.6, 0.9, 0.15, 1.1];
    async function clicarMascotaYLeerMenu() {
      let ultimaInfo = "";
      for (let intento = 0; intento < 20; intento++) {
        const m = await page.evaluate(() => window.__mascotas?.()?.[0] ?? null);
        if (!m) throw new Error("la mascota desapareció de room.state.mascotas");
        const altura = ALTURAS_PROBAR[intento % ALTURAS_PROBAR.length];
        const px = await page.evaluate(([x, y, h]) => window.__proyectarMundo(x, y, h), [m.x, m.y, altura]);
        await page.mouse.click(px.x, px.y);
        await esperar(200);
        const info = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el || getComputedStyle(el).display === "none") return null;
          return el.textContent || "";
        }, menuSel);
        if (info != null) return info;
        ultimaInfo = `(sin menú, mascota en ${m.x.toFixed(2)},${m.y.toFixed(2)} -> pantalla ${px.x.toFixed(0)},${px.y.toFixed(0)} altura=${altura})`;
        // Escape, NUNCA otro clic: un segundo clic en un punto sin nada
        // interactivo (p.ej. el suelo) ABRE su propio menú de suelo — y el
        // intento SIGUIENTE, con el menú ya abierto, solo lo CERRARÍA (el
        // fix "un clic con el menú abierto solo cierra, nunca reabre",
        // docs/GDD_UI_Paneles.md §2bis) sin llegar nunca a probar la
        // mascota. Encontrado depurando este mismo test.
        await page.keyboard.press("Escape");
        await esperar(200);
      }
      return ultimaInfo;
    }
    const opcionesMenu = await clicarMascotaYLeerMenu();
    const menuConSilla = /Poner silla/.test(opcionesMenu);
    comprobar("el menú al clicar la propia mascota ofrece 'Poner silla' (sin silla todavía)", menuConSilla, opcionesMenu.slice(0, 200));
    if (!menuConSilla) throw new Error("no se encontró el caballo clicando su posición real");

    console.log("3) clicando 'Poner silla' — debe consumir la silla real y marcar montura...");
    const antesToast = await page.evaluate(() => document.body.innerText);
    await page.locator(`${menuSel} >> text=Poner silla`).click();
    await page.waitForFunction((antes) => document.body.innerText !== antes, antesToast, { timeout: 5000 }).catch(() => {});
    await esperar(500);

    console.log("4) clicando de nuevo la mascota: ya con silla, debe ofrecer 'Montar' en vez de 'Poner silla'...");
    const opcionesMenu2 = await clicarMascotaYLeerMenu();
    const menuConMontar = /Montar/.test(opcionesMenu2);
    comprobar("tras ponerle silla, el menú ya no ofrece 'Poner silla' otra vez", !/Poner silla/.test(opcionesMenu2), opcionesMenu2.slice(0, 200));
    comprobar("tras ponerle silla, el menú ofrece 'Montar'", menuConMontar, opcionesMenu2.slice(0, 200));

    if (menuConMontar) {
      console.log("5) clicando 'Montar' — el jugador debe montar de verdad...");
      await page.locator(`${menuSel} >> text=Montar`).click();
      await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 5000 });
      // Montado, la mascota "individual" desaparece de room.state.mascotas
      // (docs/GDD_Monturas.md — se fusiona en el propio jugador) — esa
      // ausencia ES la prueba de que ya no se puede volver a ofrecer
      // "Montar" por clic (no hay nada clicable sobre lo que ofrecerlo).
      const desaparecioDelSchema = await page.waitForFunction(() => (window.__mascotas?.() ?? []).length === 0, null, { timeout: 5000 }).then(() => true).catch(() => false);
      comprobar("ya montado, la mascota sale de room.state.mascotas (evita doble-montar por clic)", desaparecioDelSchema);
    }

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: poner silla/montar por clic sobre la mascota ya funciona ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ mascotaMonturaClic.e2e: TODO OK" : `\n❌ mascotaMonturaClic.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
