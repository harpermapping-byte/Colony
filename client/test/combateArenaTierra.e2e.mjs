// E2E VISUAL del combate en arena de TIERRA (docs/GDD_Combate.md §9.4/§9.6,
// hueco que la última línea de §9.6 deja explícito: "Sigue sin un E2E que
// además verifique el mapaArenaId elegido/el visual del roster en ESE
// combate concreto"). A diferencia de client/test/combate.e2e.mjs (colyseus.js
// plano, sin navegador — solo protocolo/estado), esto arranca el cliente
// REAL (Vite+Three.js) bajo Playwright, un jugador real entra en combate
// contra fauna terrestre real del mapa DEMO (mismo mapa que combate.e2e.mjs/
// combateCoop.e2e.mjs — el mapa PRINCIPAL deja la fauna a 17-24 casillas del
// spawn, fuera de rango cómodo) y CAPTURA una pantalla de la ARENA de verdad
// (pradera_01 o bosque_01, lo que elija `elegirArena` para ESE combateId),
// no del mundo exterior.
//
// Fauna: mismo atajo que client/test/combateCoop.e2e.mjs (siembra directa en
// `fauna_salvaje`, bypass del BAKE — nunca del PROTOCOLO de combate) — una
// avispa_comun real del catálogo (peligroso:true, radioAgro=1, vida=25) a
// (31.5,19.5), 1.41 casillas del spawn del demo (30.5,18.5): confirmado
// tierra libre, dentro de RADIO_INTERACCION (2.2) pero fuera de su
// radioAgro, así que NO agroea sola — el jugador la ataca él mismo, tal
// cual pediría un jugador real. Se descartó perseguir al erizo/arrendajo del
// bake (únicas especies del demo, no peligrosas): deambulan sin rumbo por
// bastante más que RADIO_INTERACCION real en el rato que tarda un e2e en
// acercarse paso a paso, así que una persecución a ciegas resultó frágil de
// verdad (confirmado con 2 intentos reales) — exactamente el criterio de
// esta sesión para no perseguirlo más y usar el atajo ya validado en
// combateCoop.e2e.mjs. Como bonus, avispa_comun SÍ es peligrosa: este e2e
// ejercita la ventana de unión real (fase "pendiente" + botón "Comenzar ya"
// de panelCombate.ts), no solo el atajo síncrono de "modo caza".
//
// Verificación del hueco real del GDD: el `mapaArenaId` que el cliente
// carga de verdad (leído de la URL tras el portal:ir, la MISMA fuente que
// usa RUTA_MAPA para pedir los sectores) se compara contra
// `elegirArena(combateId, arenasDeTierra)` recalculado aquí con el MISMO
// hash determinista que server/src/combate/seleccionArena.ts — confirmando
// que el combate concreto que se jugó eligió lo que la función pura dice que
// debía elegir, no solo que la función pura en sí es correcta (eso ya lo
// cubren sus propios tests, que este e2e NO repite).
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/combateArenaTierra.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const CARPETA_CAPTURAS = join(dirCliente, "test", "capturas");
mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const BD_RUTA = join(tmpdir(), "colony_combate_arena_tierra_e2e.sqlite");

const PUERTO_WS = 2606;
const PUERTO_WEB = 5195;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(cmd, args, cwd, extraEnv = {}) {
  // detached + kill del GRUPO entero (npx lanza tsx/vite como nietos) — sin
  // esto quedan zombis en los puertos que rompen la siguiente ronda.
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

// --- mismo hash determinista que server/src/combate/seleccionArena.ts —
// portado tal cual (no reimplementado "a ojo") para que la comparación de
// abajo sea una comprobación real del mecanismo, no una tautología. ---
function hashDeterminista(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function elegirArena(combateId, arenas, terreno) {
  const candidatas = terreno ? arenas.filter((a) => a.terreno === terreno) : arenas;
  const lista = candidatas.length > 0 ? candidatas : arenas;
  return lista[hashDeterminista(combateId) % lista.length].id;
}
const catalogoArenas = JSON.parse(readFileSync(join(dirRaiz, "mazmorras", "catalogo", "arenas.json"), "utf8")).arenas;

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

async function main() {
  rmSync(BD_RUTA, { force: true });
  console.log("0) sembrando BD sqlite temporal (avispa_comun real, peligrosa, junto al spawn del demo — mismo atajo que combateCoop.e2e.mjs)...");
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        creado_en TEXT NOT NULL,
        farycoins INTEGER NOT NULL DEFAULT 0,
        vida INTEGER NOT NULL DEFAULT 100,
        vida_max INTEGER NOT NULL DEFAULT 100
      );
      CREATE TABLE IF NOT EXISTS fauna_salvaje (
        id TEXT PRIMARY KEY,
        mapa_id TEXT NOT NULL,
        sector_x INTEGER NOT NULL,
        sector_y INTEGER NOT NULL,
        especie_id TEXT NOT NULL,
        sexo TEXT NOT NULL,
        etapa TEXT NOT NULL DEFAULT 'adulto',
        estado TEXT NOT NULL DEFAULT 'vivo',
        x REAL NOT NULL,
        y REAL NOT NULL,
        ultima_comida REAL NOT NULL,
        ultima_bebida REAL NOT NULL,
        gestando_desde REAL,
        gestacion_duracion_dias REAL,
        nacio_en REAL,
        vida REAL NOT NULL DEFAULT 0,
        vida_max REAL NOT NULL DEFAULT 0,
        ataque REAL NOT NULL DEFAULT 0
      );
    `);
    const ahora = 999999; // futuro: necesitaComida/necesitaAgua nunca disparan (mismo truco que agroFauna.e2e.mjs)
    // BUG REAL encontrado en este mismo test (no del servidor):
    // GestorFaunaSalvaje.activarSector (server/src/mundo/faunaSalvajeViva.ts)
    // materializa la entidad viva en `fila.x+0.5, fila.y+0.5` — la fila
    // persistida es índice de CASILLA (entero), no la coordenada de mundo ya
    // centrada. Sembrar directamente 31.5/19.5 (como si ya fuera la
    // coordenada final) la deja de verdad en (32.0,20.0): a 2.12 casillas
    // del spawn (30.5,18.5), justo por debajo de RADIO_INTERACCION (2.2) y
    // sin margen para el deambular ambiental que arranca solo (1-4s
    // después de activarse, aunque no haya agroeado) — confirmado con 2
    // intentos reales que fallaban justo ahí. Sembrando la CASILLA 30.7,18.7
    // en vez de la coordenada final, la avispa aparece en (31.2,19.2),
    // ~0.99 del spawn: margen de sobra tanto para este desfase como para el
    // deambular mientras se resuelve la ventana de unión.
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
      if (t.startsWith("[combate]")) console.log(`  <consola> ${t}`);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real (mapa demo, avispa ya sembrada a 1.41 casillas del spawn)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=TierraTester`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test && !!window.__ajedrez, null, { timeout: 10000 });
    const spawnInicial = await page.evaluate(() => window.__colonyDebug);
    comprobar("cliente real conectado y con streaming activo", true, JSON.stringify(spawnInicial));

    console.log("2) esperando a que el servidor active el sector con la avispa sembrada (GestorFaunaSalvaje, hasta 10s)...");
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
    comprobar("la avispa sembrada aparece activa junto al jugador, sin que se mueva", !!objetivo, objetivo ? `${objetivo.especieId} a ${objetivo.dist.toFixed(2)} casillas` : "no apareció en 15s");
    if (!objetivo) throw new Error("la fauna sembrada no se activó — no se puede verificar el combate de tierra");

    // avispa_comun SÍ es peligrosa -> fase "pendiente" real (nunca modo
    // caza). Con el jugador a 0.99 (menor que su radioAgro=1), lo normal es
    // que la propia avispa abra la ventana ella sola (agro por distancia,
    // docs/GDD_Combate.md §7bis) antes de que este script llegue a pulsar
    // "C" — de ahí el chequeo de "ya hay un combate pendiente" ANTES de
    // pulsar nada, para no mandar un combate:iniciar redundante (rechazado
    // con "ya estás en combate", inofensivo pero innecesario).
    //
    // BUG REAL encontrado en este mismo test (no del servidor, confirmado
    // con un diagnóstico completo del DOM en vivo): panelCombate.ts se
    // reconstruye ENTERO (innerHTML="") en CADA patch del servidor
    // (room.onStateChange, ~15/seg) — el botón "Comenzar ya" SÍ estaba en
    // el DOM con el texto exacto todo el rato (confirmado), pero el
    // `page.locator(...).click()` de Playwright (que espera a que el
    // elemento esté "estable" varios frames seguidos antes de pulsar)
    // nunca conseguía una ventana de estabilidad frente a un nodo que se
    // destruye y recrea constantemente — fallaba en silencio bajo el
    // `.catch(()=>{})` en TODOS los intentos, sin que ningún combate:comenzarYa
    // llegara jamás al servidor. Arreglo: disparar el clic real vía DOM
    // (`elemento.click()`, MISMO evento nativo que dispara el `onclick` de
    // verdad, mismo combate:comenzarYa real) dentro de un único
    // `page.evaluate` — sin el gating de estabilidad de Playwright, que es
    // lo que no encajaba con un panel que se redibuja 15 veces por segundo.
    console.log("3-4) ventana de unión real (avispa_comun peligrosa — agro por distancia o combate:iniciar) + 'Comenzar ya' hasta llegar a la arena...");
    let combateId = null, llegoArena = false;
    let cPulsada = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 20000) {
      const url = new URL(page.url());
      if (url.searchParams.get("sala") === "arena") { combateId = url.searchParams.get("combateId"); llegoArena = true; break; }

      // El propio clic puede disparar la navegación a mitad de esta misma
      // vuelta (navegarA hace location.search=... en cuanto llega el
      // portal:ir) — page.evaluate revienta con "Execution context was
      // destroyed" en ese caso, que aquí es ÉXITO, no fallo: la siguiente
      // vuelta del bucle lo detecta por la URL.
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
        // Red de seguridad: si por lo que sea el agro automático no abrió
        // la ventana sola, el jugador la abre él mismo (tecla C real, sin
        // UI de targeting — igual que combate.e2e.mjs).
        await page.keyboard.press("c").catch(() => {});
        cPulsada = true;
      }
      await espera(250);
    }
    comprobar("la ventana de unión se abre (agro o C) y 'Comenzar ya' la cierra, navegando a la arena (portal:ir real)", llegoArena, `url final=${page.url()}`);
    if (!llegoArena) throw new Error("nunca llegó a sala=arena");

    console.log(`5) en la arena (combateId=${combateId}) — esperando a que cargue el terreno bakeado...`);
    // Recarga de página real (navegarA hace location.search=...): __colonyDebug
    // es de una instancia NUEVA de iniciarJuego, hay que esperarlo de nuevo.
    // OJO: la sala aquí es "arena" (URL sala=arena), NO "hub" — el bloque
    // entero `if (SALA==="hub")` de game.ts (incluidos window.__test/
    // __ajedrez/__construccion) NUNCA se ejecuta dentro de una arena (bug de
    // ESTE test, no del juego: asumía que esas sondas seguían disponibles
    // tras el portal — confirmado con un timeout real esperándolas). Dentro
    // de la arena solo hay que fiarse de lo genérico (__colonyDebug/
    // __streaming) y del propio DOM/texto del panel de combate real.
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 15000 });
    await espera(600); // asentar cámara/patch inicial antes de la captura

    const urlArena = new URL(page.url());
    const mapaArenaIdObservado = urlArena.searchParams.get("mapaId");
    const esperado = elegirArena(combateId, catalogoArenas, "tierra");
    comprobar(
      "el mapaArenaId que cargó el cliente coincide con elegirArena(combateId, arenas, 'tierra') recalculado en este test",
      mapaArenaIdObservado === esperado,
      `observado=${mapaArenaIdObservado} esperado=${esperado} combateId=${combateId}`,
    );
    comprobar("la arena elegida es una de tierra (pradera_01/bosque_01), nunca mar_01", mapaArenaIdObservado === "pradera_01" || mapaArenaIdObservado === "bosque_01", mapaArenaIdObservado);

    // Panel de combate real (client/src/combate/panelCombate.ts) — dentro de
    // la arena la fase ya es "activo" desde el primer instante
    // (ArenaCombateRoom.onCreate deja combate.fase="activo" al montarla), así
    // que el texto deja de mostrar "Esperando refuerzos" y pasa a "Tu turno"/
    // "Turno de: <id>" + "HP" — confirmación visual real sin sonda de test.
    const textoPanelCombate = await page.evaluate(() => document.body.innerText);
    comprobar(
      "el panel de combate real muestra la fase activa (turno/HP), no la ventana de unión",
      /HP/.test(textoPanelCombate) && (textoPanelCombate.includes("Tu turno") || textoPanelCombate.includes("Turno de:")),
      textoPanelCombate.slice(0, 300).replace(/\n+/g, " | "),
    );

    const rutaCaptura = join(CARPETA_CAPTURAS, "combate_tierra_arena.png");
    await page.screenshot({ path: rutaCaptura });
    console.log(`   captura: ${rutaCaptura}`);

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: combate de tierra real en mapaArenaId="${mapaArenaIdObservado}" (combateId=${combateId}), captura en ${rutaCaptura} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ combateArenaTierra.e2e: TODO OK" : `\n❌ combateArenaTierra.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
