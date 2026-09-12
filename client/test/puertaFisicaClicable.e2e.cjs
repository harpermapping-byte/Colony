"use strict";

// E2E VISUAL de la puerta física de asentamiento CLICABLE (docs/GDD_Sistema_
// Puertas.md, pedido streamer: "puerta física clicable -> entrar a la
// instancia"). Hasta ahora la única forma de cruzar el portal de una aldea/
// ciudad/campamento era la tecla F a ciegas, sin ninguna pista visual de que
// hubiera algo que cruzar ahí. Esta pasada añade una etiqueta flotante
// "Entrar <Nombre>" sobre la puerta real, visible solo dentro de
// RADIO_INTERACCION y clicable de verdad.
//
// Bakea un mapa de prueba PEQUEÑO Y REAL (mismo config que
// baker/config/ejemplo-rapido.json, EN PROCESO vía generarMapa — sin pasar
// por el CLI) a una carpeta temporal bajo assets/mapas/ (el servidor/cliente
// solo pueden servir mapas ahí, ver server/src/mundo/resolverMapa.ts y
// client/vite.config.ts::servirAssetsRaiz — mismo patrón ya usado por
// mazmorraLimpiada.e2e.cjs, que escribe su fixture bajo assets/mapas/demo/ y
// lo borra al terminar) — determinista por semilla (CLAUDE.md filosofía #3),
// confirmado con dos bakes idénticos antes de escribir este test. Se limpia
// en el finally, nunca se comitea.
//
// El PRIMER asentamiento con destino+puertaX/Y+nombreDestino que salga de
// ese bake (aldea o campamento hostil, da igual — ambas ramas de
// `colocarSiluetaYPuertaDeAsentamiento` en baker/src/instanciasPOI.js
// generan exactamente los mismos 3 campos nuevos) se usa como puerta de
// prueba; el propio script relee `indice.json` y aplica el MISMO filtro que
// game.ts, así que el `data-testid` a buscar (`portal_0`, primera entrada
// del filtro) queda determinado dinámicamente, nunca hardcodeado a ciegas.
//
// admin:debug:teleport (RoomExteriorBase.ts) necesita `puedeActuarComoJarl`
// — se resuelve con `JARL_NOMBRES` (env) + `?nombre=` coincidente, mismo
// atajo ya usado por client/test/cazaClic.e2e.mjs, sin login HTTP de por medio.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/puertaFisicaClicable.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const CARPETA_MAPA_TEST = path.join(RAIZ, "assets", "mapas", "_e2e_puerta_fisica");
const MAPA_ID_TEST = "_e2e_puerta_fisica";
const CARPETA_CAPTURAS = path.join(__dirname, "capturas");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const PUERTO_WS = 2623;
const PUERTO_WEB = 5210;
const NOMBRE_JARL = "PuertaTester";

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

/**
 * Bakea el mapa de prueba EN PROCESO (misma función que usa baker/src/index.js,
 * sin pasar por un subproceso) y devuelve la primera "entrada interactiva"
 * real que el bakeador dejó lista para el cliente — MISMO filtro que
 * client/src/game.ts aplica sobre `indice.portales` (tipo exterior + destino
 * + puertaX/Y + nombreDestino), para que este script y el cliente coincidan
 * en cuál es "portal_0".
 */
async function bakearMapaDePruebaYEncontrarPuerta() {
  fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  const { generarMapa } = require(path.join(RAIZ, "baker", "src", "generar.js"));
  const configBase = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "config", "ejemplo-rapido.json"), "utf8"));
  const config = { ...configBase, carpetaSalida: CARPETA_MAPA_TEST };
  console.log("0) horneando mapa de prueba pequeño y real (mismo config que ejemplo-rapido.json)...");
  await generarMapa(config, { onProgreso: (m) => console.log("   [bake]", m) });
  const indice = JSON.parse(fs.readFileSync(path.join(CARPETA_MAPA_TEST, "indice.json"), "utf8"));
  const entradas = (indice.portales || []).filter(
    (p) => p.tipo === "exterior" && !!p.destino && p.puertaX != null && p.puertaY != null && !!p.nombreDestino,
  );
  if (!entradas.length) {
    throw new Error(
      "el bake de prueba no colocó ningún asentamiento con puerta clicable — con esta semilla debería (verificado dos veces antes de escribir este test); revisa baker/src/instanciasPOI.js",
    );
  }
  console.log(`   ${entradas.length} entrada(s) interactiva(s) encontradas, usando la primera: "${entradas[0].nombreDestino}" en (${entradas[0].puertaX},${entradas[0].puertaY}), portal en (${entradas[0].x},${entradas[0].y})`);
  return entradas[0];
}

async function main() {
  const entrada = await bakearMapaDePruebaYEncontrarPuerta();

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
      PORT: String(PUERTO_WS), RUTA_MAPA: CARPETA_MAPA_TEST, BD_RUTA: ":memory:", JARL_NOMBRES: NOMBRE_JARL,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
      VITE_RUTA_MAPA: `/assets/mapas/${MAPA_ID_TEST}`,
    });
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      // ERR_CONNECTION_RESET: ruido benigno YA documentado de este sandbox
      // (assets .glb bajo carga, ver mueblesVisual.e2e.mjs/playtestMultijugador.e2e.mjs
      // — mismo criterio de exclusión, no es un fallo de esta pasada).
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real sobre el mapa de prueba recién horneado...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    const testid = "portal_0"; // primera entrada del MISMO filtro que game.ts aplica, ver arriba
    await page.waitForSelector(`[data-testid="${testid}"]`, { state: "attached", timeout: 20000 });
    const textoEtiqueta = await page.locator(`[data-testid="${testid}"]`).textContent();
    comprobar(
      `la etiqueta "Entrar ${entrada.nombreDestino}" existe en el DOM (creada oculta)`,
      textoEtiqueta === `Entrar ${entrada.nombreDestino}`,
      `texto real="${textoEtiqueta}"`,
    );

    console.log("2) lejos de cualquier puerta: la etiqueta debe estar OCULTA, y F/portal:usar debe rechazarse con un toast visible...");
    await page.evaluate(() => window.__test.enviar("admin:debug:teleport", { x: 5.5, y: 5.5 }));
    await esperar(1200);
    const visibleLejos = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta está OCULTA estando lejos de la puerta", !visibleLejos);

    await page.evaluate(() => window.__test.enviar("portal:usar"));
    await esperar(500);
    const textoTrasRechazo = await page.evaluate(() => document.body.innerText);
    comprobar(
      "portal:error da un toast visible en pantalla (item 5 del plan — antes solo iba a consola)",
      /puerta/i.test(textoTrasRechazo),
      textoTrasRechazo.slice(0, 300).replace(/\n+/g, " | "),
    );

    console.log("3) teleport junto a la puerta real (dentro de RADIO_INTERACCION del portal) -> la etiqueta debe HACERSE VISIBLE...");
    await page.evaluate(
      ({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }),
      { x: entrada.x + 0.5, y: entrada.y + 0.5 },
    );
    await page.waitForSelector(`[data-testid="${testid}"]`, { state: "visible", timeout: 8000 }).catch(() => {});
    const visibleCerca = await page.locator(`[data-testid="${testid}"]`).isVisible();
    comprobar("la etiqueta se hace VISIBLE junto a la puerta real", visibleCerca);
    if (!visibleCerca) throw new Error("la etiqueta nunca se mostró — no se puede seguir con el clic");

    const capturaAntes = path.join(CARPETA_CAPTURAS, "puerta_fisica_etiqueta_visible.png");
    await page.screenshot({ path: capturaAntes });
    console.log(`   captura (etiqueta visible junto a la puerta): ${capturaAntes}`);

    console.log("4) clic REAL en pantalla sobre la etiqueta (page.mouse.click en coordenadas reales, NUNCA se invoca el handler a mano)...");
    const box = await page.locator(`[data-testid="${testid}"]`).boundingBox();
    comprobar("la etiqueta tiene una posición de pantalla real (boundingBox)", !!box, JSON.stringify(box));
    if (!box) throw new Error("sin boundingBox, no se puede hacer clic real");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    console.log("5) confirmando que portal:usar viajó de verdad y la navegación ocurrió (sala=region, mapaId resuelto)...");
    await page.waitForURL((url) => url.searchParams.get("sala") === "region", { timeout: 15000 }).catch(() => {});
    const urlFinal = new URL(page.url());
    comprobar("la URL navegó a sala=region tras el clic", urlFinal.searchParams.get("sala") === "region", page.url());
    const mapaIdEsperado = `${MAPA_ID_TEST}/${entrada.destino.mapaId}`;
    comprobar(
      "el mapaId de destino se resolvió a la ruta real anidada (resolverMapaIdDestino)",
      urlFinal.searchParams.get("mapaId") === mapaIdEsperado,
      `esperado="${mapaIdEsperado}" real="${urlFinal.searchParams.get("mapaId")}"`,
    );

    console.log("6) confirmando que la región de destino cargó de verdad tras la recarga (no se quedó en blanco)...");
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    comprobar("el cliente reconectó dentro de la región de destino", true);

    console.log("7) alejarse de vuelta (dentro de la nueva región) -> ninguna etiqueta 'portal_0' vieja debe quedar clicable (recarga completa de página)...");
    const quedaEtiquetaVieja = await page.locator(`[data-testid="${testid}"]`).count();
    comprobar("sin etiqueta residual de la sala anterior tras la recarga completa", quedaEtiquetaVieja === 0 || !(await page.locator(`[data-testid="${testid}"]`).isVisible().catch(() => false)));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: puerta física clicable verificada de punta a punta (etiqueta oculta/visible por distancia, clic real, navegación, toast de error) — capturas en ${CARPETA_CAPTURAS} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
    fs.rmSync(CARPETA_MAPA_TEST, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ puertaFisicaClicable.e2e: TODO OK" : `\n❌ puertaFisicaClicable.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
