// E2E VISUAL del panel de cofre con rejilla real + drag&drop cruzado con el
// inventario propio (docs/GDD_Produccion.md §3ter, pedido streamer
// 2026-09-06: "el arcón o cualquier objeto con inventario al darle click
// debe salir la opción abrir inventario y se abre la UI de su inventario
// con el grid y podrás dar a la I para abrir el tuyo e intercambiar
// objetos"). Cliente REAL (Vite+Three.js) bajo Playwright, mismo criterio
// que panelReclutador.e2e.mjs.
//
// El gesto de clicar el cofre 3D (menú contextual "Abrir <nombre>") ya
// existía desde 2026-08-31 y no es del alcance de hoy — se dispara aquí
// vía `window.__test.abrirCofre(id, nombre)` (mismo efecto EXACTO que ese
// clic: fija `cofreObjetivo` + `cofre:consultar`), mismo criterio "sin
// sonda de targeting 3D" que el resto de e2e de este proyecto (p.ej. "C"
// en vez de clicar un enemigo en combate.e2e.mjs). Lo que SÍ es de hoy —
// la rejilla con drag&drop real de panelCofre.ts/panelJugador.ts — se
// ejercita con eventos DOM sintéticos de verdad (dragstart/dragover/drop
// con DataTransfer real), no con sondas: es la única forma de disparar
// HTML5 drag&drop desde Playwright sin un ratón físico, pero ejecuta el
// mismo `ondragstart`/`ondrop` real que un arrastre humano.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/panelCofreGrid.e2e.mjs
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

const PUERTO_WS = 2610;
const PUERTO_WEB = 5201;
const NOMBRE = "E2E-CofreGrid"; // también JARL_NOMBRES — el arcón sembrado no tiene dueño, jarl lo abre igual (mismo bypass que testZoneDebug.e2e.mjs)
const rutaBd = join(dirServidor, "test", "panelCofreGrid_e2e.sqlite");
const PARCELA_ID = "p_0001"; // única parcela real de assets/mapas/testzone/parcelas.json
const COFRE_XY = { x: 222, y: 271 }; // cerca del spawn real de testzone (220.5,270.5)

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("0) sembrando BD sqlite temporal (item propio + arcón real sembrado en la parcela)...");
let idArcon;
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
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propiedad TEXT NOT NULL, objeto TEXT NOT NULL, categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL, rot INTEGER NOT NULL DEFAULT 0, variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT, creado_en TEXT NOT NULL
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, ahora);
  const items = JSON.stringify([{ id: 1, itemId: "madera_dura", cantidad: 3, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);
  idArcon = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "arcon", "mueble", COFRE_XY.x, COFRE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  arcon id=${idArcon}@(${COFRE_XY.x},${COFRE_XY.y})`);

const rutaTestzone = join(dirRaiz, "assets", "mapas", "testzone");
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
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

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
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
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(t);
      if (t.startsWith("[cofre]") || t.startsWith("DEBUG")) console.log("  <consola>", t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log(`1) cargando cliente real como "${NOMBRE}" (jarl vía JARL_NOMBRES — el arcón sembrado no tiene dueño)...`);
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${encodeURIComponent(NOMBRE)}`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });
    await espera(600);

    console.log("2) abre el inventario propio (tecla I) — confirma el ítem sembrado (madera_dura) con celda draggable...");
    await page.keyboard.press("i");
    await espera(200);
    const celdaPropia = await page.evaluate(() => {
      const celdas = [...document.querySelectorAll('[draggable="true"]')];
      const c = celdas.find((el) => el.title?.includes("madera") || el.textContent?.includes("madera"));
      return c ? { title: c.title, texto: c.textContent } : null;
    });
    comprobar("el inventario propio muestra la madera_dura sembrada en una celda arrastrable", !!celdaPropia, JSON.stringify(celdaPropia));

    console.log(`3) abre el arcón real (window.__test.abrirCofre, mismo efecto que clicar 'Abrir Arcón') — id=${idArcon}...`);
    await page.evaluate((id) => window.__test.abrirCofre(id, "Arcón"), idArcon);
    await espera(400);
    const estadoCofreInicial = await page.evaluate(() => document.body.innerText.includes("Arcón") && document.body.innerText.includes("(vacío)"));
    comprobar("el panel del cofre se abre y muestra la rejilla vacía (arcón recién sembrado, sin ítems)", estadoCofreInicial);

    const rutaAbierto = join(capturas, "cofre_grid_abierto.png");
    await page.screenshot({ path: rutaAbierto });
    console.log(`   captura (inventario propio + rejilla del cofre, ambos abiertos): ${rutaAbierto}`);

    console.log("4) arrastra la madera_dura DESDE el inventario propio HASTA la rejilla del cofre (drag&drop real, cofre:meterItem)...");
    const resultadoMeter = await page.evaluate(() => {
      // Distingue la rejilla del jugador (raiz.style.left="16px") de la del
      // cofre (raiz.style.left="50%") subiendo por los ancestros — mismo
      // criterio real que usa cada panel, sin heurística de orden en el DOM.
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
      if (!gridJugador || !gridCofre) return { ok: false, motivo: "rejillas no identificadas", gridsEncontrados: grids.length };
      const celdaOrigen = [...gridJugador.querySelectorAll('[draggable="true"]')].find((el) => el.title?.includes("madera"));
      if (!celdaOrigen) return { ok: false, motivo: "no se encontró la celda de origen en la rejilla del jugador" };
      const datos = JSON.stringify({ instanciaId: 1, rot: 0, origen: "jugador" });
      const dt = new DataTransfer();
      dt.setData("text/plain", datos);
      celdaOrigen.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      gridCofre.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      gridCofre.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return { ok: true, gridsEncontrados: grids.length };
    });
    comprobar("el drag&drop hacia la rejilla del cofre se dispara (ondrop real, sin error de DOM)", resultadoMeter.ok, JSON.stringify(resultadoMeter));
    await espera(500);

    const textoTrasMeter = await page.evaluate(() => document.body.innerText);
    comprobar(
      "tras el drag&drop, el cofre YA NO está vacío (cofre:meterItem confirmado por el servidor, cofre:estado actualiza la rejilla)",
      !textoTrasMeter.includes("(vacío)") && textoTrasMeter.includes("madera"),
      textoTrasMeter.split("\n").filter((l) => l.trim()).slice(0, 15).join(" | "),
    );

    const rutaMetido = join(capturas, "cofre_grid_tras_meter.png");
    await page.screenshot({ path: rutaMetido });
    console.log(`   captura (ítem ya dentro del cofre): ${rutaMetido}`);

    console.log("5) arrastra la MISMA madera_dura DE VUELTA del cofre al inventario propio (cofre:sacarItem)...");
    const resultadoSacar = await page.evaluate(() => {
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
      if (!gridCofre || !gridJugador) return { ok: false, motivo: "rejillas no encontradas" };
      const celdaCofre = [...gridCofre.querySelectorAll('[draggable="true"]')].find((el) => el.title?.toLowerCase().includes("madera"));
      if (!celdaCofre) return { ok: false, motivo: "no se encontró la celda dentro del cofre" };
      const datos = JSON.stringify({ instanciaId: 1, rot: 0, origen: "cofre" });
      const dt = new DataTransfer();
      dt.setData("text/plain", datos);
      celdaCofre.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      gridJugador.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      gridJugador.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return { ok: true };
    });
    comprobar("el drag&drop de vuelta al inventario propio se dispara (ondrop real)", resultadoSacar.ok, JSON.stringify(resultadoSacar));
    await espera(1200);

    const textoTrasSacar = await page.evaluate(() => document.body.innerText);
    comprobar(
      "tras sacarlo, el cofre vuelve a estar vacío (cofre:sacarItem confirmado, round-trip completo jugador->cofre->jugador)",
      textoTrasSacar.includes("(vacío)"),
      textoTrasSacar.split("\n").filter((l) => l.trim()).slice(0, 15).join(" | "),
    );

    const rutaFinal = join(capturas, "cofre_grid_tras_sacar.png");
    await page.screenshot({ path: rutaFinal });
    console.log(`   captura final (round-trip completo): ${rutaFinal}`);

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: rejilla+drag&drop del cofre verificados de punta a punta, capturas en ${capturas} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ panelCofreGrid.e2e: TODO OK" : `\n❌ panelCofreGrid.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
