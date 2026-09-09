// E2E de PLAYTEST real del streaming de sectores contra el mapa PRINCIPAL de
// verdad (pedido streamer 2026-09-09, madrugada: "necesito que hagas pruebas
// jugando desde navegadores, para ver el lag, optimizar todo lo posible, que
// cargue como a chunks o incluso que cargue por radio solo... busca la forma
// de jugar BIEN y que esté OPTIMIZADO... haz de betatester y developer a la
// vez"). Cierra el hueco real de esta sesión: NINGÚN e2e anterior tocaba
// `streamingSectores.ts`/`sectorVisual.ts` a través de un navegador real —
// todo lo verificado hasta ahora fue con benchmarks aislados (Chromium
// headless directo contra `crearSectorVisual`) o razonamiento de código,
// nunca con un cliente conectado de verdad saltando por el mapa grande.
//
// Usa `admin:debug:teleport` (jarl real, `JARL_NOMBRES` env) para saltar
// entre sectores MUY separados sin esperar a andar físicamente miles de
// casillas.
//
// **Hallazgo importante de esta pasada, documentado para no repetir la
// investigación**: este entorno sandbox NO tiene GPU real — Chromium cae a
// WebGL por software ("Automatic fallback to software WebGL has been
// deprecated", log de consola real) — confirmado con un perfil de CPU real
// (CDP Profiler) que ~99% del tiempo de frame cae en `(program)` (código
// nativo/GPU), mientras que TODA la lógica JS del juego (materializar
// sectores, mover fauna decorativa, actualizar matrices) suma unos pocos
// cientos de ms en una ventana de 6s de muestreo — la lógica está limpia,
// el cuello de botella es la RASTERIZACIÓN, un artefacto de este entorno
// sin GPU, no del código. Por eso este test NO hace ninguna aserción dura
// sobre fps/ms-por-frame (fallaría siempre aquí, sin decir nada real sobre
// cómo rinde en una GPU de verdad) — mide y loguea esos números como
// información, pero las aserciones se centran en lo que SÍ es válido medir
// en cualquier entorno: fetches de red (sin duplicados), el pool de caché
// (tapona en el límite), que nunca se quede until colgado sin asentar, y
// cero errores de consola/página.
//
// Encontrado y arreglado en la misma pasada (real, no del entorno): TODOS
// los InstancedMesh de props (vegetación/rocas/fauna decorativa — la
// inmensa mayoría de instancias de cualquier sector real) proyectaban
// sombra sin excepción — con miles de instancias pequeñas por sector eso
// multiplica el coste del pase de shadow map para un detalle que apenas se
// nota en cámara isométrica. `sectorVisual.ts` ahora solo deja `castShadow`
// en lo grande/prominente (edificios, decoración urbana) — ver el propio
// código para el detalle. Es una reducción de coste de GPU real en
// CUALQUIER hardware (menos geometría en el pase de sombra), no un parche
// específico de este entorno — aunque medida aquí (sin GPU) el margen es
// pequeño porque el cuello de botella dominante sigue siendo la
// rasterización por software del resto de la escena.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/streamingLagPlaytest.e2e.mjs
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
const BD_RUTA = join(tmpdir(), "colony_streaming_lag_playtest_e2e.sqlite");

const PUERTO_WS = 2611;
const PUERTO_WEB = 5201;

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

// Sectores 320 casillas de lado sobre un mapa 3200x3200 (10x10 sectores) —
// centro de cada sector para no caer justo en el borde.
function centroSector(sx, sy) {
  return { x: sx * 320 + 160, y: sy * 320 + 160 };
}

async function main() {
  rmSync(BD_RUTA, { force: true });
  console.log("0) sembrando BD sqlite temporal vacía (el mapa principal ya tiene POIs/población horneados en disco)...");
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`CREATE TABLE IF NOT EXISTS jugadores (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL);`);
    bd.close();
  }

  const rutaPrincipal = join(dirRaiz, "assets", "mapas", "principal");
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO_WS),
    RUTA_MAPA: rutaPrincipal,
    BD_RUTA,
    JARL_NOMBRES: "LagTester",
  });
  const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
    VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
    VITE_RUTA_MAPA: "/assets/mapas/principal",
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    // Waterfall de red: cuenta cuántas veces se pide CADA sector_XXX_YYY.json
    // — más de 1 vez para la MISMA url es el bug real que la caché debería
    // impedir (fetch redundante por red en vez de reusar `cache`/pool).
    const fetchsPorSector = new Map();
    page.on("request", (req) => {
      const m = req.url().match(/sector_(\d{3})_(\d{3})\.json/);
      if (m) {
        const clave = `${m[1]}_${m[2]}`;
        fetchsPorSector.set(clave, (fetchsPorSector.get(clave) || 0) + 1);
      }
    });

    console.log("1) cargando cliente real contra assets/mapas/principal (jarl real vía JARL_NOMBRES para poder teletransportarse)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=LagTester`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    const posInicial = await page.evaluate(() => window.__colonyDebug);
    console.log(`   spawn real en (${posInicial.x.toFixed(1)}, ${posInicial.y.toFixed(1)})`);

    // Asentamiento tras un teleport: sin cota corta artificial — mide lo que
    // tarde de verdad (en este entorno sin GPU puede ser varios segundos,
    // dominado por rasterización por software, no por la lógica) y solo
    // falla si se queda GENUINAMENTE colgado (nunca asienta). 45s de margen
    // real: medido en esta misma sesión que un solo teleport lejano (9
    // sectores nuevos de golpe) puede tardar bastante en un entorno sin GPU
    // real con el hilo principal muy saturado — nunca ocurriría así de
    // golpe caminando normal (solo 1-3 sectores nuevos por frontera).
    async function esperarAsentado(timeoutMs = 45000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const s = await page.evaluate(() => window.__streaming());
        if (s.enVuelo === 0 && s.materializando === 0) return { stats: s, ms: Date.now() - t0 };
        await espera(200);
      }
      return { stats: await page.evaluate(() => window.__streaming()), ms: Date.now() - t0, timeout: true };
    }

    async function teletransportar(nombre, sx, sy) {
      const { x, y } = centroSector(sx, sy);
      await page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), { x, y });
      await page.waitForFunction(
        ({ x, y }) => window.__colonyDebug && Math.abs(window.__colonyDebug.x - x) < 1 && Math.abs(window.__colonyDebug.y - y) < 1,
        { x, y },
        { timeout: 60000 },
      );
      const { stats, ms, timeout } = await esperarAsentado();
      console.log(`   [${nombre}] sector(${sx},${sy}) → materializados=${stats.materializados} enCache=${stats.enCache} pool=${stats.materializadosCacheados} enVuelo=${stats.enVuelo} materializando=${stats.materializando} (asentado en ${ms}ms${timeout ? ", TIMEOUT — sigue materializando" : ""})`);
      return { stats, ms, timeout };
    }

    console.log("2) recorrido de 5 teletransportes cubriendo sectores muy separados (esquinas, centro, la capital densa del spawn) + revisita cercana y lejana (pool de caché)...");
    const recorrido = [
      ["capital (spawn)", 4, 6],
      ["vecino este", 5, 6],
      ["REVISITA CERCANA capital", 4, 6],
      ["esquina NO", 0, 0],
      ["REVISITA LEJANA capital (pool ya debería haberla expulsado)", 4, 6],
    ];
    let maxAsentadoMs = 0;
    let algunTimeout = false;
    for (const [nombre, sx, sy] of recorrido) {
      const r = await teletransportar(nombre, sx, sy);
      maxAsentadoMs = Math.max(maxAsentadoMs, r.ms);
      if (r.timeout) algunTimeout = true;
      // Pausa de recuperación entre saltos: este entorno de test (sin GPU
      // real) puede dejar el hilo principal saturado un rato tras asentar
      // un sector muy denso — dar un respiro evita que el SIGUIENTE
      // teleport se encole detrás de trabajo de renderizado atrasado (no
      // pasaría así en un navegador real con GPU, ver cabecera del archivo).
      await espera(1500);
    }

    const rutaCapturaCiudad = join(CARPETA_CAPTURAS, "streaming_lag_capital.png");
    await teletransportar("captura en la capital", 4, 6);
    await espera(500);
    await page.screenshot({ path: rutaCapturaCiudad });
    console.log(`   captura del sector más denso (capital): ${rutaCapturaCiudad}`);

    const streamingFinal = await page.evaluate(() => window.__streaming());

    console.log("\n=== RESULTADOS ===");
    console.log(`Fetches de red por sector: ${[...fetchsPorSector.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`Estado final de streaming: materializados=${streamingFinal.materializados} enCache=${streamingFinal.enCache} pool=${streamingFinal.materializadosCacheados}`);
    console.log(`Tiempo máximo en asentarse tras un teleport: ${maxAsentadoMs}ms (informativo — este entorno no tiene GPU real, ver cabecera del archivo)`);

    const duplicados = [...fetchsPorSector.entries()].filter(([, n]) => n > 1);
    comprobar("ningún sector_XXX_YYY.json se pidió por red más de una vez en la sesión (caché real, no refetch)", duplicados.length === 0, duplicados.map(([k, n]) => `${k}×${n}`).join(", "));
    comprobar("el pool de sectores materializados-cacheados taponó en 6 (nunca creció sin límite)", streamingFinal.materializadosCacheados <= 6, `materializadosCacheados=${streamingFinal.materializadosCacheados}`);
    comprobar("cada teleport terminó asentando de verdad (nunca se quedó colgado materializando para siempre)", !algunTimeout, `peor caso=${maxAsentadoMs}ms`);
    comprobar("sin errores de página/consola durante todo el recorrido", erroresConsola.length === 0, erroresConsola.slice(0, 8).join(" | "));

    console.log(`\n=== capturas en ${CARPETA_CAPTURAS} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ streamingLagPlaytest.e2e: TODO OK" : `\n❌ streamingLagPlaytest.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
