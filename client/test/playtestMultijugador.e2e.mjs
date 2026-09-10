// PLAYTEST multijugador real sobre el mapa PRINCIPAL (pedido streamer
// 2026-09-10: "haz pruebas, testea todo, juega con varios jugadores buscando
// fallos") — servidor Colyseus real + Vite + 4 navegadores Playwright a la
// vez, cada uno con su propio jugador, haciendo cosas DISTINTAS (andar,
// nadar/bucear, cazar fauna, abrir paneles, chatear, cruzar la puerta de la
// capital, recargar) mientras se recogen TODOS los errores de consola/página
// de cada cliente, cada petición de red fallida (url + motivo) y el log del
// servidor. No es un test de una mecánica: es una red de arrastre para
// excepciones y estados rotos.
//
// Este sandbox NO tiene GPU (WebGL por software, ver streamingLagPlaytest):
// con 4 navegadores a la vez cada frame de cliente puede tardar cientos de
// ms — por eso TODAS las comprobaciones de estado esperan con
// waitForFunction (hasta 15-20s) en vez de dormir un tiempo fijo; un fallo
// aquí es "nunca pasó", no "tardó más de lo que yo suponía".
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/playtestMultijugador.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const CARPETA_CAPTURAS = join(dirCliente, "test", "capturas");
mkdirSync(CARPETA_CAPTURAS, { recursive: true });
const BD_RUTA = join(tmpdir(), "colony_playtest_multi_e2e.sqlite");

const PUERTO_WS = 2613;
const PUERTO_WEB = 5213;
const NOMBRES = ["Tester1", "Tester2", "Tester3", "Tester4"];
const ESPERA_ESTADO_MS = 45000; // 20s se quedaba corto para DECODIFICAR patches en una página saturada (pasada 6)

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const logServidor = [];
function lanzar(cmd, args, cwd, extraEnv = {}, etiqueta = cmd) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const cb = (d) => { const t = String(d); if (etiqueta === "servidor") logServidor.push(t); if (process.env.PLAYTEST_DEBUG || etiqueta === "servidor") process.stdout.write(`[${etiqueta}] ${t}`); };
  p.stdout.on("data", cb);
  p.stderr.on("data", cb);
  return p;
}
async function esperarPuerto(url, intentos = 90) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await espera(500);
  }
  throw new Error(`No responde ${url}`);
}
let fallos = 0;
const hallazgos = [];
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) { fallos++; hallazgos.push(`${nombre}${detalle ? ` (${detalle})` : ""}`); }
}

async function main() {
  rmSync(BD_RUTA, { force: true });
  const rutaPrincipal = join(dirRaiz, "assets", "mapas", "principal");
  const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO_WS), RUTA_MAPA: rutaPrincipal, BD_RUTA, JARL_NOMBRES: NOMBRES.join(","),
  }, "servidor");
  const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
    VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/principal",
  }, "vite");
  const matarTodo = () => { for (const p of [servidor, vite]) { try { process.kill(-p.pid, "SIGKILL"); } catch {} try { p.kill("SIGKILL"); } catch {} } };
  process.on("exit", () => { matarTodo(); rmSync(BD_RUTA, { force: true }); });

  let browser;
  // Izados fuera del try: el finally los necesita para guardar los logs
  // aunque el e2e reviente a medias (bug real del propio test en la 2ª
  // pasada: declarados dentro del try, el finally daba ReferenceError
  // silencioso y el log de clientes nunca se escribía).
  const jugadores = [];
  const peticionesFallidas = [];
  try {
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);
    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

    async function abrirJugador(nombre, extraUrl = "") {
      const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
      const page = await context.newPage();
      const errores = [];
      const navegaciones = [];
      page.on("console", (msg) => {
        const t = msg.text();
        if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|favicon|ERR_CONNECTION_RESET/i.test(t)) errores.push(t);
      });
      // Con stack (primeras líneas): un "reading 'get'" pelado no dice DÓNDE — pasada 5.
      page.on("pageerror", (err) => errores.push("PAGEERROR " + String(err?.stack || err).split("\n").slice(0, 5).join(" | ")));
      page.on("requestfailed", (req) => peticionesFallidas.push(`${nombre} ${req.failure()?.errorText} ${req.url().replace(/^http:\/\/localhost:\d+/, "")}`));
      page.on("framenavigated", (f) => { if (f === page.mainFrame()) navegaciones.push(f.url().replace(/^http:\/\/localhost:\d+/, "")); });
      if (process.env.PLAYTEST_DEBUG) page.on("console", (m) => console.log(`   [${nombre}:${m.type()}] ${m.text().slice(0, 200)}`));
      const j = { nombre, page, context, errores, navegaciones, arranco: false };
      // "commit" y no "load": con 3 páginas ya renderizando por software, el
      // evento load de la 4ª (bundle + primeros .glb) superó los 30s por
      // defecto en la 2ª pasada — esperarJuego() ya espera lo que importa.
      await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${nombre}${extraUrl}`, { waitUntil: "commit", timeout: 120000 });
      // Un cliente que no llega a arrancar es un HALLAZGO, no motivo para
      // abortar la pasada entera: se registra (con sus errores de página) y
      // el resto de pasos sigue con los que sí arrancaron.
      const arranco = await esperarJuego(j).then(() => true).catch(() => false);
      j.arranco = arranco;
      comprobar(`${nombre} arranca el juego (mundo materializado)`, arranco, errores.slice(0, 3).join(" || ") || "sin errores de página, solo timeout");
      jugadores.push(j);
      return j;
    }
    /** El cliente está dentro del mundo (tras carga inicial o tras navegar a otra sala). */
    async function esperarJuego(j, timeout = 150000) {
      await j.page.waitForFunction(() => window.__colonyDebug && window.__test && window.__streaming && window.__streaming().materializados >= 1, null, { timeout });
    }
    async function asentar(page, timeoutMs = 45000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const s = await page.evaluate(() => window.__streaming());
        if (s.enVuelo === 0 && s.materializando === 0) return true;
        await espera(250);
      }
      return false;
    }
    async function teleport(j, x, y) {
      await esperarJuego(j);
      await j.page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), { x, y });
      // El servidor puede AJUSTAR el destino a la casilla pisable más cercana
      // (2026-09-10, teleport a casilla sólida): se espera a la posición que
      // confirma admin:debug:ok, no a la pedida.
      await j.page.waitForFunction(({ x, y }) => {
        const ok = window.__test.ultimoMensaje("admin:debug:ok");
        if (!ok || ok.accion !== "teleport" || Math.hypot(ok.x - x, ok.y - y) > 12) return false;
        return Math.abs(window.__colonyDebug.x - ok.x) < 1 && Math.abs(window.__colonyDebug.y - ok.y) < 1;
      }, { x, y }, { timeout: 45000 });
      await asentar(j.page);
    }
    const pos = (page) => page.evaluate(() => ({ x: window.__colonyDebug.x, y: window.__colonyDebug.y, estado: window.__colonyDebug.estado, nivel: window.__colonyDebug.nivel }));
    /** Mantiene la tecla hasta haberse desplazado `minDist` casillas (o agotar el tiempo). Devuelve la distancia recorrida. */
    async function andarHasta(j, tecla, minDist, timeoutMs = 15000) {
      const inicio = await pos(j.page);
      await j.page.keyboard.down(tecla);
      // waitForFunction sondea DENTRO de la página (sin un viaje CDP por
      // muestra): en la pasada 8, con un evaluate tardando segundos bajo
      // carga, una petición de 0.5 casillas soltaba la tecla 10 casillas tarde.
      await j.page.waitForFunction(({ x0, y0, min }) => Math.hypot(window.__colonyDebug.x - x0, window.__colonyDebug.y - y0) >= min, { x0: inicio.x, y0: inicio.y, min: minDist }, { timeout: timeoutMs, polling: 50 }).catch(() => {});
      await j.page.keyboard.up(tecla);
      const p = await pos(j.page);
      return Math.hypot(p.x - inicio.x, p.y - inicio.y);
    }
    /** Mantiene la tecla hasta que el estado del jugador sea `estado` (o agote el tiempo). */
    async function andarHastaEstado(j, tecla, estado, timeoutMs = 25000) {
      await j.page.keyboard.down(tecla);
      const ok = await j.page.waitForFunction((e) => window.__colonyDebug.estado === e, estado, { timeout: timeoutMs, polling: 50 }).then(() => true).catch(() => false);
      await j.page.keyboard.up(tecla);
      return ok;
    }
    async function esperarEstado(j, estado, timeout = ESPERA_ESTADO_MS) {
      return j.page.waitForFunction((e) => window.__colonyDebug.estado === e, estado, { timeout }).then(() => true).catch(() => false);
    }

    console.log("1) entran 4 jugadores en el Hub del mapa principal...");
    for (const n of NOMBRES) await abrirJugador(n);
    for (const j of jugadores) {
      const ok = await j.page.waitForFunction((n) => n.every((x) => window.__jugadores().some((p) => p.nombre === x)), NOMBRES, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
      // Con posición: un jugador ausente de la vista de otro puede ser interés por distancia (StateView) — pasada 6.
      const vistos = await j.page.evaluate(() => window.__jugadores().map((p) => `${p.nombre}@${p.x.toFixed(0)},${p.y.toFixed(0)}`));
      comprobar(`${j.nombre} ve a los 4 jugadores en el Hub`, ok, vistos.join(" "));
    }
    const [t1, t2, t3] = jugadores;
    // En este sandbox la 4ª página de WebGL por software a veces no llega a
    // materializar el mundo (pasada 6): si no arrancó, sus papeles (recibir
    // el chat, el monkey de teclas) los hace Tester1 — la pasada sigue
    // valiendo como playtest de 3 jugadores reales.
    const t4 = jugadores[3].arranco ? jugadores[3] : t1;

    console.log("2) todos andan a la vez en direcciones distintas (WASD real)...");
    // Cada uno en su propio sitio ANTES de andar: 4 jugadores apilados en el
    // mismo spawn se empujan entre sí (colisiones.ts::separarPJs) y el
    // recorrido medido no dice nada del movimiento real (visto en la 1ª
    // pasada: 0.21/0.57 casillas "andadas" por el empuje ajeno). Campo
    // abierto al sur de la capital, lejos de la muralla del spawn.
    // Casillas comprobadas contra el cargador de colisión REAL del servidor
    // (5x5 libre alrededor, cargarMapaColision sobre assets/mapas/principal):
    // en la pasada 7, 3 de los 4 sitios anteriores eran casillas SÓLIDAS
    // (árbol/roca) y el teleport dejaba al jugador atrapado dentro — 0.00
    // casillas andadas por colisión, no por el input.
    const sitios = [[1482.5, 2100.5], [1492.5, 2100.5], [1480.5, 2102.5], [1484.5, 2102.5]];
    const activos = jugadores.filter((j) => j.arranco);
    await Promise.all(activos.map((j) => teleport(j, ...sitios[jugadores.indexOf(j)]).catch((e) => comprobar(`teleport de ${j.nombre} al sitio de andar`, false, String(e).slice(0, 100)))));
    const antes = await Promise.all(jugadores.map((j) => (j.arranco ? pos(j.page) : { x: NaN, y: NaN })));
    const teclasAndar = ["w", "s", "a", "d"];
    const recorridos = await Promise.all(jugadores.map((j, i) => (j.arranco ? andarHasta(j, teclasAndar[i], 1) : Promise.resolve(NaN))));
    jugadores.forEach((j, i) => { if (j.arranco) comprobar(`${j.nombre} se ha movido andando`, recorridos[i] >= 1, `${recorridos[i].toFixed(2)} casillas`); });
    const p2 = await pos(t2.page);
    const veT2 = await t1.page.waitForFunction((y) => { const p = window.__jugadores().find((q) => q.nombre === "Tester2"); return p && Math.abs(p.y - y) < 1.5; }, p2.y, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
    comprobar("Tester1 ve la posición actualizada de Tester2 (replicación)", veT2, `Tester2 y=${p2.y.toFixed(1)} vs antes ${antes[1].y.toFixed(1)}`);

    console.log("3) chat global: Tester3 habla, Tester4 lo recibe...");
    await t3.page.evaluate(() => window.__test.enviar("chat:mensaje", { texto: "hola desde el playtest", canal: "global" }));
    const chatOk = await t4.page.waitForFunction(() => window.__test.ultimoMensaje("chat:mensaje")?.texto === "hola desde el playtest", null, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
    const chatT4 = await t4.page.evaluate(() => window.__test.ultimoMensaje("chat:mensaje"));
    comprobar("Tester4 recibe el chat global de Tester3", chatOk && chatT4?.nombre === "Tester3", JSON.stringify(chatT4));

    console.log("4) Tester2 va al río (1310,2010), entra al agua, nada y bucea (Q) / sube (E)...");
    await teleport(t2, 1310.5, 2010.5);
    const nada = await andarHastaEstado(t2, "a", "nadando");
    let e2 = await pos(t2.page);
    comprobar("Tester2 ha entrado en el agua (estado nadando)", nada, `estado=${e2.estado} en (${e2.x.toFixed(1)},${e2.y.toFixed(1)})`);
    if (nada) {
      await t2.page.keyboard.press("q");
      comprobar("Q bucea (estado buceando)", await esperarEstado(t2, "buceando"), `estado=${(await pos(t2.page)).estado}`);
      await t2.page.keyboard.press("e");
      comprobar("E vuelve a la superficie (nadando)", await esperarEstado(t2, "nadando"), `estado=${(await pos(t2.page)).estado}`);
      const salio = await andarHastaEstado(t2, "d", "tierra");
      comprobar("Tester2 sale del agua a tierra", salio, `estado=${(await pos(t2.page)).estado}`);
    }

    console.log("5) Tester3 caza un animal REAL con clic sobre él (menú 'Cazar') y persecución automática...");
    await teleport(t3, 1310.5, 2040.5);
    await espera(2000);
    const fauna = await t3.page.evaluate(() => window.__fauna());
    comprobar("hay fauna viva replicada cerca del río", fauna.length > 0, `${fauna.length} individuos`);
    // Presa de TIERRA y no peligrosa (un pez llevaría al cazador al agua, un
    // lobo/jabalí es combate de arena, no caza) — si no hay ninguna de la
    // lista, se prueba con la primera que haya y se acepta el rechazo del
    // servidor como respuesta válida.
    // Orden de preferencia por TAMAÑO del rig: un ratón mide ~0.2 unidades y
    // un clic a un píxel puede no tocar ninguna malla (pasada 7: "sin menú").
    // Comprobado con una página sola (caza_debug, 2026-09-10): el clic sobre un
    // águila pescadora abre "Cazar aguila pescadora" — pero una ratona (~0.2
    // unidades) no tiene malla que tocar a un píxel. Se excluyen diminutos,
    // insectos y peces (la persecución entraría en el agua); cualquier otra
    // especie vale, con preferencia por las grandes.
    const PRESAS_TIERRA = ["cierva", "ciervo", "corzo", "corza", "gacela", "liebre", "liebre_de_bosque", "conejo", "marmota", "perdiz", "codorniz", "cervatillo", "corcino", "aguila_pescadora", "garza", "cigüena", "paloma_torcaz", "cuervo", "faisan"];
    const DIMINUTA = /raton|ardilla|avispa|abeja|mariposa|libelula|escarabajo|hormiga|grillo|saltamontes|mosquito|lombriz|caracol|rana|sapo|lagart|carpa|trucha|pez|bacalao|sardina|salmon|anguila|lucio|barbo|cangrejo|medusa|pulpo|calamar|almeja|mejillon|ostra|erizo|estrella|anemona|pepino|tiburon|orca|ballena|delfin|foca|morsa|lobo|oso|jabal/;
    const presa = PRESAS_TIERRA.map((e) => fauna.find((f) => f.especieId === e)).find(Boolean) || fauna.find((f) => !DIMINUTA.test(f.especieId)) || fauna[0];
    if (presa) {
      console.log(`   presa: ${presa.especieId} (${presa.id}) en (${presa.x.toFixed(1)},${presa.y.toFixed(1)})`);
      // A 7 casillas: fuera de radioHuida (4) para que no salga corriendo antes del clic
      await teleport(t3, presa.x + 7, presa.y);
      const viva = await t3.page.evaluate((id) => window.__fauna().find((f) => f.id === id) || null, presa.id);
      comprobar("la presa sigue replicada tras acercarse", !!viva, JSON.stringify(viva));
      if (viva) {
        // Varias alturas del rig (la posición en vivo del animal se relee en
        // cada intento: se mueve) hasta que el clic toque una malla y salga el menú.
        const boton = t3.page.getByRole("button", { name: /^Cazar / });
        let menuOk = false;
        for (const altura of [0.25, 0.5, 0.1, 0.8]) {
          const ahora = await t3.page.evaluate((id) => window.__fauna().find((f) => f.id === id) || null, presa.id);
          if (!ahora) break;
          const px = await t3.page.evaluate(({ x, y, h }) => window.__proyectarMundo(x, y, h), { x: ahora.x, y: ahora.y, h: altura });
          await t3.page.mouse.click(px.x, px.y);
          menuOk = await boton.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
          if (menuOk) break;
          await t3.page.keyboard.press("Escape"); // por si el clic abrió otro menú ("Sentarse en el suelo")
        }
        comprobar("clic sobre el animal abre el menú con 'Cazar'", menuOk, menuOk ? await boton.textContent() : "sin menú");
        if (menuOk) {
          await boton.click();
          const arranque = await t3.page.waitForFunction(() => window.__test.ultimoMensaje("caza:iniciada") || window.__test.ultimoMensaje("combate:error"), null, { timeout: ESPERA_ESTADO_MS })
            .then(() => t3.page.evaluate(() => ({ iniciada: window.__test.ultimoMensaje("caza:iniciada"), error: window.__test.ultimoMensaje("combate:error") })))
            .catch(() => null);
          comprobar("'Cazar' arranca la caza (caza:iniciada) o el servidor explica por qué no", !!arranque, JSON.stringify(arranque));
          if (arranque?.iniciada) {
            const auto = await t3.page.evaluate(() => window.__cazaAuto());
            comprobar("la persecución automática queda activa en el cliente", auto === presa.id, String(auto));
            const t0 = Date.now();
            const atrapado = await t3.page.waitForFunction(() => !!window.__test.ultimoMensaje("caza:atrapado"), null, { timeout: 90000 }).then(() => true).catch(() => false);
            const p3 = await pos(t3.page);
            comprobar("el jugador alcanza a la presa solo (caza:atrapado)", atrapado, `${((Date.now() - t0) / 1000).toFixed(1)}s, jugador en (${p3.x.toFixed(1)},${p3.y.toFixed(1)})`);
            const autoTras = await t3.page.evaluate(() => window.__cazaAuto());
            comprobar("la persecución automática se apaga sola al atrapar", autoTras === null, String(autoTras));
            await t3.page.screenshot({ path: join(CARPETA_CAPTURAS, "playtest_multi_caza.png") });
          }
        }
      }
    }

    console.log("6) Tester4: paseo de teclas (monkey test) — cada tecla de acción una vez, paneles abrir/cerrar...");
    const teclasAccion = ["i", "m", "Tab", "Escape", "b", "Escape", "b", "r", "l", "k", "o", "g", "t", "u", "n", "x", "j", "p", "y", "v", "h", "Escape", "F9", "i", "Escape", "m", "Escape", "Tab", "Escape"];
    const erroresAntesMonkey = t4.errores.length;
    for (const k of teclasAccion) {
      await t4.page.keyboard.press(k);
      await espera(300);
    }
    await espera(1500);
    comprobar("monkey test de teclas en Tester4 sin errores de página", t4.errores.length === erroresAntesMonkey, t4.errores.slice(erroresAntesMonkey, erroresAntesMonkey + 4).join(" | "));
    await t4.page.screenshot({ path: join(CARPETA_CAPTURAS, "playtest_multi_tester4_paneles.png") });

    console.log("7) Tester1 cruza la puerta de la capital (portal exterior 1486,2179 → región)...");
    await teleport(t1, 1486.5, 2180.5);
    const urlAntes = t1.page.url();
    await t1.page.keyboard.press("f");
    let navego = false;
    try { await t1.page.waitForURL((u) => u.toString() !== urlAntes, { timeout: 90000, waitUntil: "commit" }); navego = true; } catch {}
    comprobar("F junto a la puerta navega a la región de la capital", navego, t1.page.url().replace(/^http:\/\/localhost:\d+/, ""));
    if (navego) {
      await esperarJuego(t1, 120000).catch((e) => comprobar("la región de la capital termina de cargar", false, String(e)));
      await asentar(t1.page, 90000);
      const npcsOk = await t1.page.waitForFunction(() => window.__npcs && window.__npcs().total > 0, null, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
      const npcs = await t1.page.evaluate(() => window.__npcs ? window.__npcs().total : -1);
      comprobar("dentro de la capital hay NPCs replicados", npcsOk, `${npcs} NPCs`);
      await t1.page.screenshot({ path: join(CARPETA_CAPTURAS, "playtest_multi_capital.png") });
      const d = await andarHasta(t1, "w", 0.5, 15000);
      comprobar("Tester1 puede andar dentro de la capital", d >= 0.5, `${d.toFixed(2)} casillas`);
      // volver a la puerta (el spawn de la región es el portal de salida) y salir
      await andarHasta(t1, "s", 0.5, 15000);
      const urlDentro = t1.page.url();
      await t1.page.keyboard.press("f");
      let salio = false;
      try { await t1.page.waitForURL((u) => u.toString() !== urlDentro, { timeout: 90000, waitUntil: "commit" }); salio = true; } catch {}
      comprobar("F en el spawn de la capital devuelve al exterior", salio, t1.page.url().replace(/^http:\/\/localhost:\d+/, ""));
      if (salio) await esperarJuego(t1, 120000).catch((e) => comprobar("el exterior vuelve a cargar tras salir de la capital", false, String(e)));
      else {
        // Sin salida real, los pasos 8-10 (todos en el Hub) no tendrían sentido para Tester1: vuelta al Hub por URL.
        await t1.page.goto(`http://localhost:${PUERTO_WEB}/?nombre=Tester1`, { waitUntil: "commit", timeout: 120000 });
        await esperarJuego(t1, 150000).catch(() => {});
      }
    }

    console.log("8) Tester2 recarga (F5) lejos del spawn — la posición debe persistir...");
    await esperarJuego(t2);
    const antesRecarga = await pos(t2.page);
    await t2.page.reload({ waitUntil: "commit", timeout: 120000 });
    await esperarJuego(t2);
    const trasRecarga = await pos(t2.page);
    comprobar("posición persistida tras F5", Math.hypot(antesRecarga.x - trasRecarga.x, antesRecarga.y - trasRecarga.y) < 2, `${antesRecarga.x.toFixed(1)},${antesRecarga.y.toFixed(1)} → ${trasRecarga.x.toFixed(1)},${trasRecarga.y.toFixed(1)}`);

    console.log("9) todos se teletransportan a la vez a la misma zona (estrés de sincronía) y se ven entre sí...");
    // Casillas comprobadas libres (5x5) con el cargador real; las anteriores (1500+i,2100+i) eran agua/sólido.
    const sitiosReunion = [[1486.5, 2100.5], [1494.5, 2100.5], [1482.5, 2102.5], [1484.5, 2100.5]];
    await Promise.all(jugadores.map((j, i) => teleport(j, ...sitiosReunion[i]).catch((e) => comprobar(`teleport masivo de ${j.nombre}`, false, String(e).slice(0, 120)))));
    for (const j of jugadores) {
      const otros = NOMBRES.filter((n) => n !== j.nombre);
      const ok = await j.page.waitForFunction((n) => n.every((x) => window.__jugadores().some((p) => p.nombre === x)), otros, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
      const vistos = await j.page.evaluate(() => window.__jugadores().map((p) => `${p.nombre}@${p.x.toFixed(0)},${p.y.toFixed(0)}`));
      comprobar(`${j.nombre} ve a los otros 3 tras el teleport masivo`, ok, `${vistos.join(" ")} | url=${j.page.url().replace(/^http:\/\/localhost:\d+/, "")}`);
    }
    await t1.page.screenshot({ path: join(CARPETA_CAPTURAS, "playtest_multi_reunion.png") });

    console.log("10) Tester3 y Tester4 se van (cierran) — los que quedan siguen viendo el estado correcto...");
    await jugadores[2].context.close();
    await jugadores[3].context.close();
    const quedan = await t1.page.waitForFunction(() => window.__jugadores().length === 2, null, { timeout: ESPERA_ESTADO_MS }).then(() => true).catch(() => false);
    const vistosT1 = await t1.page.evaluate(() => window.__jugadores().map((p) => p.nombre));
    comprobar("tras irse T3/T4, Tester1 solo ve a Tester1 y Tester2", quedan && vistosT1.includes("Tester2"), vistosT1.join(","));

    console.log("\n=== ERRORES DE CLIENTE ===");
    for (const j of jugadores) {
      comprobar(`sin errores de consola/página en ${j.nombre}`, j.errores.length === 0, j.errores.slice(0, 6).join(" | "));
      console.log(`   navegaciones de ${j.nombre}: ${j.navegaciones.join(" → ")}`);
    }
    console.log("\n=== PETICIONES DE RED FALLIDAS (no 404) ===");
    const fallidasReales = peticionesFallidas.filter((p) => !/net::ERR_ABORTED/.test(p));
    for (const p of fallidasReales.slice(0, 20)) console.log("   " + p);
    comprobar("ninguna petición de red falló (aparte de 404/abortadas)", fallidasReales.length === 0, `${fallidasReales.length} fallidas`);
    console.log("\n=== ERRORES DE SERVIDOR ===");
    const erroresServidor = logServidor.join("").split("\n").filter((l) => /error|Error|TypeError|unhandled|Unhandled|EADDR|exception/.test(l) && !/ExperimentalWarning|trace-warnings/.test(l));
    comprobar("sin errores en el log del servidor", erroresServidor.length === 0, erroresServidor.slice(0, 8).join(" | "));
    writeFileSync(join(CARPETA_CAPTURAS, "playtest_multi_servidor.log"), logServidor.join(""));
    if (hallazgos.length) console.log("\nHALLAZGOS:\n - " + hallazgos.join("\n - "));
  } finally {
    // Aunque el e2e reviente a medias (visto en la 1ª pasada: un timeout en
    // el paso 8 se llevó por delante el resumen entero), el log del servidor
    // y los errores de cada cliente se guardan igual.
    try {
      writeFileSync(join(CARPETA_CAPTURAS, "playtest_multi_servidor.log"), logServidor.join(""));
      writeFileSync(join(CARPETA_CAPTURAS, "playtest_multi_clientes.log"), jugadores.map((j) => `== ${j.nombre} ==\n${j.errores.join("\n")}\nnavegaciones: ${j.navegaciones.join(" -> ")}\n`).join("\n") + "\n== red fallida ==\n" + peticionesFallidas.join("\n"));
    } catch {}
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    rmSync(BD_RUTA, { force: true });
  }
}

main()
  .then(() => { console.log(fallos === 0 ? "\n✅ playtestMultijugador.e2e: TODO OK" : `\n❌ playtestMultijugador.e2e: ${fallos} fallo(s)`); process.exit(fallos === 0 ? 0 : 1); })
  .catch((err) => { console.error("ERROR en el e2e:", err); process.exit(1); });
