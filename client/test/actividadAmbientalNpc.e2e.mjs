// E2E VISUAL de la animación/charla ambiental de NPCs de rutina (docs/GDD_
// Agentes_Moviles.md, pedido streamer 2026-09-13: "los NPC en las aldeas
// que hacen acciones de trabajo etc deberían tener animación
// correspondiente así no se ven estáticos, deben estar animados si
// conversan entre ellos etc, y las conversaciones se ven encima de sus
// cabezas como ya tenemos con otros NPC evento de estos"). Servidor
// Colyseus real + Vite, aldea EFÍMERA horneada al vuelo (mismo patrón que
// panelInspeccion.e2e.mjs) para tener población civil real con rutina real
// (trabajar/vender/socializar/cotillear...) — no la Test Zone, que no tiene
// NPCs de poblacion/ con rutina.
//   1) al menos un NPC visible sale con `trabajando:true` (pose ocupada
//      real, no solo "craftear" como antes) para una `accion` de trabajo
//      real de la rutina horneada;
//   2) durante ~26s (más de un ciclo completo de charla) al menos un NPC
//      muestra en su etiqueta un texto DISTINTO de su propio nombre — la
//      burbuja de charla — sin que la sesión tenga ningún error de consola.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/actividadAmbientalNpc.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2612;
const PUERTO_WEB = 5212;
const NOMBRE = "AmbA";
const BD = join(tmpdir(), "colony_actividad_ambiental_npc_e2e.sqlite");
const SEMILLA_ALDEA = "semilla-actividad-ambiental-e2e";
const NOMBRE_MAPA_ALDEA = "aldea_actividad_ambiental_e2e_tmp"; // efímero bajo assets/mapas/, borrado en el finally, NUNCA se comitea
const rutaAldea = join(dirRaiz, "assets", "mapas", NOMBRE_MAPA_ALDEA);
rmSync(BD, { force: true });
rmSync(rutaAldea, { recursive: true, force: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("0) horneando un pueblo EFÍMERO (más roles/rutina que una aldea pequeña: comercio, plaza, taberna) + su población...");
{
  let r = spawnSync("node", ["ciudades/src/index.js", "pueblo", SEMILLA_ALDEA, rutaAldea], { cwd: dirRaiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: el bake del pueblo no terminó bien");
  r = spawnSync("node", ["poblacion/src/exportarAsentamiento.js", "pueblo", SEMILLA_ALDEA, rutaAldea], { cwd: dirRaiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: la exportación de población no terminó bien");
  if (!existsSync(join(rutaAldea, "poblacion.json"))) throw new Error("FALLO: no se generó poblacion.json");
}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  procesos.push(p);
  return p;
}
const matarTodo = () => {
  for (const p of procesos) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
  rmSync(BD, { force: true });
  rmSync(rutaAldea, { recursive: true, force: true });
};
process.on("exit", matarTodo);

// HORA_FORZADA=13 (mediodía real, mismo criterio que panelInspeccion.e2e.mjs):
// sin esto la rutina puede tener casi todo el pueblo durmiendo/en casa al
// azar según a qué hora arranque el servidor.
lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaAldea, BD_RUTA: BD, JARL_NOMBRES: NOMBRE, HORA_FORZADA: "13",
});
lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/testflat",
});
for (const url of [`http://localhost:${PUERTO_WS}/`, `http://localhost:${PUERTO_WEB}/`]) {
  for (let i = 0; i < 240; i++) { try { await fetch(url); break; } catch {} await esperar(500); }
}

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

// Texto ACTUAL de la etiqueta (CSS2DObject) de un NPC dado su `id` — recorre
// TODOS los <div> hoja porque no hay ningún atributo que ligue el div al
// slotId directamente (mismo criterio que panelInspeccion.e2e.mjs, que
// busca por CONTENIDO en vez de por id de DOM). Como no hay forma de mapear
// id->div sin conocer el texto de antemano, se pasa el nombre esperado y se
// devuelve lo que haya AHORA en ese div (que puede ya no ser el nombre, si
// está en mitad de una burbuja de charla).
async function textoEtiquetaPorNombreOriginal(page, nombreOriginal) {
  return page.evaluate((nombre) => {
    // El div de un NPC concreto es el único, en TODO el documento, cuyo
    // texto fue ALGUNA VEZ ese nombre — pero como puede haber cambiado ya a
    // una frase de charla, hay que localizarlo la PRIMERA vez (cuando su
    // texto todavía es el nombre) y memorizar la referencia en `window`.
    if (!window.__etiquetasPorNombre) window.__etiquetasPorNombre = new Map();
    let el = window.__etiquetasPorNombre.get(nombre);
    if (el && document.contains(el)) return el.textContent;
    for (const cand of document.querySelectorAll("div")) {
      if (cand.children.length === 0 && cand.textContent === nombre) {
        window.__etiquetasPorNombre.set(nombre, cand);
        return cand.textContent;
      }
    }
    return null;
  }, nombreOriginal);
}

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  console.log("1) A entra al pueblo efímero...");
  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE}&sala=region&mapaId=${NOMBRE_MAPA_ALDEA}`, { waitUntil: "commit", timeout: 120000 });
  await page.waitForFunction(() => window.__colonyDebug && window.__test && window.__npcs, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__npcs().total > 0, null, { timeout: 20000, polling: 500 });
  await esperar(1500); // deja que lleguen unos cuantos patches y las etiquetas iniciales se asienten

  console.log("2) al menos un NPC visible con pose 'trabajando' real (no solo craftear)...");
  const porSlot = await page.evaluate(() => window.__npcs().porSlot);
  const trabajando = Object.entries(porSlot).filter(([, v]) => v.trabajando);
  comprobar(
    "hay al menos un NPC con pose de trabajando activa",
    trabajando.length > 0,
    `${trabajando.length}/${Object.keys(porSlot).length} — acciones vistas: ${[...new Set(Object.values(porSlot).map((v) => v.accion))].join(", ")}`,
  );
  await page.screenshot({ path: join(capturas, "actividadAmbiental_1_pueblo.png"), timeout: 45000 }).catch(() => {});

  console.log("3) siguiendo ~26s (más de un ciclo completo de charla, 16s) la etiqueta de varios NPCs, buscando que alguno diga algo distinto de su nombre...");
  const npcs = await page.evaluate(() => window.__npcs().lista.filter((n) => n.visible && n.nombre));
  comprobar("hay NPCs visibles con nombre para seguir", npcs.length > 0, String(npcs.length));

  let algunoHablo = false;
  const frasesVistas = new Set();
  for (let muestra = 0; muestra < 13 && !algunoHablo; muestra++) {
    for (const n of npcs) {
      const texto = await textoEtiquetaPorNombreOriginal(page, n.nombre);
      if (texto && texto !== n.nombre) {
        algunoHablo = true;
        frasesVistas.add(texto);
      }
    }
    if (!algunoHablo) await page.waitForTimeout(2000);
  }
  comprobar("al menos un NPC mostró una burbuja de charla distinta de su nombre", algunoHablo, [...frasesVistas].join(" | "));

  comprobar("sin errores de JS en toda la sesión", errores.length === 0, errores.join(" | "));

  console.log(fallos === 0 ? "\n✅ actividadAmbientalNpc.e2e: todo OK" : `\n❌ actividadAmbientalNpc.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("actividadAmbientalNpc.e2e reventó:", err);
  process.exit(1);
} finally {
  if (browser) await browser.close();
}
