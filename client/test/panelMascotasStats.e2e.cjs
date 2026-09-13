"use strict";

// E2E VISUAL de los bonos reales de silla/arnés en el panel de mascotas
// (auditoría de interacciones 2026-09-13, hallazgo real: `monturaBonusVelocidad`/
// `arnes`/`arnesPesoMaximo` ya vivían en la fila de BD de cada mascota desde
// el diseño original de monturas/carros, pero "mascota:lista" nunca los
// mandaba — dos monturas con silla básica vs. de tier alto se veían
// exactamente igual en el panel, sin ninguna forma de saber cuál convenía
// montar o cuánto podía tirar un arnés puesto).
//
// Siembra la BD directo con una mascota YA con silla/arnés puestos (mismo
// patrón que panelAlquimia.e2e.cjs/mueblesCarpintero.e2e.mjs) — no hace
// falta domesticar/equipar de verdad, esto prueba solo la LECTURA del panel.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/panelMascotasStats.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const BD_RUTA = path.join(os.tmpdir(), "colony_panel_mascotas_stats_e2e.sqlite");
const PUERTO_WS = 2655;
const PUERTO_WEB = 5255;
const NOMBRE = "MascotaStatsTester";

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
  console.log("0) sembrando BD sqlite temporal (jugador + mascota con silla tier alto + arnés)...");
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
    `);
    const ahora = new Date().toISOString();
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
    bd.prepare(
      "INSERT INTO mascotas (id, jugador_id, especie_id, ubicacion, creado_en, montura, arnes, arnes_peso_maximo, montura_bonus_velocidad) VALUES (1, 1, 'caballo', 'siguiendo', ?, 1, 1, 250, 15)",
    ).run(ahora);
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

    console.log("1) cargando cliente real (mismo nombre que el jugador sembrado)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });

    console.log("2) abriendo el panel de mascotas (icono del dock)...");
    await page.locator('.dock-hud-icono[title="Mascotas (G)"]').click();
    // OJO: "caballo" también sale en la etiqueta flotante 3D sobre la
    // mascota en el mundo ("🐾 caballo de X", game.ts) — hay que acotar la
    // búsqueda al CUERPO del panel de Mascotas en concreto, no a toda la
    // página, o el test puede leer esa etiqueta por error en vez de la fila
    // real del panel (encontrado escribiendo este mismo test).
    function textoCuerpoPanelMascotas() {
      const panel = [...document.querySelectorAll(".panel-colony")].find((p) => p.querySelector(".panel-colony-cabecera")?.textContent?.includes("Mascotas"));
      return panel?.querySelector(".panel-colony-cuerpo")?.textContent ?? null;
    }
    await page.waitForFunction(`(${textoCuerpoPanelMascotas.toString()})()?.includes("caballo")`, null, { timeout: 10000 });
    const textoCuerpo = await page.evaluate(textoCuerpoPanelMascotas);
    const lineaCaballo = textoCuerpo?.split("\n").find((l) => l.includes("caballo")) ?? null;

    comprobar("el panel muestra el bono real de la silla (+15 vel.), no solo que tiene silla", /\+15 vel\./.test(lineaCaballo || ""), lineaCaballo);
    comprobar("el panel muestra el peso máximo real del arnés (250kg), no solo que tiene arnés", /250\s*kg/.test(lineaCaballo || ""), lineaCaballo);

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: bonos reales de silla/arnés ya son visibles en el panel de mascotas ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ panelMascotasStats.e2e: TODO OK" : `\n❌ panelMascotasStats.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
