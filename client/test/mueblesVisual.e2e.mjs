// E2E VISUAL del mobiliario del carpintero (docs/GDD_Construccion.md §9,
// pedido streamer 2026-09-11: "estanterías de poción, que se vea las
// pociones al colocarla... candelabros, lámparas de aceite"). Cliente REAL
// (Vite+Three.js) bajo Playwright, mismo montaje que panelCofreGrid.e2e.mjs
// (testzone, jarl vía JARL_NOMBRES). Confirma en el NAVEGADOR, no solo por
// protocolo (eso ya lo cubre server/test/mueblesCarpintero.e2e.mjs):
//   1) colocar la estantería (tecla B real = `construir`) la pinta y el panel
//      del cofre muestra la pista "Solo guarda: pociones y elixires".
//   2) arrastrar una poción del inventario propio a la rejilla (drag&drop
//      DOM real, mismo gesto que panelCofreGrid.e2e.mjs) hace que el render
//      dibuje UN prop sobre la estantería (`window.__test.expuestosVisibles`).
//   3) arrastrar una espada se rechaza y el toast "solo guarda..." aparece
//      en pantalla (antes cofre:error era solo consola).
//   4) colocar un candelabro de pie enciende una luz real en la escena.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/mueblesVisual.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2618;
const PUERTO_WEB = 5218;
const NOMBRE = "E2E-Muebles";
const rutaBd = join(dirServidor, "test", "mueblesVisual_e2e.sqlite");
// Casillas DENTRO de p_0001 (assets/mapas/testzone/parcelas.json: y 273-278,
// x 216-221 — `construir` real valida la parcela, a diferencia del arcón
// sembrado en BD de panelCofreGrid.e2e.mjs), a ~4 casillas del spawn
// (220.5,270.5): abrir el cofre no exige proximidad y los props se ven.
const ESTANTERIA_XY = { x: 218, y: 274 };
const CANDIDATAS_CANDELABRO = [{ x: 220, y: 276 }, { x: 216, y: 276 }, { x: 218, y: 277 }, { x: 221, y: 278 }];

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("0) sembrando BD sqlite temporal (jugador con estantería, candelabro, 2 pociones y una espada en el inventario)...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS inventarios (
      jugador_id INTEGER NOT NULL, contenedor_id TEXT NOT NULL, ancho INTEGER NOT NULL, alto INTEGER NOT NULL,
      siguiente_id INTEGER NOT NULL DEFAULT 1, items TEXT NOT NULL, PRIMARY KEY (jugador_id, contenedor_id)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, ahora);
  const items = JSON.stringify([
    { id: 1, itemId: "estanteria_pociones_pino", cantidad: 1, x: 0, y: 0, rot: 0 },
    { id: 2, itemId: "candelabro_pie_hierro", cantidad: 1, x: 1, y: 0, rot: 0 },
    { id: 3, itemId: "pocion_alquimica_clara", cantidad: 1, x: 2, y: 0, rot: 0 },
    { id: 4, itemId: "pocion_alquimica_vital", cantidad: 1, x: 3, y: 0, rot: 0 },
    { id: 5, itemId: "espada_corta", cantidad: 1, x: 4, y: 0, rot: 0 },
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 6, ?)").run(items);
  bd.close();
}

const rutaTestzone = join(dirRaiz, "assets", "mapas", "testzone");
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => { const s = String(d); if (/error/i.test(s)) process.stdout.write(`[${cmd}] ${s}`); });
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaTestzone, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE,
});
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/testzone",
});
const matarTodo = () => {
  for (const p of [servidor, vite]) { try { process.kill(-p.pid, "SIGKILL"); } catch {} try { p.kill("SIGKILL"); } catch {} }
};
process.on("exit", matarTodo);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {}
    await espera(500);
  }
  throw new Error(`No responde ${url}`);
}

let fallos = 0, pasadas = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "  OK " : "  FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (ok) pasadas++; else fallos++;
}

/** Arrastra la celda del inventario propio cuyo title contenga `texto` hasta la rejilla del cofre — mismo gesto DOM real que panelCofreGrid.e2e.mjs. */
async function arrastrarAlCofre(page, texto, instanciaId) {
  return page.evaluate(([texto, instanciaId]) => {
    function raizDe(el) {
      let cur = el;
      while (cur && cur !== document.body) {
        if (cur.style && (cur.style.left === "16px" || cur.style.left === "50%")) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    const grids = [...document.querySelectorAll("div")].filter((el) => el.style.backgroundImage?.includes("repeating-linear-gradient"));
    const gridJugador = grids.find((g) => raizDe(g)?.style.left === "16px");
    const gridCofre = grids.find((g) => raizDe(g)?.style.left === "50%");
    if (!gridJugador || !gridCofre) return { ok: false, motivo: "rejillas no identificadas", grids: grids.length };
    const celdaOrigen = [...gridJugador.querySelectorAll('[draggable="true"]')].find((el) => new RegExp(texto, "i").test(el.title || ""));
    if (!celdaOrigen) return { ok: false, motivo: `no se encontró la celda '${texto}' en el inventario` };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ instanciaId, rot: 0, origen: "jugador" }));
    celdaOrigen.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    gridCofre.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    gridCofre.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    return { ok: true };
  }, [texto, instanciaId]);
}

async function main() {
  let browser;
  try {
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.startsWith("[cofre]")) console.log("   <consola>", t);
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|fonts\.googleapis|ERR_NAME_NOT_RESOLVED/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log(`1) cargando cliente real como "${NOMBRE}" (jarl)...`);
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${encodeURIComponent(NOMBRE)}`);
    await page.waitForFunction(() => window.__colonyDebug && !!window.__test, null, { timeout: 30000 });
    await espera(800);

    console.log("2) coloca la estantería de pociones (construir = tecla B real) y espera a verla en el render...");
    await page.evaluate((xy) => window.__test.enviar("construir", { objeto: "estanteria_pociones_pino", categoria: "mueble", x: xy.x, y: xy.y, rot: 0, variante: 0 }), ESTANTERIA_XY);
    const idEstanteria = await page.waitForFunction(() => window.__test.idsDeObjeto("estanteria_pociones_pino")[0] ?? null, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
    comprobar("la estantería se coloca y el cliente la pinta (construccion:nueva → render)", typeof idEstanteria === "number", `id=${idEstanteria}`);
    if (typeof idEstanteria !== "number") throw new Error("sin estantería no hay nada más que probar");
    const expuestosVacios = await page.evaluate((id) => window.__test.expuestosVisibles(id), idEstanteria);
    comprobar("recién colocada no tiene ningún prop expuesto", expuestosVacios === null || expuestosVacios.props === 0, JSON.stringify(expuestosVacios));

    console.log("3) abre inventario (I) + estantería (abrirCofre) — pista del filtro visible...");
    await page.keyboard.press("i");
    await espera(200);
    // el muñeco de papel abre en la pestaña "Equipo": la rejilla del inventario vive en "Inventario"
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((el) => /Inventario/.test(el.textContent || "")); b?.click(); });
    await espera(200);
    await page.evaluate((id) => window.__test.abrirCofre(id, "Estantería de Pino para Pociones"), idEstanteria);
    // cofre:consultar resuelve transportes pendientes contra la BD antes de responder: se espera al DOM, no un tiempo fijo
    const pista = await page.waitForFunction(() => document.querySelector('[data-testid="cofre-pista"]')?.textContent ?? null, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
    if (pista === null) {
      const dump = await page.evaluate(() => ({ testids: [...document.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid), texto: document.body.innerText.split("\n").filter((l) => /guarda|Estanter|Cofre/i.test(l)).slice(0, 8) }));
      console.log("   DEBUG pista:", JSON.stringify(dump));
    }
    comprobar("el panel del cofre muestra 'Solo guarda: pociones y elixires'", pista === "Solo guarda: pociones y elixires", JSON.stringify(pista));
    const rejilla = await page.evaluate(() => {
      const grids = [...document.querySelectorAll("div")].filter((el) => el.style.backgroundImage?.includes("repeating-linear-gradient"));
      const g = grids.find((el) => el.style.width === "180px"); // 6 celdas x 30px
      return g ? { w: g.style.width, h: g.style.height } : null;
    });
    comprobar("la rejilla dibujada es de 6x1 celdas (rejillaCofre exacta)", !!rejilla && rejilla.h === "30px", JSON.stringify(rejilla));

    console.log("4) arrastra una poción a la estantería → prop visible sobre el mueble...");
    const r1 = await arrastrarAlCofre(page, "pocion_alquimica_clara", 3);
    comprobar("drag&drop de la poción disparado", r1.ok, JSON.stringify(r1));
    const expuestos1 = await page.waitForFunction((id) => { const e = window.__test.expuestosVisibles(id); return e && e.props >= 1 ? e : null; }, idEstanteria, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
    comprobar("el render tiene 1 prop expuesto sobre la estantería (construccion:expuestos → actualizarExpuestos)", !!expuestos1 && expuestos1.props === 1 && expuestos1.itemIds[0] === "pocion_alquimica_clara", JSON.stringify(expuestos1));
    const propiaRefrescada = await page.waitForFunction(() => {
      const grids = [...document.querySelectorAll("div")].filter((el) => el.style.backgroundImage?.includes("repeating-linear-gradient"));
      const propia = grids.find((g) => g.style.width === "240px"); // 8 celdas x 30px = rejilla del cuerpo
      return !!propia && ![...propia.querySelectorAll('[draggable="true"]')].some((c) => /pocion_alquimica_clara/.test(c.title || ""));
    }, null, { timeout: 5000 }).then(() => true).catch(() => false);
    comprobar("la rejilla del inventario propio ya NO enseña la poción guardada (refresco por cambio del array anidado)", propiaRefrescada);
    const r2 = await arrastrarAlCofre(page, "pocion_alquimica_vital", 4);
    comprobar("drag&drop de la segunda poción disparado", r2.ok, JSON.stringify(r2));
    const expuestos2 = await page.waitForFunction((id) => { const e = window.__test.expuestosVisibles(id); return e && e.props >= 2 ? e : null; }, idEstanteria, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
    if (!expuestos2 || expuestos2.props !== 2) {
      const dump = await page.evaluate(() => {
        const grids = [...document.querySelectorAll("div")].filter((el) => el.style.backgroundImage?.includes("repeating-linear-gradient"));
        return grids.map((g) => ({ w: g.style.width, celdas: [...g.querySelectorAll('[draggable="true"]')].map((c) => c.title) }));
      });
      console.log("   DEBUG rejillas:", JSON.stringify(dump));
    }
    comprobar("con dos pociones hay 2 props", !!expuestos2 && expuestos2.props === 2, JSON.stringify(expuestos2));

    console.log("5) arrastra la espada → rechazo con toast visible...");
    const r3 = await arrastrarAlCofre(page, "espada", 5);
    comprobar("drag&drop de la espada disparado", r3.ok, JSON.stringify(r3));
    const toast = await page.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => /solo guarda pociones y elixires/i.test(d.textContent || "") && d.children.length === 0), null, { timeout: 4000 }).then(() => true).catch(() => false);
    comprobar("aparece el toast 'ese mueble solo guarda pociones y elixires' (cofre:error ya no es solo consola)", toast);
    const expuestos3 = await page.evaluate((id) => window.__test.expuestosVisibles(id), idEstanteria);
    comprobar("la espada NO se añadió a los props expuestos", !!expuestos3 && expuestos3.props === 2, JSON.stringify(expuestos3));

    // cerrar paneles para la captura del mueble
    await page.keyboard.press("Escape");
    await espera(150);
    await page.keyboard.press("Escape");
    await espera(300);
    const rutaEstanteria = join(capturas, "muebles_estanteria_pociones.png");
    await page.screenshot({ path: rutaEstanteria });
    console.log(`   captura (estantería con 2 pociones expuestas): ${rutaEstanteria}`);

    console.log("6) coloca un candelabro de pie → luz real en la escena...");
    let idCandelabro = null;
    for (const xy of CANDIDATAS_CANDELABRO) {
      await page.evaluate((xy) => window.__test.enviar("construir", { objeto: "candelabro_pie_hierro", categoria: "mueble", x: xy.x, y: xy.y, rot: 0, variante: 0 }), xy);
      idCandelabro = await page.waitForFunction(() => window.__test.idsDeObjeto("candelabro_pie_hierro")[0] ?? null, null, { timeout: 2500 }).then((h) => h.jsonValue()).catch(() => null);
      if (typeof idCandelabro === "number") { console.log(`   colocado en (${xy.x},${xy.y})`); break; }
    }
    comprobar("el candelabro se coloca en alguna casilla libre junto al spawn", typeof idCandelabro === "number");
    if (typeof idCandelabro === "number") {
      const luz = await page.evaluate((id) => window.__test.tieneLuzConstruccion(id), idCandelabro);
      comprobar("el candelabro colocado tiene una PointLight real (capa iluminacion → encenderLuz)", luz === true);
      const luzEstanteria = await page.evaluate((id) => window.__test.tieneLuzConstruccion(id), idEstanteria);
      comprobar("la estantería (no es lámpara) NO tiene luz", luzEstanteria === false);
    }
    await espera(600);
    const rutaLuz = join(capturas, "muebles_candelabro_luz.png");
    await page.screenshot({ path: rutaLuz });
    console.log(`   captura (candelabro de pie con luz): ${rutaLuz}`);

    comprobar("sin errores de página/consola", erroresConsola.length === 0, erroresConsola.slice(0, 3).join(" | "));
  } finally {
    if (browser) await browser.close();
    matarTodo();
    for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
  }
}

main().then(() => {
  console.log(`\n${pasadas} comprobaciones en verde, ${fallos} fallidas`);
  process.exit(fallos > 0 ? 1 : 0);
}).catch((e) => { console.error("EXCEPCIÓN:", e); matarTodo(); process.exit(1); });
