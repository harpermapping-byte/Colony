"use strict";

// E2E VISUAL de "dormir:completar" (auditoría de interacciones 2026-09-13,
// pedido streamer: "revisa si todas las funciones/interacciones están bien
// seteadas... revisa todo"). Hallazgo real: `manejarDormirIniciar`
// (RoomExteriorBase.ts) responde "dormir:iniciado {terminaEn}" y espera a
// que el CLIENTE mande "dormir:completar" pasado ese tiempo — el propio
// comentario del servidor decía literalmente "el cliente pide
// dormir:completar cuando cree que ya toca" — pero NINGÚN fichero de
// client/src/ lo mandaba nunca (confirmado por grep). "Tumbarse en la cama"
// no hacía absolutamente nada: nunca se recuperaba la estamina de verdad ni
// se aplicaba el buff de "descansado", sin ningún error visible que lo
// delatara (el propio dormir:iniciado se recibía bien, así que parecía
// funcionar mientras no se esperara el final).
//
// server/test/mueblesCarpintero.e2e.mjs YA prueba que el SERVIDOR responde
// bien a un dormir:completar mandado a mano (protocolo colyseus.js puro) —
// este test prueba la pieza que faltaba: el CLIENTE REAL debe mandarlo SOLO,
// sin que nadie se lo pida, pasados los ~20s reales de sueño.
//
// Usa el mapa `testflat` (assets/mapas/testflat), que YA trae una
// `cama_individual` real sembrada como construcción por
// server/src/mundo/semillaTestZone.ts — sin crear nada nuevo, mismo atajo
// que panelAlquimia.e2e.cjs/playtestOficios.e2e.mjs.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/dormirCompletar.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_TESTFLAT = path.join(RAIZ, "assets", "mapas", "testflat");
const PUERTO_WS = 2643;
const PUERTO_WEB = 5243;
const NOMBRE_JARL = "DormirTester";
// Coordenadas reales de semillaTestZone.ts: `{ objeto: "cama_individual", x: 34, y: 16 }`.
const CAMA_XY = { x: 35, y: 17 };

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
      PORT: String(PUERTO_WS), RUTA_MAPA: RUTA_TESTFLAT, BD_RUTA: ":memory:", JARL_NOMBRES: NOMBRE_JARL,
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
      VITE_RUTA_MAPA: "/assets/mapas/testflat",
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

    console.log("1) cargando cliente real (mapa testflat, jarl real vía JARL_NOMBRES)...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_JARL}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });

    console.log("2) teletransportando junto a la cama real sembrada por semillaTestZone.ts...");
    await page.evaluate(({ x, y }) => window.__test.enviar("admin:debug:teleport", { x, y }), CAMA_XY);
    await esperar(500);

    const idCama = await page.evaluate(() => window.__test.idsDeObjeto("cama_individual")[0] ?? null);
    comprobar("la cama real de la Test Zone existe y tiene un id de construcción", idCama != null, `id=${idCama}`);
    if (idCama == null) throw new Error("sin cama real que probar");

    console.log("3) dormir:iniciar (mismo mensaje que 'Tumbarse en la cama' del menú de interacción)...");
    const antesToast = await page.evaluate(() => document.body.innerText);
    await page.evaluate((id) => window.__test.enviar("dormir:iniciar", { construccionId: id }), idCama);
    await page.waitForFunction((antes) => document.body.innerText !== antes && document.body.innerText.includes("Te tumbas a dormir"), antesToast, { timeout: 5000 });
    comprobar("dormir:iniciado muestra un toast real ('Te tumbas a dormir…')", true);

    console.log("4) esperando los ~20s reales de sueño SIN mandar dormir:completar a mano — el CLIENTE debe mandarlo solo...");
    // Antes de este fix, esto se quedaba así para siempre: dormir:iniciado
    // llegaba y no pasaba NADA más — nunca "dormir:completado", nunca el
    // buff, nunca ningún error que lo delatara.
    await page.waitForFunction(() => document.body.innerText.includes("Descansado"), null, { timeout: 26000 });
    const textoFinal = await page.evaluate(() => document.body.innerText);
    comprobar("el cliente mandó dormir:completar SOLO y el toast de 'Descansado' aparece sin intervención manual", /Descansado/.test(textoFinal), textoFinal.split("\n").find((l) => l.includes("Descansado")));

    const estaminaTrasDormir = await page.evaluate(() => window.__colonyDebug);
    console.log("   estado del jugador tras dormir:", JSON.stringify(estaminaTrasDormir));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: dormir:completar ya se manda solo tras el sueño real, cierra el bug de la auditoría de interacciones ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ dormirCompletar.e2e: TODO OK" : `\n❌ dormirCompletar.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
