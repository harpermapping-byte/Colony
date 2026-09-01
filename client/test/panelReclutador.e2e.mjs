// E2E visual del panel del reclutador de NPCs trabajadores pulido
// (docs/GDD_NPCs_Contratables.md, pedido 2026-09-01) Y del flujo cliente
// completo: mesa real → asignar receta → pose "trabajando" renderizada.
// Servidor + cliente Vite REALES sobre el mapa PRINCIPAL (mismo mapa que
// server/test/npcs_trabajadores_crafteo.e2e.mjs, que ya prueba la parte de
// crafteo/servidor sin navegador — esto es la capa de UI + render 3D encima,
// mismo criterio que adminPanel.e2e.mjs sobre admin.e2e.mjs).
// Una construcción "yunque_tocon" se siembra DIRECTO en BD (mismo atajo que
// herreria.e2e.mjs — no es el objetivo de este E2E probar la UI de
// colocación estilo PZ, ya probada en otro sitio).
// Confirma:
//   1) sin reclutador cerca, pulsar R no abre el panel.
//   2) tras colocar el reclutador (admin, mismo mecanismo de siempre) y
//      pulsar R, el panel aparece con el catálogo (oficios + coste marginal).
//   3) contratar un herrero desde el panel (clic real) lo hace aparecer en
//      "Tus trabajadores" con su salario mensual y próximo día de pago.
//   4) "Asignar mesa aquí" lo asigna a la mesa sembrada; el selector de
//      receta (dropdown, ya no texto libre) ofrece SOLO recetas de sus
//      oficios; asignar clavos_hierro deja el panel reflejando mesa+receta.
//   5) en el MUNDO 3D, el NPC pasa a accion "craftear" (window.__npcs) y su
//      pose "trabajando" se activa — captura real del rig posado.
//   node test/panelReclutador.e2e.mjs [dirCapturas]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const capturas = process.argv[2] || join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2607;
const PUERTO_WEB = 5207;
const JARL = "E2E-ReclutadorJarl"; // <=20 chars, ver comentario en npcs_trabajadores_crafteo.e2e.mjs
const rutaBd = join(dirServidor, "test", "panelReclutador_e2e.sqlite");
// Mismas coordenadas que server/test/npcs_trabajadores_crafteo.e2e.mjs (spawn
// real del mapa principal, dentro de la parcela p_0001).
const YUNQUE_XY = { x: 1600, y: 1601 };
const COLMENA_XY = { x: 1600, y: 1602 };
const COFRE_XY = { x: 1600, y: 1604 };
const PARCELA_ID = "p_0001";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("0) sembrando BD sqlite temporal (yunque_tocon real + lingote_hierro en su almacén)...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS propiedades (
      id TEXT PRIMARY KEY, tipo TEXT NOT NULL, asentamiento TEXT NOT NULL, dueno INTEGER, asignada_en TEXT,
      modo_tenencia TEXT, precio_farycoins INTEGER, periodo_horas INTEGER, expira_en TEXT,
      impuesto_activo INTEGER NOT NULL DEFAULT 0, impuesto_farycoins INTEGER, impuesto_periodo_horas INTEGER, impuesto_ultimo_cobro TEXT
    );
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propiedad TEXT NOT NULL, objeto TEXT NOT NULL, categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL, rot INTEGER NOT NULL DEFAULT 0, variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT, creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenderete_items (
      tenderete_id TEXT NOT NULL, item_id TEXT NOT NULL, cantidad INTEGER NOT NULL DEFAULT 0, precio_farycoins INTEGER NOT NULL,
      PRIMARY KEY (tenderete_id, item_id)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 1000)").run(JARL, ahora);
  // "p_0001" propiedad del JARL — el panel de gestión (docs/GDD_NPCs_Contratables.md
  // §Panel de gestión) solo lista construcciones REALES del jugador, así
  // que el selector de mesa necesita una fila de propiedad real con dueño.
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, 'parcela', 'ciudad', 1, ?)").run(PARCELA_ID, ahora);
  bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora);
  bd.prepare("INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES (?, 'lingote_hierro', 5, 0)").run(PARCELA_ID);
  // colmena (produce miel, origen de ruta) + cofre (destino de ruta) — para
  // verificar la sección de RUTA del panel de gestión (docs/GDD_NPCs_Contratables.md
  // §8bis/§Panel de gestión, fusión con transporte, pedido 2026-09-01).
  bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(PARCELA_ID, "colmena", "exterior", COLMENA_XY.x, COLMENA_XY.y, 0, 0, null, ahora);
  bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(PARCELA_ID, "cofre_pequeno", "mueble", COFRE_XY.x, COFRE_XY.y, 0, 0, null, ahora);
  bd.close();
}

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO_WS), BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`,
});
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}
async function esperarPuerto(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}

let browser;
try {
  console.log("1) arrancando servidor + cliente reales sobre el mapa principal...");
  await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
  await new Promise((r) => setTimeout(r, 1500)); // deja arrancar vite

  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const erroresJs = [];
  page.on("pageerror", (e) => erroresJs.push(String(e)));
  page.on("console", (m) => console.log("[page]", m.text()));

  await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${JARL}`);
  await page.waitForFunction(() => window.__test, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
  await page.waitForTimeout(1500); // deja llegar el snapshot de construcciones/npcs del mapa principal

  const panel = page.locator('[data-testid="panel-reclutador"]');

  console.log("2) sin reclutador cerca, R no abre nada...");
  await page.keyboard.press("r");
  await page.waitForTimeout(300);
  comprobar("panel oculto sin reclutador cerca", !(await panel.isVisible().catch(() => false)));

  console.log("3) el jarl coloca el reclutador en su posición (spawn) — mismo mecanismo admin de siempre...");
  await page.evaluate(() => window.__test.enviar("admin:npcTutorial:colocar", { tipoTutorial: "reclutador_trabajadores" }));
  await page.waitForFunction(() => window.__npcs().total > 0, null, { timeout: 10000 }).catch(() => {});
  console.log("   debug:", JSON.stringify(await page.evaluate(() => window.__colonyDebug)));
  console.log("   npcs:", JSON.stringify(await page.evaluate(() => window.__npcs())));
  console.log("   admin:error:", JSON.stringify(await page.evaluate(() => window.__test.ultimoMensaje("admin:error"))));

  console.log("4) ahora sí, R abre el panel con el catálogo de oficios...");
  await page.keyboard.press("r");
  await panel.waitFor({ state: "visible", timeout: 8000 });
  await panel.locator("text=herrero").waitFor({ timeout: 8000 });
  comprobar("panel visible con el catálogo de oficios", await panel.locator("text=herrero").isVisible());
  await page.screenshot({ path: join(capturas, "reclutador1_catalogo.png") });

  console.log("5) marcar 'herrero' muestra el coste ANTES de confirmar, y contratar...");
  await panel.locator('label:has-text("herrero") input[type=checkbox]').check();
  await page.waitForTimeout(150);
  const textoCoste = await panel.locator("text=Coste total:").first().textContent();
  comprobar("coste visible antes de confirmar", /Coste total: \d+ Farycoins \(1 oficio\)/.test(textoCoste || ""), textoCoste || "");
  await page.screenshot({ path: join(capturas, "reclutador2_coste_antes_de_confirmar.png") });
  await panel.getByRole("button", { name: "Contratar", exact: true }).click();
  await page.waitForTimeout(600);
  comprobar("aparece en 'Tus trabajadores' tras contratar", await panel.locator("text=Tus trabajadores (1)").isVisible());
  comprobar("muestra salario mensual y próximo día de pago", await panel.locator("text=/Salario: \\d+₣\\/mes · próximo pago en/").isVisible());
  await page.screenshot({ path: join(capturas, "reclutador3_contratado.png") });

  console.log("6) el selector de mesa lista SOLO construcciones REALES del jugador (docs/GDD_NPCs_Contratables.md §Panel de gestión) — se elige la yunque_tocon sembrada y se asigna...");
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="panel-reclutador"] select option')].some((o) => o.textContent?.includes("yunque_tocon")),
    null, { timeout: 8000 },
  );
  const opcionesMesa = await panel.locator("select").first().locator("option").allTextContents();
  comprobar("el selector de mesa NO está vacío/inventado — trae la yunque_tocon real", opcionesMesa.some((o) => o.includes("yunque_tocon")), JSON.stringify(opcionesMesa));
  await panel.locator("select").first().selectOption({ label: opcionesMesa.find((o) => o.includes("yunque_tocon")) });
  await panel.locator('button:has-text("Asignar mesa")').first().click();
  await page.waitForTimeout(600);
  comprobar("la fila del trabajador ya no dice 'sin asignar' para la mesa", !(await panel.locator("text=Mesa: sin asignar").isVisible().catch(() => false)));

  console.log("7) el selector de receta ofrece SOLO recetas del oficio del trabajador (dropdown, ya no texto libre)...");
  const opciones = await panel.locator("select").nth(1).locator("option").allTextContents();
  comprobar("clavos_hierro (herrero) está en las opciones", opciones.some((o) => o.includes("clavos_hierro")));
  comprobar("ninguna receta de otro oficio (p.ej. masa_pan, molinero) aparece", !opciones.some((o) => o.includes("masa_pan")));
  // select[0] = selector de mesa (§6), select[1] = selector de receta.
  await panel.locator("select").nth(1).selectOption({ label: opciones.find((o) => o.includes("clavos_hierro")) });
  await panel.locator('button:has-text("Asignar receta")').click();
  await page.waitForTimeout(600);
  comprobar("la fila refleja la receta asignada (craftando)", await panel.locator("text=/Receta: clavos_hierro.*craftando/").isVisible());
  await page.screenshot({ path: join(capturas, "reclutador4_mesa_y_receta_asignadas.png") });

  console.log("8) en el MUNDO 3D, el NPC pasó a accion 'craftear' (dispara la pose 'trabajando' del rig)...");
  const npcs = await page.evaluate(() => window.__npcs());
  const entradas = Object.entries(npcs.porSlot || {});
  const trabajador = entradas.find(([slot]) => slot.startsWith("trabajadorOficio_"));
  comprobar("el trabajador está en el mundo con accion 'craftear'", !!trabajador && trabajador[1].accion === "craftear", JSON.stringify(trabajador));
  comprobar("el flag 'trabajando' del rig está activo", !!trabajador && trabajador[1].trabajando === true, JSON.stringify(trabajador));

  console.log("9bis) contrata un trabajador de oficio 'transporte' y usa la sección de RUTA del panel (docs/GDD_NPCs_Contratables.md §8bis/§Panel de gestión, fusión con transporte)...");
  await panel.locator('label:has-text("transporte") input[type=checkbox]').check();
  await page.waitForTimeout(150);
  await panel.getByRole("button", { name: "Contratar", exact: true }).click();
  await page.waitForTimeout(600);
  comprobar("aparece un segundo trabajador tras contratar el de transporte", await panel.locator("text=Tus trabajadores (2)").isVisible());
  await page.screenshot({ path: join(capturas, "reclutador6_transporte_contratado.png") });

  // la fila de RUTA es la que NO tiene "Asignar mesa" (transporte usa
  // "Asignar ruta") — se localiza por el botón, no por posición, para no
  // depender del orden de renderizado de la lista.
  const filaTransporte = panel.locator("div").filter({ has: page.getByRole("button", { name: "Asignar ruta" }) }).last();
  await filaTransporte.waitFor({ state: "attached", timeout: 8000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="panel-reclutador"] select option')].some((o) => o.textContent?.includes("colmena")),
    null, { timeout: 8000 },
  );
  const selectsRuta = filaTransporte.locator("select");
  const opcionesOrigen = await selectsRuta.nth(0).locator("option").allTextContents();
  const opcionesDestino = await selectsRuta.nth(1).locator("option").allTextContents();
  comprobar("el selector de origen trae la colmena real (nunca inventada)", opcionesOrigen.some((o) => o.includes("colmena")), JSON.stringify(opcionesOrigen));
  comprobar("el selector de destino trae el cofre real", opcionesDestino.some((o) => o.includes("cofre_pequeno")), JSON.stringify(opcionesDestino));
  await selectsRuta.nth(0).selectOption({ label: opcionesOrigen.find((o) => o.includes("colmena")) });
  await selectsRuta.nth(1).selectOption({ label: opcionesDestino.find((o) => o.includes("cofre_pequeno")) });
  await filaTransporte.getByRole("button", { name: "Asignar ruta" }).click();
  await page.waitForTimeout(800);
  comprobar("la fila refleja la ruta activa (ya no 'sin ruta asignada')", !(await panel.locator("text=Sin ruta asignada todavía").isVisible().catch(() => false)));
  comprobar("la fila muestra 'Ruta activa' con origen→destino", await panel.locator("text=/Ruta activa: construcción #\\d+ → cofre:\\d+/").isVisible());
  await page.screenshot({ path: join(capturas, "reclutador7_ruta_asignada.png") });

  console.log("10) en el MUNDO 3D, el trabajador de transporte camina como agente transportista (no se queda plantado como NPC fijo)...");
  const npcsTrasRuta = await page.evaluate(() => window.__npcs());
  const agenteRuta = Object.keys(npcsTrasRuta.porSlot || {}).find((slot) => slot.startsWith("contrato:"));
  comprobar("existe un agente transportista en el mundo para la ruta recién asignada", !!agenteRuta, JSON.stringify(npcsTrasRuta.porSlot));

  console.log("11) captura real de la pose 'trabajando' del rig sobre la mesa...");
  await panel.locator('button:has-text("Cerrar")').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(capturas, "reclutador5_pose_trabajando_en_el_mundo.png") });

  comprobar("sin errores de JS en la página", erroresJs.length === 0, erroresJs.join(" | "));

  console.log(fallos === 0 ? "\n✅ panelReclutador.e2e: todo OK" : `\n❌ panelReclutador.e2e: ${fallos} fallo(s)`);
  process.exitCode = fallos === 0 ? 0 : 1;
} catch (err) {
  console.error("panelReclutador.e2e reventó:", err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  matar();
  try { unlinkSync(rutaBd); } catch {}
}
