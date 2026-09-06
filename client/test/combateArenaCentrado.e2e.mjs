// E2E VISUAL del centrado de unidades en la rejilla táctica + resaltado de
// casilla ocupada (pedido streamer 2026-09-06: "el player o los npc o los
// jugadores deben estar en el centro de la casilla, y la casilla debe tener
// un colorcito o un tono diferente para que se sepa en qué casilla está,
// ahora está junto en el eje"). Mismo montaje EXACTO que
// combateArenaTierra.e2e.mjs (avispa_comun sembrada junto al spawn del mapa
// demo, mismo atajo ya validado) — este e2e es específico del bug de
// centrado + el nuevo resaltadoCombate.ts, no repite las comprobaciones de
// selección de arena/PA que ya cubre aquel.
//
// Comprobación automática del centrado (sin sonda nueva): server/src/rooms/
// base/RoomExteriorBase.ts::manejarCombateMover y
// ArenaCombateRoom.ts::onCreate/onJoin fijan SIEMPRE
// `jugador.x = combate.gx0 + cu.gx + 0.5` (gx0 y gx son enteros de rejilla)
// — antes del fix de hoy faltaba el "+0.5", así que `player.x/y` (expuesto
// en window.__colonyDebug, la MISMA fuente que usa el resto de e2e de
// combate) caía siempre en un entero exacto (fracción .0). Comprobar que la
// fracción es exactamente .5 en la posición inicial Y tras moverse confirma
// el fix de verdad, sin depender de leer la escena Three.js.
//
// El resaltado de casilla (plano de color por unidad, resaltadoCombate.ts)
// no tiene sonda de test (es puramente visual, sin Schema propio) — se
// verifica con una captura de pantalla real dentro de la arena, mismo
// criterio que cadaveresVisual.e2e.cjs para verificaciones sin aserción
// programática posible.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/combateArenaCentrado.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const CARPETA_CAPTURAS = join(dirCliente, "test", "capturas");
mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const BD_RUTA = join(tmpdir(), "colony_combate_arena_centrado_e2e.sqlite");

const PUERTO_WS = 2609;
const PUERTO_WEB = 5198;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return;
    } catch {}
    await espera(500);
  }
  throw new Error(`No responde ${url}`);
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

function fraccionEsMedia(v) {
  const f = Math.abs(v % 1);
  return Math.abs(f - 0.5) < 1e-6;
}

async function main() {
  rmSync(BD_RUTA, { force: true });
  console.log("0) sembrando BD sqlite temporal (avispa_comun real junto al spawn — mismo atajo que combateArenaTierra.e2e.mjs)...");
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
        farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
      );
      CREATE TABLE IF NOT EXISTS fauna_salvaje (
        id TEXT PRIMARY KEY, mapa_id TEXT NOT NULL, sector_x INTEGER NOT NULL, sector_y INTEGER NOT NULL,
        especie_id TEXT NOT NULL, sexo TEXT NOT NULL, etapa TEXT NOT NULL DEFAULT 'adulto',
        estado TEXT NOT NULL DEFAULT 'vivo', x REAL NOT NULL, y REAL NOT NULL,
        ultima_comida REAL NOT NULL, ultima_bebida REAL NOT NULL,
        gestando_desde REAL, gestacion_duracion_dias REAL, nacio_en REAL,
        vida REAL NOT NULL DEFAULT 0, vida_max REAL NOT NULL DEFAULT 0, ataque REAL NOT NULL DEFAULT 0
      );
    `);
    const ahora = 999999;
    bd.prepare(`
      INSERT INTO fauna_salvaje
        (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y, ultima_comida, ultima_bebida, vida, vida_max, ataque)
      VALUES
        ('demo:0:0:1', 'demo', 0, 0, 'avispa_comun', 'hembra', 'adulto', 'vivo', 30.7, 18.7, ?, ?, 25, 25, 4)
    `).run(ahora, ahora);
    bd.close();
  }

  const rutaDemo = join(dirRaiz, "assets", "mapas", "demo");
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA });
  const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
    VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
    VITE_RUTA_MAPA: "/assets/mapas/demo",
  });
  const matarTodo = () => {
    for (const p of [servidor, vite]) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };
  process.on("exit", () => { matarTodo(); rmSync(BD_RUTA, { force: true }); });

  let browser;
  try {
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real (mapa demo, avispa ya sembrada a 1.41 casillas del spawn)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=CentradoTester`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test && !!window.__ajedrez, null, { timeout: 10000 });

    console.log("2) esperando a que el servidor active el sector con la avispa sembrada...");
    const objetivo = await page.evaluate(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const d = window.__colonyDebug;
        const f = window.__test.faunaCercana(d.x, d.y, 5);
        if (f && f.especieId === "avispa_comun") return f;
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    });
    comprobar("la avispa sembrada aparece activa junto al jugador", !!objetivo, objetivo ? `${objetivo.especieId} a ${objetivo.dist.toFixed(2)} casillas` : "no apareció en 15s");
    if (!objetivo) throw new Error("la fauna sembrada no se activó");

    console.log("3-4) ventana de unión (agro o C) + 'Comenzar ya' hasta llegar a la arena...");
    let combateId = null, llegoArena = false, cPulsada = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 20000) {
      const url = new URL(page.url());
      if (url.searchParams.get("sala") === "arena") { combateId = url.searchParams.get("combateId"); llegoArena = true; break; }
      let resultado;
      try {
        resultado = await page.evaluate(() => {
          const sid = window.__ajedrez.sessionId();
          const mio = window.__test.combates().find((c) => c.unidades.includes(sid) && c.fase === "pendiente");
          if (!mio) return { tenido: false, clicado: false };
          const boton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Comenzar ya");
          if (boton) boton.click();
          return { tenido: true, clicado: !!boton };
        });
      } catch {
        await espera(200);
        continue;
      }
      if (!resultado.tenido && !cPulsada) {
        await page.keyboard.press("c").catch(() => {});
        cPulsada = true;
      }
      await espera(250);
    }
    comprobar("llega a la arena (portal:ir real)", llegoArena, `url final=${page.url()}`);
    if (!llegoArena) throw new Error("nunca llegó a sala=arena");

    console.log(`5) en la arena (combateId=${combateId}) — esperando terreno...`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 15000 });
    await espera(600);

    const posInicial = await page.evaluate(() => window.__colonyDebug);
    comprobar(
      "posición inicial del jugador en la arena cae EXACTO en el centro de su casilla (fracción .5 en X e Y, no .0 — bug de centrado corregido)",
      fraccionEsMedia(posInicial.x) && fraccionEsMedia(posInicial.y),
      `x=${posInicial.x} y=${posInicial.y}`,
    );

    const rutaCapturaInicial = join(CARPETA_CAPTURAS, "combate_centrado_inicial.png");
    await page.screenshot({ path: rutaCapturaInicial });
    console.log(`   captura (resaltado de casilla visible sobre la rejilla): ${rutaCapturaInicial}`);

    const textoPanelCombate = await page.evaluate(() => document.body.innerText);
    if (textoPanelCombate.includes("Tu turno")) {
      console.log("6) moviendo en combate (combate:mover real) para confirmar que el centrado se mantiene tras moverse...");
      let movido = false;
      let posFinal = posInicial;
      for (const tecla of ["d", "a", "s", "w"]) {
        await page.keyboard.press(tecla);
        await espera(400);
        posFinal = await page.evaluate(() => window.__colonyDebug);
        if (posFinal.x !== posInicial.x || posFinal.y !== posInicial.y) { movido = true; break; }
      }
      comprobar("combate:mover mueve realmente al jugador", movido, `antes=(${posInicial.x},${posInicial.y}) después=(${posFinal.x},${posFinal.y})`);
      comprobar(
        "tras moverse, la posición SIGUE centrada exacta (fracción .5 en X e Y) — el fix cubre TODOS los puntos que fijan la posición, no solo la inicial",
        movido && fraccionEsMedia(posFinal.x) && fraccionEsMedia(posFinal.y),
        `x=${posFinal.x} y=${posFinal.y}`,
      );

      const rutaCapturaMovido = join(CARPETA_CAPTURAS, "combate_centrado_tras_mover.png");
      await page.screenshot({ path: rutaCapturaMovido });
      console.log(`   captura tras moverse (el resaltado debe haber seguido a la unidad a su nueva casilla): ${rutaCapturaMovido}`);
    } else {
      console.log("6) saltado (no era mi turno en el instante de comprobar el panel)");
    }

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: centrado verificado en arena real (combateId=${combateId}), capturas en ${CARPETA_CAPTURAS} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ combateArenaCentrado.e2e: TODO OK" : `\n❌ combateArenaCentrado.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
