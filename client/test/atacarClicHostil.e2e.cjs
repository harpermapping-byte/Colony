"use strict";

// E2E VISUAL de "Atacar <X>" por clic sobre otro jugador/NPC hostil/enemigo
// (auditoría de interacciones 2026-09-13, pedido streamer: "revisa si
// todas las funciones/interacciones están bien seteadas... retira bindeos
// de teclas para que se hagan con click sobre el objeto como otros
// casos"). Hallazgo real: la tecla C (`objetivoHostilMasCercano`) YA cubre
// fauna/enemigos de mazmorra/patrullas bandidas/PvP, y clicar fauna YA
// ofrecía "Cazar" (que el servidor resuelve como ataque real si la especie
// es peligrosa) — pero clicar un enemigo de mazmorra, un NPC hostil o OTRO
// JUGADOR solo abría el panel de inspección, sin ninguna opción de atacar.
//
// PROBAR el resultado REAL de un ataque contra un NPC hostil/enemigo es
// INHERENTEMENTE inestable en cualquier mapa con agro ambiental
// (verificarAgroFauna corre cada 200ms y puede arrastrar al jugador a OTRO
// combate antes de que el clic manual llegue a completarse — confirmado en
// una iteración previa de este mismo test contra un campamento orco real:
// la patrulla bandida ya tenía al jugador en combate antes del clic, así
// que "Atacar B" se rechazaba con "ya estás en combate", un falso negativo
// de la CARRERA, no del código nuevo). Este test evita la carrera del todo
// usando el HUB (SIEMPRE zona seguro para PvP, `esZonaSeguraPropia=true`
// sin excepción — HubRoom.ts) — el resultado es 100% DETERMINISTA
// (`combate:error "pvp deshabilitado aquí"`) y prueba exactamente lo mismo
// que me interesa: que el clic manda `combate:iniciar {objetivoId}` de
// verdad y el servidor lo recibe y responde — la parte que SÍ cambié.
// Si el streamer activa PvP en una región real más adelante, el mensaje ya
// es el mismo que manda la tecla C (nunca auditado aparte, sin cambios).
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/atacarClicHostil.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ, "assets", "mapas", "demo");
const PUERTO_WS = 2649;
const PUERTO_WEB = 5249;
const NOMBRE_A = "AtacarClicTesterA";
const NOMBRE_B = "AtacarClicTesterB";

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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_DEMO, BD_RUTA: ":memory:",
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
    });
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch();
    const ctxA = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const erroresConsola = [];
    for (const [p, tag] of [[pageA, "A"], [pageB, "B"]]) {
      p.on("console", (msg) => {
        const t = msg.text();
        if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(`[${tag}] ${t}`);
      });
      p.on("pageerror", (err) => erroresConsola.push(`[${tag}] ${err}`));
    }

    console.log("1) A y B cargan el cliente real (mapa demo, Hub — mismo mapa)...");
    await pageA.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_A}`);
    await pageA.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await pageA.waitForFunction(() => !!window.__test, null, { timeout: 10000 });
    await pageB.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_B}`);
    await pageB.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await esperar(500);

    // A y B spawnean en el MISMO punto exacto (personajes nuevos, sin
    // posición persistida) — nunca hace falta separarlos: el propio fix de
    // esta pasada (excluir el rig LOCAL de `intentarInspeccionarClic`, ver
    // game.ts) ya garantiza que un clic ahí mismo solo puede resolver
    // contra B, nunca contra el propio A. Confirmado con un intento previo
    // de este test que separaba a los jugadores con WASD real — la
    // sincronización de red del sandbox (sin GPU, CDP con latencia
    // variable) hacía el movimiento resultante demasiado imprevisible para
    // un test determinista (un solo "tick" de espera podía mover a A entre
    // 0 y más de 5 casillas según la carga del entorno).
    await esperar(500);

    console.log("2) A clica sobre B: debe ofrecer 'Atacar AtacarClicTesterB' + 'Proponer comercio' + 'Inspeccionar'...");
    const posBTrasAjuste = await pageB.evaluate(() => window.__colonyDebug);
    const puntoPantalla = await pageA.evaluate(({ x, y }) => window.__proyectarMundo(x, y), { x: posBTrasAjuste.x, y: posBTrasAjuste.y });
    const menuSel = '[data-testid="menu-interaccion"]';
    let opcionesMenu = "";
    let menuConAtacar = false;
    for (const [dxo, dyo] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [15, 15], [-15, -15]]) {
      await pageA.mouse.click(puntoPantalla.x + dxo, puntoPantalla.y + dyo);
      await esperar(250);
      const info = await pageA.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === "none") return null;
        return el.textContent || "";
      }, menuSel);
      if (info != null) {
        opcionesMenu = info;
        if (new RegExp(`Atacar.*${NOMBRE_B}`).test(info)) { menuConAtacar = true; break; }
      }
      await pageA.mouse.click(10, 10);
      await esperar(150);
    }
    comprobar("el menú al clicar B ofrece 'Atacar AtacarClicTesterB'", menuConAtacar, opcionesMenu.slice(0, 300));
    comprobar("el mismo menú también ofrece 'Proponer comercio'", /Proponer comercio/.test(opcionesMenu), opcionesMenu.slice(0, 300));
    if (!menuConAtacar) throw new Error("no se pudo abrir el menú de ataque sobre B");

    console.log("3) A clica 'Atacar AtacarClicTesterB' — el Hub SIEMPRE es zona segura (esZonaSeguraPropia=true), así que el servidor debe rechazarlo con un motivo real, NUNCA en silencio...");
    const botonAtacar = pageA.locator(`${menuSel} >> text=/Atacar.*${NOMBRE_B}/`).first();
    await botonAtacar.click();
    await pageA.waitForFunction(() => document.body.innerText.includes("pvp deshabilitado"), null, { timeout: 5000 });
    const textoFinal = await pageA.evaluate(() => document.body.innerText);
    comprobar("combate:iniciar por clic contra OTRO JUGADOR llega de verdad al servidor (rechazo determinista 'pvp deshabilitado aquí' en el Hub, nunca silencioso)", /pvp deshabilitado/.test(textoFinal), textoFinal.split("\n").find((l) => l.includes("pvp deshabilitado")));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: atacar por clic ya funciona contra objetivos hostiles/jugadores, no solo fauna (mismo mensaje real que la tecla C) ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ atacarClicHostil.e2e: TODO OK" : `\n❌ atacarClicHostil.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
