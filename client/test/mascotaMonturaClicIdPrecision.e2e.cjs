"use strict";

// E2E de PRECISIÓN de id: "Montar" por clic debe montar la mascota
// REALMENTE clicada — nunca "la más cercana" (el criterio de la tecla M,
// `mascotaPropiaCercana` sin id explícito), aunque haya OTRA mascota propia
// igual de cerca que también pueda montarse.
//
// Bug real encontrado y cerrado ANTES de este test (auditoría de
// interacciones 2026-09-13, parte 6): `ud.mascotaId` es la clave STRING del
// Map de Colyseus, pero el servidor solo respeta un id explícito cuando
// `typeof mascotaId === "number"` (`mascotaPropiaCercana`) — mandar la
// clave sin convertir caía en silencio al "la más cercana" de siempre,
// dejando el clic tan impreciso como la tecla pese a mandar un id "real".
// El e2e original (mascotaMonturaClic.e2e.cjs) tenía UNA sola mascota, así
// que nunca podía detectar esto — este test siembra DOS, ambas montables ya
// con silla, y comprueba `Player.monturaMascotaId` (replicado) tras montar:
// si el servidor hubiera caído al fallback de "la más cercana", el
// resultado dependería del azar del ángulo de seguimiento de cada una, NO
// del id que se clicó — la aserción exige que sea EXACTAMENTE el id 2,
// nunca "cualquiera de las dos".
//
// OJO con el nombre de jugador elegido: `player.name`/las 4 rooms lo
// truncan a `.slice(0, 20)` al entrar — un nombre sembrado en BD más largo
// que eso nunca hace match contra el jugador real que se une (crea uno
// NUEVO sin mascotas, dejando el test colgado sin ningún error visible).
// Encontrado escribiendo este mismo test con un nombre de 22 caracteres.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/mascotaMonturaClicIdPrecision.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const BD_RUTA = path.join(os.tmpdir(), "colony_mascota_montura_precision_e2e.sqlite");
const PUERTO_WS = 2662;
const PUERTO_WEB = 5262;
const NOMBRE = "MonturaDosCaballos"; // <= 20 chars, ver comentario de arriba

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
  console.log("0) sembrando BD sqlite temporal (jugador + 2 caballos, AMBOS ya con silla puesta)...");
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
    // Mismo dueño, misma especie, AMBAS con silla — indistinguibles salvo por
    // el id: la única forma de comprobar que se monta la clicada y no "la
    // más cercana" es exigir el id EXACTO tras montar.
    bd.prepare(
      "INSERT INTO mascotas (id, jugador_id, especie_id, ubicacion, creado_en, montura) VALUES (1, 1, 'caballo', 'siguiendo', ?, 1)",
    ).run(ahora);
    bd.prepare(
      "INSERT INTO mascotas (id, jugador_id, especie_id, ubicacion, creado_en, montura) VALUES (2, 1, 'caballo', 'siguiendo', ?, 1)",
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

    const menuSel = '[data-testid="menu-interaccion"]';
    // Altura + jitter en (x,y) del mundo, mismo criterio (y misma causa
    // real) que mascotaMonturaClic.e2e.cjs: el NPC fijo del mapa demo
    // (`maestro_oficios_demo`, a 1 casilla del spawn) puede ocluir la
    // mascota en TODAS las alturas de un punto único si el ángulo aleatorio
    // de seguimiento la deja justo detrás desde la cámara isométrica.
    const ALTURAS_PROBAR = [0.3, 0.6, 0.9, 0.15, 1.1];
    const JITTER_XY = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
    async function esperarMundoListo() {
      console.log("1) cargando cliente real (mismo nombre que el jugador sembrado, con sus 2 caballos reales)...");
      await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
      // El panel "Guía y novedades" (docs/GDD_UI_Paneles.md §14, 2026-09-13)
      // se auto-abre CENTRADO la primera vez que se entra al mundo en un
      // navegador sin preferencia guardada — tapa la zona donde se clica.
      // Escape lo cierra (crearMarcoPanel, cierraConEscape por defecto); se
      // espera el CIERRE REAL (no un delay a ciegas), mismo criterio que
      // mascotaMonturaClic.e2e.cjs tras encontrar ahí una intermitencia real.
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="panel-tutorial"]');
        return !el || getComputedStyle(el).display === "none";
      }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => (window.__mascotas?.() ?? []).length === 2, null, { timeout: 20000 });
      await esperar(300);
    }
    async function clicarMascotaPorIdYLeerMenu(mascotaId) {
      let ultimaInfo = "";
      for (let intento = 0; intento < 25; intento++) {
        const m = await page.evaluate((id) => window.__mascotas?.()?.find((x) => x.id === id) ?? null, mascotaId);
        if (!m) throw new Error(`la mascota ${mascotaId} desapareció de room.state.mascotas`);
        const altura = ALTURAS_PROBAR[intento % ALTURAS_PROBAR.length];
        const [jx, jy] = JITTER_XY[Math.floor(intento / ALTURAS_PROBAR.length) % JITTER_XY.length];
        const px = await page.evaluate(([x, y, h]) => window.__proyectarMundo(x, y, h), [m.x + jx, m.y + jy, altura]);
        await page.mouse.click(px.x, px.y);
        await esperar(200);
        const info = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el || getComputedStyle(el).display === "none") return null;
          return el.textContent || "";
        }, menuSel);
        if (info != null) return info;
        ultimaInfo = `(sin menú, mascota ${mascotaId} en ${m.x.toFixed(2)},${m.y.toFixed(2)} -> pantalla ${px.x.toFixed(0)},${px.y.toFixed(0)} altura=${altura} jitter=${jx},${jy})`;
        // Escape, nunca otro clic (docs/GDD_UI_Paneles.md §2bis) — ver la
        // misma lección documentada en mascotaMonturaClic.e2e.cjs.
        await page.keyboard.press("Escape");
        await esperar(200);
      }
      return ultimaInfo;
    }

    // Reintento a nivel de CONEXIÓN, no de píxel — mismo criterio que
    // mascotaMonturaClic.e2e.cjs: el ángulo de seguimiento de CADA mascota
    // se re-sortea en cada join, así que recargar da una disposición nueva
    // en vez de perseguir el píxel exacto de una mala combinación fija.
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}`);
    let menu = "";
    let encontrada = false;
    for (let vuelta = 0; vuelta < 6 && !encontrada; vuelta++) {
      if (vuelta > 0) {
        console.log(`   (reintento ${vuelta}: reconectando para ángulos de seguimiento nuevos)`);
        await page.reload();
      }
      await esperarMundoListo();
      console.log("2) clicando específicamente la mascota id=2 y pulsando 'Montar'...");
      menu = await clicarMascotaPorIdYLeerMenu("2");
      encontrada = /Montar/.test(menu);
    }
    comprobar("la mascota id=2 (con silla) ofrece 'Montar' por clic", encontrada, menu.slice(0, 200));
    if (!encontrada) throw new Error("no se pudo llegar a la opción 'Montar' de la mascota 2, ni siquiera reconectando varias veces");
    await page.locator(`${menuSel} >> text=Montar`).click();
    await page.waitForFunction(() => (window.__mascotas?.() ?? []).length === 1, null, { timeout: 5000 });

    console.log("3) comprobando CUÁL de las dos se montó de verdad (Player.monturaMascotaId, replicado)...");
    const montadoId = await page.evaluate(() => {
      const miId = window.__test?.sessionId?.();
      return window.__jugadores?.()?.find((j) => j.id === miId)?.monturaMascotaId ?? null;
    });
    comprobar("se montó EXACTAMENTE la mascota clicada (id=2), no 'la más cercana'", montadoId === 2, `monturaMascotaId=${montadoId}`);

    const restante = await page.evaluate(() => window.__mascotas?.() ?? []);
    comprobar("la mascota id=1 (la que NO se clicó) sigue intacta en room.state.mascotas", restante.length === 1 && restante[0].id === "1", JSON.stringify(restante));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: el clic monta la mascota EXACTA clicada, no "la más cercana" ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ mascotaMonturaClicIdPrecision.e2e: TODO OK" : `\n❌ mascotaMonturaClicIdPrecision.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
