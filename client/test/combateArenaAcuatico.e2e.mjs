// E2E VISUAL del combate en arena ACUÁTICA (docs/GDD_Combate.md §9.6, hueco
// que la última línea deja explícito: "Sigue sin un E2E que además verifique
// el mapaArenaId elegido/el visual del roster en ESE combate concreto" —
// esto es justo lo que faltaba: `server/test/agroFauna.e2e.mjs` ya prueba
// que la orca agroea sola, pero con colyseus.js plano, sin cliente real ni
// arena/visual). Aquí un jugador real (Playwright, mismo patrón que
// combateArenaTierra.e2e.mjs) se embarca de verdad (barco:montar real,
// tecla P), la orca sembrada agroea sola (mismo atajo de siembra directa en
// `fauna_salvaje` que agroFauna.e2e.mjs/server/test/barcos.e2e.mjs para
// `barcos`, sobre el mapa test_mar_a 100% agua — mismo mapa de prueba que
// esos dos, generado por baker/src/generar_mapas_prueba_barcos.js), la
// ventana de unión se cierra con "Comenzar ya" y se CAPTURA la arena mar_01
// de verdad mostrando el indicador 🚣 (capitán del barco) junto al HP
// propio en panelCombate.ts — el hilo completo roster→CombateUnidad.visual→
// cliente, verificado con captura real, no solo con los tipos.
//
// Alcance deliberado (regla de esta sesión: no perseguir más de 2-3
// intentos razonables): se confirma el caso CAPITÁN ("barco", un solo
// jugador — más simple de montar que el de tripulación, que necesita DOS
// jugadores en el MISMO barco porque solo el primero en subir pilota, ver
// RoomExteriorBase.manejarBarcoMontar). El caso "nadando" (tripulación NO
// capitana) queda anotado en el informe final, no perseguido aquí.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/combateArenaAcuatico.e2e.mjs
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
const BD_RUTA = join(tmpdir(), "colony_combate_arena_acuatico_e2e.sqlite");

const PUERTO_WS = 2607;
const PUERTO_WEB = 5194;

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

// --- mismo hash determinista que server/src/combate/seleccionArena.ts ---
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
  console.log("0) sembrando BD sqlite temporal (barco_2 + orca real, peligrosa/requiereAgua, junto al spawn de test_mar_a)...");
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
      CREATE TABLE IF NOT EXISTS barcos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jugador_id INTEGER NOT NULL,
        tipo_id TEXT NOT NULL,
        mapa_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        creado_en TEXT NOT NULL
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
    // Sin fila en `jugadores`: el servidor la crea sola al primer join con
    // un nombre nuevo (confirmado con combateCoop.e2e.mjs, mismo patrón).
    // Barco: NO lleva el +0.5 de fauna_salvaje (confirmado con
    // server/test/barcos.e2e.mjs — su barco_1 en (10,8) se monta al
    // instante sin caminar) — spawn real de test_mar_a es (8.5,8.5) (mapa
    // 16x16 sin `ciudad` en indice.json → centro (8,8)+0.5, ver
    // mundo/mapaColision.ts) y (10,8) queda a 1.80 casillas, dentro de
    // RADIO_INTERACCION (2.2) sin caminar. barco_2 (2 plazas, items/catalogo/
    // items.json) para poder confirmar además el caso tripulación si da tiempo.
    bd.prepare("INSERT INTO barcos (jugador_id, tipo_id, mapa_id, x, y, creado_en) VALUES (1, 'barco_2', 'test_mar_a', 10, 8, ?)").run(new Date().toISOString());
    // Orca: SÍ lleva el +0.5 (GestorFaunaSalvaje.activarSector, bug real
    // encontrado y documentado en combateArenaTierra.e2e.mjs) — sembrada en
    // (9.3,7.3) queda viva en (9.8,7.8), a 1.87 del spawn: de sobra dentro
    // de su radioAgro=10 (baker/catalogo/animales.json), agroea sola sin
    // que el jugador haga nada, igual que server/test/agroFauna.e2e.mjs.
    const ahora = 999999;
    bd.prepare(`
      INSERT INTO fauna_salvaje
        (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y, ultima_comida, ultima_bebida, vida, vida_max, ataque)
      VALUES
        ('test_mar_a:0:0:1', 'test_mar_a', 0, 0, 'orca', 'macho', 'adulto', 'vivo', 9.3, 7.3, ?, ?, 300, 300, 40)
    `).run(ahora, ahora);
    bd.close();
  }

  const rutaMarA = join(dirRaiz, "assets", "mapas", "test_mar_a");
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), RUTA_MAPA: rutaMarA, BD_RUTA });
  const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
    VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
    VITE_RUTA_MAPA: "/assets/mapas/test_mar_a",
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
    const erroresBarco = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(t);
      if (t.startsWith("[barco]")) erroresBarco.push(t);
      if (t.startsWith("[combate]") || t.startsWith("[barco]")) console.log(`  <consola> ${t}`);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real (mapa test_mar_a, 100% agua — barco_2 y orca ya sembrados)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=MarTester`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 20000 });
    const spawnInicial = await page.evaluate(() => window.__colonyDebug);
    comprobar("cliente real conectado y con streaming activo sobre test_mar_a", true, JSON.stringify(spawnInicial));

    console.log("2) embarcando (tecla P real, barco_2 ya está dentro de RADIO_INTERACCION del spawn, sin caminar)...");
    await page.keyboard.press("p").catch(() => {});
    await espera(600);
    comprobar("barco:montar real sin barco:error (capitán, primero en subir)", erroresBarco.length === 0, erroresBarco.join(" | "));

    console.log("3) esperando a que la orca sembrada agroee sola (GestorFaunaSalvaje + radar de agro, hasta 15s)...");
    let combateId = null, llegoArena = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 25000) {
      const url = new URL(page.url());
      if (url.searchParams.get("sala") === "arena") { combateId = url.searchParams.get("combateId"); llegoArena = true; break; }

      let resultado;
      try {
        resultado = await page.evaluate(() => {
          const boton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Comenzar ya");
          if (boton) boton.click();
          return { clicado: !!boton, texto: document.body.innerText.includes("Esperando refuerzos") };
        });
      } catch {
        await espera(200);
        continue;
      }
      if (resultado.clicado) console.log("   ventana de unión detectada (orca agroeó sola) — 'Comenzar ya' pulsado");
      await espera(300);
    }
    comprobar("la orca agroea sola y 'Comenzar ya' cierra la ventana, navegando a la arena (portal:ir real)", llegoArena, `url final=${page.url()}`);
    if (!llegoArena) throw new Error("nunca llegó a sala=arena");

    console.log(`4) en la arena acuática (combateId=${combateId}) — esperando a que cargue el terreno bakeado...`);
    // SALA=arena aquí (no "hub"): window.__test/__ajedrez NO existen dentro
    // de una arena (bug de test encontrado y documentado en
    // combateArenaTierra.e2e.mjs) — solo lo genérico (__colonyDebug/
    // __streaming) y el DOM/texto real del panel de combate.
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 15000 });
    await espera(600); // asentar cámara/patch inicial antes de la captura

    const urlArena = new URL(page.url());
    const mapaArenaIdObservado = urlArena.searchParams.get("mapaId");
    const esperado = elegirArena(combateId, catalogoArenas, "agua");
    comprobar(
      "el mapaArenaId que cargó el cliente coincide con elegirArena(combateId, arenas, 'agua') recalculado en este test",
      mapaArenaIdObservado === esperado,
      `observado=${mapaArenaIdObservado} esperado=${esperado} combateId=${combateId}`,
    );
    comprobar("la arena elegida es la de agua (mar_01), nunca tierra", mapaArenaIdObservado === "mar_01", mapaArenaIdObservado);

    const textoPanelCombate = await page.evaluate(() => document.body.innerText);
    comprobar(
      "el panel de combate real muestra la fase activa (turno/HP), no la ventana de unión",
      /HP/.test(textoPanelCombate) && (textoPanelCombate.includes("Tu turno") || textoPanelCombate.includes("Turno de:")),
      textoPanelCombate.slice(0, 300).replace(/\n+/g, " | "),
    );
    comprobar(
      "indicador 🚣 (capitán del barco_2) visible junto al HP propio — roster→CombateUnidad.visual→panelCombate.ts de punta a punta",
      textoPanelCombate.includes("🚣"),
      textoPanelCombate.split("\n").find((l) => l.includes("Tú:")) ?? "(línea 'Tú:' no encontrada)",
    );
    comprobar("barcoTipoId real (barco_2) propagado hasta el panel, no solo el icono", textoPanelCombate.includes("barco_2"), textoPanelCombate.match(/🚣[^\n]*/)?.[0] ?? "?");

    const rutaCaptura = join(CARPETA_CAPTURAS, "combate_acuatico_arena.png");
    await page.screenshot({ path: rutaCaptura });
    console.log(`   captura: ${rutaCaptura}`);

    // Coste de terreno por PA (docs/GDD_Combate.md §9.3, pedido streamer:
    // "2 PA si la casilla es terreno difícil/agua") — mar_01 es agua entera,
    // así que CUALQUIER paso real debe costar 2 PA, no 1 (a diferencia del
    // bosque de tierra, ver combateArenaTierra.e2e.mjs).
    if (textoPanelCombate.includes("Tu turno")) {
      console.log("5) moviendo en combate por agua (combate:mover real, coste de terreno)...");
      const paInicial = Number(/PA: (\d+)\//.exec(textoPanelCombate)?.[1]);
      const posInicial = await page.evaluate(() => window.__colonyDebug);
      let movido = false;
      let posFinal = posInicial;
      for (const tecla of ["d", "a", "s", "w"]) {
        await page.keyboard.press(tecla);
        await espera(400);
        posFinal = await page.evaluate(() => window.__colonyDebug);
        if (posFinal.x !== posInicial.x || posFinal.y !== posInicial.y) { movido = true; break; }
      }
      comprobar("combate:mover real mueve al jugador también en la arena acuática", movido, `antes=(${posInicial.x},${posInicial.y}) después=(${posFinal.x},${posFinal.y})`);
      const paTrasMover = Number(/PA: (\d+)\//.exec(await page.evaluate(() => document.body.innerText))?.[1]);
      comprobar(
        "moverse UNA casilla en agua (mar_01, todo agua) consume 2 PA, no 1 — coste de terreno real",
        movido && paTrasMover === paInicial - 2,
        `PA antes=${paInicial} después=${paTrasMover}`,
      );
    }

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: combate acuático real en mapaArenaId="${mapaArenaIdObservado}" (combateId=${combateId}), captura en ${rutaCaptura} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ combateArenaAcuatico.e2e: TODO OK" : `\n❌ combateArenaAcuatico.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
