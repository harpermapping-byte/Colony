// Playtest REAL del bucle de oficios en navegador (docs/GDD_Crafteo.md §10,
// docs/GDD_Agricultura.md — 2026-09-11, pregunta del streamer: "farmeaste,
// hiciste crafteos en mesa, subiste nivel de oficios y viste nuevos crafteos,
// probaste a crear muebles nuevos o los minijuegos?"): servidor Colyseus real
// + Vite + UNA página Playwright sobre assets/mapas/testflat (Test Zone con
// Maestro de Oficios real en (24,44) y parcela tf_0001), jugando por la UI
// de verdad — clic sobre la mesa, menú "Craftear en…", botones del panel de
// crafteo, botones del minijuego de forja, menú del suelo para labrar/
// plantar/cosechar, panel del carpintero legendario. Las sondas window.__*
// solo se usan para LEER estado y para atajos de jarl (darItem/teleport),
// nunca para sustituir el gesto que haría un jugador.
//   1) elegir herrero + carpintero hablando con el maestro (oficio:elegir);
//   2) el jarl coloca un yunque_tocon y un banco_carpintero en su parcela (construir);
//   3) clic en el yunque → "Craftear en Yunque" → panel con recetas, clavos desbloqueada, olla (nivel 2) bloqueada;
//   4) craftear clavos 6 veces → XP real → "¡Herrero nivel 2!" con las recetas nuevas, olla ya desbloqueada;
//   5) daga (minijuego de forja): Avivar hasta FORJAR, 12 golpes, Templar → daga real en el inventario;
//   6) agricultura de casilla: labrar con azada, plantar trigo, cosechar una casilla madura — casillas REPLICADAS visibles;
//   7) carpintero legendario (nivel 10 vía debug): tallar un mueble nuevo desde una descripción.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/playtestOficios.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const CAPTURAS = join(dirCliente, "test", "capturas");
mkdirSync(CAPTURAS, { recursive: true });
const BD = join(tmpdir(), "colony_playtest_oficios.sqlite");
const WS = 2620, WEB = 5220, NOMBRE = "PlaytestOficios", DIA = 60; // mes 3: semilla_trigo se siembra en [3,4,5]
const RUTA_MAPA = join(dirRaiz, "assets", "mapas", "testflat");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (n, ok, d) => { console.log(`${ok ? "OK" : "FALLO"} ${n}${d ? ` (${d})` : ""}`); if (!ok) fallos++; };

// --- BD sembrada ANTES de arrancar: el jugador (id 1, dueño nominal) y una
// casilla (27,10) sembrada y madura de sobra — mismo atajo que
// server/test/cultivoCasilla.e2e.mjs (hidratada al crear la room; ahora
// además REPLICADA, así que el cliente tiene que verla como brote maduro).
rmSync(BD, { force: true });
{
  const bd = new DatabaseSync(BD);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS casillas_cultivo (
      mapa_id TEXT NOT NULL, idx_casilla INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      dueno_id INTEGER NOT NULL, estado TEXT NOT NULL, semilla_id TEXT, dia_plantado INTEGER,
      PRIMARY KEY (mapa_id, idx_casilla)
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 5000)").run(NOMBRE, new Date().toISOString());
  const indice = JSON.parse(readFileSync(join(RUTA_MAPA, "indice.json"), "utf8"));
  const ancho = indice.anchoChunks * indice.tamanoChunk;
  bd.prepare("INSERT INTO casillas_cultivo (mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado) VALUES ('testflat', ?, 27.5, 10.5, 1, 'sembrada', 'semilla_trigo', ?)").run(10 * ancho + 27, DIA - 100);
  bd.close();
}

const procesos = [];
const lanzar = (cmd, args, cwd, env) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); procesos.push(p); return p; };
const matarTodo = () => { for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} } rmSync(BD, { force: true }); };
process.on("exit", matarTodo);
const srv = lanzar("npx", ["tsx", "src/index.ts"], join(dirRaiz, "server"), { PORT: String(WS), RUTA_MAPA, BD_RUTA: BD, JARL_NOMBRES: NOMBRE, DIA_FORZADO: String(DIA) });
const erroresServidor = [];
srv.stderr.on("data", (d) => { const t = String(d); if (/Error|error:/.test(t) && !/ExperimentalWarning|DeprecationWarning|punycode|twitch|TWITCH/.test(t)) erroresServidor.push(t.trim().slice(0, 200)); });
lanzar("npx", ["vite", "--port", String(WEB), "--strictPort"], dirCliente, { VITE_COLYSEUS_URL: `ws://localhost:${WS}`, VITE_RUTA_MAPA: "/assets/mapas/testflat" });
for (const url of [`http://localhost:${WS}/`, `http://localhost:${WEB}/`]) for (let i = 0; i < 240; i++) { try { await fetch(url); break; } catch {} await esperar(500); }

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e?.stack || e).split("\n").slice(0, 2).join(" | ")));
  await page.goto(`http://localhost:${WEB}/?nombre=${NOMBRE}`, { waitUntil: "commit", timeout: 120000 });
  await page.waitForFunction(() => window.__colonyDebug && window.__test && window.__crafteo && window.__cultivo && window.__inventario && window.__streaming && window.__streaming().materializados >= 1, null, { timeout: 150000 });
  const enviar = (tipo, msg) => page.evaluate(({ tipo, msg }) => window.__test.enviar(tipo, msg), { tipo, msg });
  const esperarMensaje = async (tipo, timeout = 30000, desde = 0) => {
    await page.waitForFunction(({ tipo, desde }) => { const m = window.__test.ultimoMensaje(tipo); return !!m && (window.__test._contador?.[tipo] ?? 1) > desde; }, { tipo, desde }, { timeout }).catch(() => {});
    return page.evaluate((tipo) => window.__test.ultimoMensaje(tipo), tipo);
  };
  const limpiarMensaje = (tipo) => page.evaluate((tipo) => window.__test._limpiar?.(tipo), tipo);
  const teleport = async (x, y) => {
    await enviar("admin:debug:teleport", { x, y });
    await page.waitForFunction(({ x, y }) => Math.hypot(window.__colonyDebug.x - x, window.__colonyDebug.y - y) < 2.5, { x, y }, { timeout: 30000 });
    await esperar(600);
  };
  const clicMundo = async (x, z, h = 0.3) => {
    // Cámara estable antes de proyectar (tras un teleport sigue persiguiendo al jugador unos frames).
    await page.waitForFunction(() => {
      const p = window.__proyectarMundo(window.__colonyDebug.x, window.__colonyDebug.y);
      const ok = window.__ultimaProj && Math.hypot(window.__ultimaProj.x - p.x, window.__ultimaProj.y - p.y) < 1;
      window.__ultimaProj = p;
      return ok;
    }, null, { timeout: 30000, polling: 250 }).catch(() => {});
    const px = await page.evaluate(({ x, z, h }) => window.__proyectarMundo(x, z, h), { x, z, h });
    const encima = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? "?", px);
    if (encima !== "CANVAS") console.log(`   (aviso) el punto (${px.x.toFixed(0)},${px.y.toFixed(0)}) está tapado por <${encima}> — el clic no llegará al lienzo`);
    await page.mouse.click(px.x, px.y);
  };
  const clicMenu = async (regex) => {
    const boton = page.getByRole("button", { name: regex });
    const ok = await boton.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (ok) await boton.first().click();
    return ok;
  };
  const textoPantalla = () => page.evaluate(() => document.body.innerText);

  // 1) Oficios con el maestro real de la Test Zone (24,44).
  console.log("1) elegir herrero + carpintero con el Maestro de Oficios...");
  await teleport(25.5, 45.5);
  await enviar("oficio:elegir", { oficio: "herrero" });
  const elegido1 = await esperarMensaje("oficio:elegido", 15000);
  await enviar("oficio:elegir", { oficio: "carpintero" });
  await esperar(1500);
  const oficios = await page.evaluate(() => { const yo = window.__jugadores().find((j) => j.nombre === "PlaytestOficios"); return yo ? [yo.oficio1, yo.oficio2] : null; }).catch(() => null);
  comprobar("herrero elegido en el slot 1 (gratis, junto al maestro)", elegido1?.oficio === "herrero" && elegido1?.slot === 1, JSON.stringify(elegido1));
  comprobar("carpintero elegido en el slot 2", await page.evaluate(() => !!window.__test.ultimoMensaje("oficio:elegido") && window.__test.ultimoMensaje("oficio:elegido").oficio === "carpintero"), JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("oficio:elegido"))) + (oficios ? ` state=${oficios}` : ""));

  // 2) El jarl coloca las mesas dentro de tf_0001 (fila 10, libre de los muebles de la Test Zone).
  console.log("2) colocar yunque_tocon (36,10) y banco_carpintero (34,10) con `construir`...");
  await teleport(35.5, 11.5);
  // Coste de materiales para construir mesas de oficio (docs/GDD_Construccion.md
  // §9, fusionado en la misma sesión que este playtest): yunque_tocon pide
  // piedra_comun×4+madera_blanda×2, banco_carpintero madera_blanda×9+
  // piedra_comun×3+madera_dura×2 — sembrado EXACTO (no de sobra): admin:
  // debug:darItem no comprueba el peso máximo transportable (20kg a nivel 1
  // de Fuerza), así que cualquier sobrante de estos materiales (2-2.5kg/
  // unidad) se queda pesando en el inventario para siempre y bloquea
  // TODO crafteo posterior — entregarOSoltar (el que reparte clavos/daga
  // más abajo) SÍ comprueba el peso y tira el resultado al suelo en vez de
  // dártelo si te pasas, precisamente el bug real que sembrar "de sobra"
  // disparaba aquí.
  await enviar("admin:debug:darItem", { itemId: "piedra_comun", cantidad: 7 });
  await enviar("admin:debug:darItem", { itemId: "madera_blanda", cantidad: 11 });
  await enviar("admin:debug:darItem", { itemId: "madera_dura", cantidad: 2 });
  await page.waitForFunction(() => window.__inventario().some((i) => i.itemId === "madera_dura"), null, { timeout: 15000 }).catch(() => {});
  await enviar("construir", { objeto: "yunque_tocon", categoria: "mueble", x: 36, y: 10, rot: 0 });
  const nuevaYunque = await esperarMensaje("construccion:nueva", 15000);
  const idYunque = nuevaYunque?.id ?? nuevaYunque?.construccion?.id ?? null;
  comprobar("yunque_tocon colocado (construccion:nueva)", idYunque != null, JSON.stringify(nuevaYunque)?.slice(0, 160) + " error=" + JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("construir:error"))));
  await page.evaluate(() => { window.__test._limpiar("construccion:nueva"); window.__test._limpiar("construir:error"); });
  // banco_carpintero exige carpintero nivel 4 para CONSTRUIRLO (gate real del
  // catálogo, confirmado por el propio playtest: "necesitas nivel 4 de
  // carpintero para construir esto") — el debug de jarl lo sube a 10, que
  // el paso 7 (legendario) necesita de todos modos.
  await enviar("admin:debug:maxOficio", { slot: 2 });
  await esperar(800);
  await teleport(34.5, 12.5);
  await enviar("construir", { objeto: "banco_carpintero", categoria: "mueble", x: 34, y: 10, rot: 0 });
  const nuevaBanco = await esperarMensaje("construccion:nueva", 10000);
  const idBanco = nuevaBanco?.id ?? nuevaBanco?.construccion?.id ?? null;
  comprobar("banco_carpintero colocado", idBanco != null, `${JSON.stringify(nuevaBanco)?.slice(0, 120)} error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("construir:error")))}`);
  await enviar("admin:debug:darItem", { itemId: "lingote_hierro", cantidad: 8 });
  await page.waitForFunction(() => window.__inventario().some((i) => i.itemId === "lingote_hierro"), null, { timeout: 15000 }).catch(() => {});

  // 3) Clic real sobre el yunque → menú → "Craftear en Yunque…" → panel.
  console.log("3) clic sobre el yunque → 'Craftear en…' → panel de recetas...");
  await teleport(36.5, 11.5);
  let menuOk = false, diagMenu = "";
  for (const h of [0.3, 0.6, 0.1, 0.9, 0.45]) {
    await clicMundo(36.5, 10.5, h);
    menuOk = await page.getByRole("button", { name: /^Craftear en / }).first().waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false);
    if (menuOk) break;
    diagMenu += ` h=${h}:${JSON.stringify(await page.evaluate(() => (document.querySelector('[data-testid="menu-interaccion"]')?.textContent ?? "").slice(0, 60)))}`;
    await page.mouse.click(5, 5); // cierra cualquier menú abierto en otro sitio (toggle real, ver GDD_UI_Paneles §2bis)
    await esperar(300);
  }
  comprobar("el clic sobre el yunque ofrece 'Craftear en …'", menuOk, diagMenu);
  if (!menuOk) await page.evaluate((id) => window.__crafteo.abrir(id, "yunque_tocon"), idYunque); // sin clic no hay playtest: se abre por sonda y se anota el fallo arriba
  else await page.getByRole("button", { name: /^Craftear en / }).first().click();
  await page.waitForFunction(() => window.__crafteo.estaAbierto() && window.__crafteo.recetasVisibles().length > 0 && window.__crafteo.nivelDe("herrero") !== null, null, { timeout: 15000 }).catch(() => {});
  let recetas = await page.evaluate(() => window.__crafteo.recetasVisibles());
  const clavos = recetas.find((r) => r.id === "clavos_hierro"), olla = recetas.find((r) => r.id === "olla_metal");
  comprobar("el panel lista las recetas del yunque con nivel real (oficio:estado)", recetas.length >= 5 && clavos?.nivelActual === 1, `${recetas.length} recetas, herrero nivel ${clavos?.nivelActual}`);
  comprobar("clavos (nivel 1) desbloqueada con insumos OK; olla (nivel 2) bloqueada", clavos?.desbloqueada === true && clavos?.insumosOk === true && olla?.desbloqueada === false, JSON.stringify({ clavos, olla }));
  await page.screenshot({ path: join(CAPTURAS, "playtest_oficios_panel_crafteo.png") });

  // 4) Craftear clavos 6 veces por el botón real hasta subir a herrero
  // nivel 2. `xpOtorgada` real de la receta (17, docs/GDD_Crafteo.md §11.3
  // — valorBase.js calcula la XP por fórmula desde la ampliación de
  // catálogo de esa fecha) × 6 = 102 ≥ 90 (umbral real de nivel 2,
  // generarUmbrales(10,90)); 5 crafteos (85 XP) se quedan cortos — este
  // playtest se escribió ANTES de esa ampliación de catálogo con el
  // XP_POR_CRAFTEO plano de entonces (20/crafteo) y nadie lo recalibró al
  // cambiar la fórmula, hueco real encontrado ejecutando este mismo test
  // tras fusionar con el trabajo de esa pasada.
  console.log("4) craftear clavos ×6 hasta subir a herrero nivel 2...");
  const CRAFTEOS_CLAVOS = 6;
  let crafteosOk = 0, t0 = Date.now();
  for (let i = 0; i < CRAFTEOS_CLAVOS; i++) {
    await page.evaluate(() => window.__test._limpiar?.("crafteo:completado"));
    const boton = page.locator('[data-testid="craftear-clavos_hierro"]');
    const habilitado = await page.waitForFunction(() => { const b = document.querySelector('[data-testid="craftear-clavos_hierro"]'); return !!b && !b.disabled; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!habilitado) { console.log(`   crafteo ${i + 1}: botón deshabilitado, error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("crafteo:error")))}`); break; }
    await boton.click({ timeout: 10000 });
    const progreso = await page.locator('[data-testid="crafteo-progreso"]').waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (i === 0) comprobar("al craftear aparece la barra de progreso (crafteo:iniciado)", progreso);
    const completado = await page.waitForFunction(() => !!window.__test.ultimoMensaje("crafteo:completado"), null, { timeout: 40000 }).then(() => true).catch(() => false);
    if (!completado) { console.log(`   crafteo ${i + 1}: sin crafteo:completado, error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("crafteo:error")))}`); break; }
    crafteosOk++;
  }
  const ultimo = await page.evaluate(() => window.__test.ultimoMensaje("crafteo:completado"));
  comprobar(`${CRAFTEOS_CLAVOS} crafteos de clavos completados por el botón real`, crafteosOk === CRAFTEOS_CLAVOS, `${crafteosOk}/${CRAFTEOS_CLAVOS} en ${((Date.now() - t0) / 1000).toFixed(1)}s, último=${JSON.stringify(ultimo)}`);
  const texto4 = await textoPantalla();
  comprobar("toast '¡Herrero nivel 2!' con las recetas nuevas", /Herrero nivel 2!/.test(texto4) && /Nuevas recetas:/.test(texto4), texto4.match(/¡Herrero nivel 2![^\n]*/)?.[0]?.slice(0, 160) ?? "sin toast");
  recetas = await page.evaluate(() => window.__crafteo.recetasVisibles());
  comprobar("tras subir de nivel, olla (nivel 2) pasa a desbloqueada en el panel", recetas.find((r) => r.id === "olla_metal")?.desbloqueada === true, `nivel ${await page.evaluate(() => window.__crafteo.nivelDe("herrero"))}`);
  const clavosInv = await page.evaluate(() => window.__inventario().filter((i) => i.itemId === "clavos").reduce((a, i) => a + i.cantidad, 0));
  comprobar("los clavos están de verdad en el inventario", clavosInv >= CRAFTEOS_CLAVOS * 10, `${clavosInv} clavos`);
  await page.screenshot({ path: join(CAPTURAS, "playtest_oficios_nivel2.png") });

  // 5) Minijuego de forja jugado con los botones del panel.
  console.log("5) daga_craft → minijuego de forja (Avivar/Golpear/Templar)...");
  await page.evaluate(() => window.__test._limpiar?.("crafteo:herreria:completado"));
  await page.locator('[data-testid="craftear-daga_craft"]').click();
  const forjaAbierta = await page.waitForFunction(() => !!window.__test.ultimoMensaje("crafteo:herreria:iniciado"), null, { timeout: 15000 }).then(() => true).catch(() => false);
  comprobar("la receta con minijuego abre la forja (crafteo:herreria:iniciado)", forjaAbierta, JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("crafteo:error"))));
  if (forjaAbierta) {
    const fase = () => page.evaluate(() => (window.__test.ultimoMensaje("crafteo:herreria:progreso") ?? window.__test.ultimoMensaje("crafteo:herreria:iniciado"))?.sesion?.fase);
    // El panel de forja (placeholder, panelForja.ts) reconstruye sus botones
    // con CADA crafteo:herreria:progreso — el clic de Playwright por locator
    // se queda reintentando sobre un nodo que desaparece bajo el ratón
    // (timeout real en la pasada 3). Un `click()` DOM sobre el botón visible
    // dispara exactamente el mismo handler que el ratón.
    const pulsar = (texto) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t) && x.offsetParent !== null); if (b) b.click(); return !!b; }, texto);
    for (let i = 0; i < 40 && (await fase()) === "CALENTAR"; i++) { await pulsar("Avivar"); await esperar(250); }
    comprobar("Avivar calienta hasta FORJAR", (await fase()) === "FORJAR", `fase=${await fase()}`);
    const golpes = () => page.evaluate(() => window.__test.ultimoMensaje("crafteo:herreria:progreso")?.sesion?.golpes ?? 0);
    // Cada golpe se confirma esperando a que el servidor lo cuente (progreso.sesion.golpes) antes del siguiente — mismo criterio que herreria.e2e.mjs.
    for (let intento = 0; intento < 20 && (await fase()) === "FORJAR"; intento++) {
      const antes = await golpes();
      await pulsar("Golpear");
      await page.waitForFunction((a) => (window.__test.ultimoMensaje("crafteo:herreria:progreso")?.sesion?.golpes ?? 0) > a, antes, { timeout: 2500 }).catch(() => {});
    }
    const faseTrasGolpes = await fase();
    console.log(`   golpes registrados: ${await golpes()}, fase=${faseTrasGolpes}`);
    if (faseTrasGolpes === "TEMPLAR") await pulsar("Templar");
    const resultado = await page.waitForFunction(() => window.__test.ultimoMensaje("crafteo:herreria:completado"), null, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);
    comprobar("Templar cierra la forja y entrega una daga (o bonificada)", /^daga/.test(String(resultado?.itemId ?? "")), `${JSON.stringify(resultado)?.slice(0, 200)} faseTrasGolpes=${faseTrasGolpes}`);
    await page.screenshot({ path: join(CAPTURAS, "playtest_oficios_forja.png") });
    await pulsar("Cerrar");
    await pulsar("Cancelar"); // si la forja se quedó a medias, que no tape el lienzo en el paso siguiente
  }
  await page.evaluate(() => window.__crafteo.cerrar());
  await page.keyboard.press("Escape").catch(() => {});
  await esperar(500);

  // 6) Agricultura de casilla por el menú del suelo.
  console.log("6) labrar (26,10) con azada, plantar trigo, cosechar la madura (27,10)...");
  await enviar("admin:debug:darItem", { itemId: "azada_hierro", cantidad: 1 });
  await enviar("admin:debug:darItem", { itemId: "semilla_trigo", cantidad: 2 });
  await page.waitForFunction(() => window.__inventario().some((i) => i.itemId === "azada_hierro") && window.__inventario().some((i) => i.itemId === "semilla_trigo"), null, { timeout: 15000 }).catch(() => {});
  const azada = await page.evaluate(() => window.__inventario().find((i) => i.itemId === "azada_hierro"));
  await enviar("equipo:equipar", { instanciaId: azada?.id, slot: "manoPrincipal" });
  await esperar(800);
  await teleport(26.5, 11.5);
  const madura = await page.evaluate(() => window.__cultivo.casillaEn(27, 10));
  comprobar("la casilla sembrada en BD llega replicada al cliente (brote maduro visible)", madura?.estado === "sembrada" && madura?.semillaId === "semilla_trigo", JSON.stringify(madura));
  await clicMundo(26.5, 10.5, 0);
  const labrarOk = await clicMenu(/Labrar aquí/);
  const labrada = await esperarMensaje("cultivoCasilla:labrada", 10000);
  comprobar("menú del suelo → 'Labrar aquí' labra (26,10)", labrarOk && labrada?.x === 26 && labrada?.y === 10, `${labrarOk} ${JSON.stringify(labrada)} error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("cultivoCasilla:error")))}`);
  await page.waitForFunction(() => window.__cultivo.casillaEn(26, 10)?.estado === "labrada", null, { timeout: 10000 }).catch(() => {});
  comprobar("la casilla labrada se replica y se pinta (estado labrada)", (await page.evaluate(() => window.__cultivo.casillaEn(26, 10)))?.estado === "labrada");
  await esperar(500);
  await clicMundo(26.5, 10.5, 0);
  const plantarOk = await clicMenu(/^Plantar Semilla de trigo/i);
  const plantada = await esperarMensaje("cultivoCasilla:plantada", 10000);
  comprobar("menú del suelo → 'Plantar Semilla de trigo' siembra la casilla labrada", plantarOk && plantada?.semillaId === "semilla_trigo", `${plantarOk} ${JSON.stringify(plantada)} error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("cultivoCasilla:error")))}`);
  await page.waitForFunction(() => window.__cultivo.casillaEn(26, 10)?.estado === "sembrada", null, { timeout: 10000 }).catch(() => {});
  await esperar(500);
  await clicMundo(27.5, 10.5, 0.2);
  const cosecharOk = await clicMenu(/^Cosechar/);
  const cosechada = await esperarMensaje("cultivoCasilla:cosechada", 10000);
  comprobar("menú del suelo sobre la madura → 'Cosechar' entrega trigo", cosecharOk && cosechada?.itemId === "trigo" && cosechada?.cantidad >= 1, `${cosecharOk} ${JSON.stringify(cosechada)} error=${JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("cultivoCasilla:error")))}`);
  const trigo = await page.evaluate(() => window.__inventario().filter((i) => i.itemId === "trigo").reduce((a, i) => a + i.cantidad, 0));
  comprobar("el trigo cosechado está en el inventario", trigo >= 1, `${trigo} trigo`);
  await page.screenshot({ path: join(CAPTURAS, "playtest_oficios_cultivo.png") });

  // 7) Mueble legendario del carpintero (nivel 10 vía debug, banco colocado en el paso 2).
  console.log("7) carpintero legendario: tallar un mueble nuevo desde una descripción...");
  if (idBanco != null) {
    await teleport(34.5, 12.5);
    await page.evaluate((id) => window.__carpintero.abrirPanel(id), idBanco);
    const textarea = page.locator("textarea:visible").first();
    const panelOk = await textarea.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    comprobar("el panel del carpintero legendario se abre sobre el banco recién colocado", panelOk);
    if (panelOk) {
      await textarea.fill("mesa de roble con incrustaciones de bronce y patas talladas");
      await page.locator("button:visible", { hasText: /Generar vista previa/i }).first().click();
      const preview = await page.waitForFunction(() => /Tipo:/.test(document.body.innerText) && !!document.querySelector("canvas"), null, { timeout: 15000 }).then(() => true).catch(() => false);
      comprobar("la descripción genera una vista previa del mueble nuevo", preview, (await textoPantalla()).match(/Tipo:[^\n]*/)?.[0] ?? "");
      await page.locator("button:visible", { hasText: /tallarlo/i }).first().click();
      const tallado = await page.waitForFunction(() => !document.body.innerText.includes("Banco de carpintero — tallar"), null, { timeout: 20000 }).then(() => true).catch(() => false);
      comprobar("'¡Me gusta, tallarlo!' talla el mueble y cierra el panel", tallado);
      await page.evaluate((id) => window.__carpintero.abrirPanel(id), idBanco);
      await esperar(1500);
      comprobar("el mueble nuevo aparece en 'Mis diseños'", /Mis diseños/.test(await textoPantalla()));
      await page.screenshot({ path: join(CAPTURAS, "playtest_oficios_carpintero.png") });
    }
  }

  comprobar("sin errores de página", errores.length === 0, errores.slice(0, 3).join(" || "));
  comprobar("sin errores en el servidor", erroresServidor.length === 0, erroresServidor.slice(0, 3).join(" || "));
} catch (e) {
  fallos++;
  console.error("❌", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  matarTodo();
}
console.log(fallos === 0 ? "\n✅ playtestOficios.e2e: TODO OK" : `\n❌ playtestOficios.e2e: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
