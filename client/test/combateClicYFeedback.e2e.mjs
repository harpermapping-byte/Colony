// E2E VISUAL del clic-para-moverte/atacar en combate + el feedback de golpe
// (pedido streamer 2026-09-09: "el movimiento... con clic sobre casillas...
// no se movería en WASD" + "cuando mueres no sale [texto de] resultado
// herido"). Mismo montaje EXACTO que combateArenaCentrado.e2e.mjs (avispa_comun
// sembrada junto al spawn del mapa demo) hasta llegar a la arena — este e2e
// es específico del clic (game.ts, listener nuevo fuera del bloque
// `if (SALA==="hub")`) y del registro de golpes (registroCombate.ts +
// combate:golpe nuevo en RoomExteriorBase.ts::manejarCombateAccion).
//
// El clic se dispara con page.mouse.click(x,y) en coordenadas de PANTALLA
// REALES (no se invoca el handler directamente) — x,y salen de
// window.__proyectarCasillaCombate (sonda nueva, ver game.ts), que hace la
// MISMA proyección mundo->pantalla que el juego real usa para pintar. Así
// se prueba el camino completo: raycast del clic -> combate:accion/mover ->
// servidor resuelve -> combate:golpe -> registroCombate.ts lo pinta.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/combateClicYFeedback.e2e.mjs
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
const BD_RUTA = join(tmpdir(), "colony_combate_clic_feedback_e2e.sqlite");

const PUERTO_WS = 2611;
const PUERTO_WEB = 5199;

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

async function main() {
  rmSync(BD_RUTA, { force: true });
  console.log("0) sembrando BD sqlite temporal (avispa_comun real junto al spawn — mismo atajo que combateArenaCentrado.e2e.mjs)...");
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
        ('demo:0:0:1', 'demo', 0, 0, 'avispa_comun', 'hembra', 'adulto', 'vivo', 30.7, 18.7, ?, ?, 40, 40, 4)
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

    console.log("1) cargando cliente real (mapa demo, avispa ya sembrada junto al spawn)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=ClicTester`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test && !!window.__proyectarCasillaCombate, null, { timeout: 10000 });

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
    let llegoArena = false, cPulsada = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 20000) {
      const url = new URL(page.url());
      if (url.searchParams.get("sala") === "arena") { llegoArena = true; break; }
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

    console.log("5) en la arena — esperando terreno y mi turno...");
    // `portal:ir` a la arena recarga la página entera (nueva URL con
    // sala=arena) — iniciarJuego() vuelve a correr desde cero, así que
    // window.__test/__ajedrez/__proyectarCasillaCombate desaparecen un
    // instante hasta que la nueva carga los redefine (mismo motivo por el
    // que combateArenaCentrado.e2e.mjs solo usa window.__colonyDebug tras
    // llegar aquí, nunca __ajedrez/__test).
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__combateDebug && !!window.__proyectarCasillaCombate, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("Tu turno"), null, { timeout: 15000 }).catch(() => {});
    await espera(400);

    console.log("6) el ataque base es cuerpo a cuerpo (sin arma equipada) — primero clic para ACERCARSE a la casilla junto al enemigo (combate:mover), luego clic sobre el enemigo para atacar (combate:accion)...");
    const situacionInicial = await page.evaluate(() => {
      const sid = window.__combateDebug.sessionId();
      const c = window.__combateDebug.combates().find((c) => c.unidades.includes(sid));
      if (!c) return null;
      const propia = c.unidadesDetalle.find((u) => u.id === sid);
      const enemigo = c.unidadesDetalle.find((u) => u.id !== sid && u.bando !== propia?.bando && u.estado === "activo");
      return { gx0: c.gx0, gy0: c.gy0, propia, enemigo };
    });
    comprobar("hay un enemigo activo localizable al empezar", !!situacionInicial?.enemigo, JSON.stringify(situacionInicial));
    if (!situacionInicial?.enemigo) throw new Error("sin enemigo activo que atacar");

    // Casilla adyacente al enemigo, en la línea que lo une con el jugador
    // (PA_MAX_COMBATE=6, COSTE_PA_ATAQUE=2, RoomExteriorBase.ts — 4 casillas
    // de movimiento + el golpe entran en el mismo turno con PA de sobra).
    const dx = Math.sign(situacionInicial.enemigo.gx - situacionInicial.propia.gx);
    const dy = Math.sign(situacionInicial.enemigo.gy - situacionInicial.propia.gy);
    const gxAdyacente = situacionInicial.enemigo.gx - dx;
    const gyAdyacente = situacionInicial.enemigo.gy - dy;
    const { x: pxAdyacente, y: pyAdyacente } = await page.evaluate(
      ({ gx0, gy0, gx, gy }) => window.__proyectarCasillaCombate(gx0, gy0, gx, gy),
      { gx0: situacionInicial.gx0, gy0: situacionInicial.gy0, gx: gxAdyacente, gy: gyAdyacente },
    );
    await page.mouse.click(pxAdyacente, pyAdyacente);
    await espera(600);

    const antesDelClic = await page.evaluate(() => {
      const sid = window.__combateDebug.sessionId();
      const c = window.__combateDebug.combates().find((c) => c.unidades.includes(sid));
      const propia = c?.unidadesDetalle.find((u) => u.id === sid);
      const enemigo = c?.unidadesDetalle.find((u) => u.id !== sid && u.estado === "activo");
      return { gx0: c?.gx0, gy0: c?.gy0, propia, enemigo };
    });
    comprobar(
      "el clic de acercarse SÍ movió al jugador junto al enemigo",
      antesDelClic.propia?.gx === gxAdyacente && antesDelClic.propia?.gy === gyAdyacente,
      `esperado=(${gxAdyacente},${gyAdyacente}) real=(${antesDelClic.propia?.gx},${antesDelClic.propia?.gy})`,
    );

    const { x: pxEnemigo, y: pyEnemigo } = await page.evaluate(
      ({ gx0, gy0, gx, gy }) => window.__proyectarCasillaCombate(gx0, gy0, gx, gy),
      { gx0: antesDelClic.gx0, gy0: antesDelClic.gy0, gx: antesDelClic.enemigo.gx, gy: antesDelClic.enemigo.gy },
    );
    await page.mouse.click(pxEnemigo, pyEnemigo);
    await espera(700);

    const tostText = await page.evaluate(() => document.body.innerText);
    comprobar("tras el clic sobre el enemigo aparece feedback de daño en pantalla ('de daño')", tostText.includes("de daño"), tostText.slice(0, 400).replace(/\n+/g, " | "));

    const despuesDelClic = await page.evaluate((idEnemigo) => {
      const sid = window.__combateDebug.sessionId();
      const c = window.__combateDebug.combates().find((c) => c.unidades.includes(sid));
      return c?.unidadesDetalle.find((u) => u.id === idEnemigo) ?? null;
    }, antesDelClic.enemigo.id);
    comprobar(
      "el clic de verdad atacó: la HP del enemigo bajó (combate:accion real, no solo un toast de mentira)",
      !!despuesDelClic && despuesDelClic.hp < antesDelClic.enemigo.hp,
      `antes=${antesDelClic.enemigo.hp} después=${despuesDelClic?.hp}`,
    );

    const rutaCapturaGolpe = join(CARPETA_CAPTURAS, "combate_clic_golpe.png");
    await page.screenshot({ path: rutaCapturaGolpe });
    console.log(`   captura (toast de daño visible sobre el panel): ${rutaCapturaGolpe}`);

    console.log("7) si sigue siendo mi turno Y queda PA, clic en una casilla VACÍA cercana -> debe moverse (combate:mover)...");
    await espera(400);
    const esMiTurnoAun = (await page.evaluate(() => document.body.innerText)).includes("Tu turno");
    const estadoPrevio = await page.evaluate(() => {
      const sid = window.__combateDebug.sessionId();
      const c = window.__combateDebug.combates().find((c) => c.unidades.includes(sid));
      const propia = c?.unidadesDetalle.find((u) => u.id === sid);
      return { gx0: c?.gx0, gy0: c?.gy0, gx: propia?.gx, gy: propia?.gy, pa: propia?.pa };
    });
    // Acercarse (4 PA) + atacar (2 PA) ya pudo agotar el PA_MAX_COMBATE=6 de
    // este turno (RoomExteriorBase.ts) — sin PA no hay nada que probar aquí,
    // no es un fallo: el movimiento en vacío YA quedó demostrado en el paso 6
    // (mover a la casilla adyacente al enemigo fue justo eso).
    if (esMiTurnoAun && estadoPrevio.pa >= 1) {
      const posPropiaAntes = await page.evaluate(() => window.__colonyDebug);
      const estado = estadoPrevio;
      // Casilla vacía real (no basta "la de al lado": el enemigo puede
      // haberse quedado justo ahí si ya empezaba adyacente) — se pide al
      // servidor la lista de ocupadas vía el propio combate y se prueban
      // candidatos hasta dar con uno libre.
      const ocupadasLista = await page.evaluate(() => {
        const sid = window.__combateDebug.sessionId();
        const c = window.__combateDebug.combates().find((c) => c.unidades.includes(sid));
        return c.unidadesDetalle.filter((u) => u.estado === "activo").map((u) => `${u.gx},${u.gy}`);
      });
      const ocupadas = new Set(ocupadasLista);
      const candidatos = [
        { gx: estado.gx + 1, gy: estado.gy }, { gx: estado.gx - 1, gy: estado.gy },
        { gx: estado.gx, gy: estado.gy + 1 }, { gx: estado.gx, gy: estado.gy - 1 },
      ];
      const libre = candidatos.find((c) => !ocupadas.has(`${c.gx},${c.gy}`));
      const gxDestino = libre?.gx ?? estado.gx + 1, gyDestino = libre?.gy ?? estado.gy;
      const { x: pxVacia, y: pyVacia } = await page.evaluate(
        ({ gx0, gy0, gx, gy }) => window.__proyectarCasillaCombate(gx0, gy0, gx, gy),
        { gx0: estado.gx0, gy0: estado.gy0, gx: gxDestino, gy: gyDestino },
      );
      await page.mouse.click(pxVacia, pyVacia);
      await espera(500);
      const posPropiaDespues = await page.evaluate(() => window.__colonyDebug);
      const seMovio = posPropiaDespues.x !== posPropiaAntes.x || posPropiaDespues.y !== posPropiaAntes.y;
      comprobar("clic en casilla vacía mueve de verdad al jugador (combate:mover real)", seMovio, `antes=(${posPropiaAntes.x},${posPropiaAntes.y}) después=(${posPropiaDespues.x},${posPropiaDespues.y})`);
    } else {
      console.log(`7) saltado (esMiTurno=${esMiTurnoAun} pa=${estadoPrevio.pa} — normal, acercarse+atacar ya pudo agotar el PA de este turno o el combate terminó)`);
    }

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: clic-para-atacar/moverte + feedback de golpe verificados en arena real, capturas en ${CARPETA_CAPTURAS} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ combateClicYFeedback.e2e: TODO OK" : `\n❌ combateClicYFeedback.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
