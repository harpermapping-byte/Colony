// E2E VISUAL del panel de inspección (docs/GDD_UI_Paneles.md, pedido
// streamer 2026-09-12: "los nombres de los npc y animales arboles y tal si
// tienen solo se muestran al acercarte mucho a ellos o al darle click sobre
// el y podrás ver INFO sobre ese pj, ciudad al que pertenece, nombre,
// oficio etc, familia si tiene"). Servidor Colyseus real + Vite:
//   1) nombres solo de cerca: DOS páginas sobre assets/mapas/testflat, con
//      los dos jugadores juntos el nombre del otro se ve; al teleportarse
//      lejos desaparece (histéresis real, no simulada) — y vuelve a
//      aparecer al acercarse otra vez;
//   2) clic sobre OTRO JUGADOR (misma sesión de testflat) abre el panel con
//      su nombre real y "Sin oficio" (nadie ha elegido ninguno en este test);
//   3) clic sobre un NPC real dispara el round-trip npc:inspeccionar real
//      (sin bypass) y el panel muestra su ciudad/oficio/familia reales —
//      UNA TERCERA página, conectada aparte a una aldea_pequena horneada
//      EFÍMERA (mismo patrón que server/test/npcInspeccionar.e2e.mjs, ahora
//      con un clic real de navegador en vez de mandar el mensaje a mano):
//      testflat mezcla NPCs civiles con dummies de combate (hostiles, agro
//      automático) y NPCs "tutorial" plantados junto a puertas — cualquiera
//      de los dos puede navegar la página sin relación con el clic, así que
//      para probar el round-trip de verdad hace falta un mapa que SOLO
//      tenga población civil real de poblacion/.
// Un clic real con page.mouse.click(x,y) en la posición de pantalla real
// del nametag de cada entidad — nunca se invoca ningún handler a mano.
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/panelInspeccion.e2e.mjs
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

const PUERTO_WS = 2611;
const PUERTO_WEB = 5211;
const NOMBRE_A = "InspA";
const NOMBRE_B = "InspB";
const NOMBRE_C = "InspC";
const BD = join(tmpdir(), "colony_panel_inspeccion_e2e.sqlite");
const SEMILLA_ALDEA = "semilla-inspeccion-panel-e2e";
const NOMBRE_MAPA_ALDEA = "aldea_inspeccion_panel_e2e_tmp"; // efímero bajo assets/mapas/ (RegionRoom solo resuelve mapaId ahí) — borrado en el finally, NUNCA se comitea
const rutaAldea = join(dirRaiz, "assets", "mapas", NOMBRE_MAPA_ALDEA);
rmSync(BD, { force: true });
rmSync(rutaAldea, { recursive: true, force: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("0) horneando una aldea_pequena EFÍMERA (solo civiles reales, sin dummies/tutoriales) + su población...");
{
  let r = spawnSync("node", ["ciudades/src/index.js", "aldea_pequena", SEMILLA_ALDEA, rutaAldea], { cwd: dirRaiz, stdio: "inherit" });
  if (r.status !== 0) throw new Error("FALLO: el bake de la aldea no terminó bien");
  r = spawnSync("node", ["poblacion/src/exportarAsentamiento.js", "aldea_pequena", SEMILLA_ALDEA, rutaAldea], { cwd: dirRaiz, stdio: "inherit" });
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

const rutaTestflat = join(dirRaiz, "assets", "mapas", "testflat");
lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  // HORA_FORZADA=13 (mediodía real): sin esto, la rutina del pueblo puede
  // tener CASI todo el mundo durmiendo/en casa (npc.visible=false, Three.js
  // ni siquiera prueba el raycast contra ellos) al azar según a qué hora del
  // día de juego arranque el servidor — bug real de este e2e, encontrado con
  // un timeout de 20s esperando a que algún NPC de la aldea nueva saliera.
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaTestflat, BD_RUTA: BD, JARL_NOMBRES: `${NOMBRE_A},${NOMBRE_B},${NOMBRE_C}`, HORA_FORZADA: "13",
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

// Busca un <div> hoja cuyo texto sea EXACTAMENTE `texto` (nametag de
// CSS2DObject, sin envoltorio de más) y devuelve si está visible ahora
// mismo — null si ni siquiera existe todavía en el DOM.
async function visibilidadNombre(page, texto) {
  return page.evaluate((t) => {
    for (const el of document.querySelectorAll("div")) {
      if (el.children.length === 0 && el.textContent === t) {
        return getComputedStyle(el).display !== "none";
      }
    }
    return null;
  }, texto);
}

// `panelInspeccion.ts` marca su raíz con data-testid="panel-inspeccion"
// (mismo criterio que menu-interaccion.ts/cofre-pista) — así se distingue de
// CUALQUIER otro panel abierto que comparta el marco genérico (panelBase.ts).
async function panelVisible(page) {
  return page.evaluate(() => {
    const marco = document.querySelector('[data-testid="panel-inspeccion"]');
    if (!marco || getComputedStyle(marco).display === "none") return null;
    return { titulo: marco.querySelector(".panel-colony-cabecera")?.textContent ?? "", cuerpo: marco.querySelector(".panel-colony-cuerpo")?.textContent ?? "" };
  });
}

// `.includes()` normal puede fallar entre dos strings que se VEN idénticas
// (incluso en JSON.stringify) si una viene en forma Unicode compuesta (NFC,
// "é" = un solo code point) y la otra descompuesta (NFD, "e"+acento
// combinante) — nombres reales con tilde (p.ej. "Marcelino Solé Tura") son
// terreno fértil para esto. `.normalize("NFC")` en ambos lados antes de
// comparar lo evita sin más.
function incluyeNormalizado(texto, sub) {
  return !!texto && texto.normalize("NFC").includes(sub.normalize("NFC"));
}

// La cámara sigue al jugador con un lerp suave (WorldScene.seguirPunto) —
// tras un teleport hace falta esperar a que se asiente antes de proyectar
// mundo->pantalla, o el clic real puede caer unos píxeles fuera del rig por
// el desfase (mismo problema y misma solución ya usados en
// cazaClic.e2e.mjs: comparar proyecciones sucesivas hasta que no se muevan).
// Best-effort a propósito (`.catch`): en terreno "difícil" (cerca de agua,
// tras caminar de verdad para separarse de una NPC) la cámara puede tardar
// más de lo esperado en asentarse del todo, o no asentarse nunca del todo
// por jitter de red — `clicarPorEtiqueta` clica por posición REAL de
// pantalla (nametag) probando varios offsets, así que no vale la pena
// reventar el test entero por esto (bug real de este e2e, no del juego:
// encontrado tras separarse caminando de una NPC junto al agua).
async function esperarCamaraEstable(page) {
  await page
    .waitForFunction(() => {
      const p = window.__proyectarMundo(window.__colonyDebug.x, window.__colonyDebug.y);
      const ok = window.__ultimaProjInspeccion && Math.hypot(window.__ultimaProjInspeccion.x - p.x, window.__ultimaProjInspeccion.y - p.y) < 1.5;
      window.__ultimaProjInspeccion = p;
      return ok;
    }, null, { timeout: 8000, polling: 200 })
    .catch(() => {});
}

// Clic por ETIQUETA en vez de por proyección mundo->pantalla: el nametag
// (CSS2DObject) ya tiene una posición de pantalla real calculada por el
// propio navegador (getBoundingClientRect), así que clicar un poco por
// debajo de él es más robusto que adivinar una altura de mundo — sortea de
// raíz cualquier diferencia de escala/origen entre rigs (`crearRigHumanoide`
// del jugador vs. `crearPersonajeVoxel` de un NPC de poblacion/, distinto
// pipeline de generación) que un y de mundo fijo pueda no cubrir igual.
// (El bug REAL que costó encontrar era otro y ya está cerrado en
// game.ts: el listener de clic entero — menú de interacción, fauna Y esta
// inspección — solo se registraba dentro de `if (SALA === "hub")`, así que
// NINGÚN clic hacía nada en una RegionRoom por bien que se apuntara. Este
// clic por etiqueta se queda de todos modos, es más robusto que adivinar
// una altura de mundo fija.)
async function clicarPorEtiqueta(page, texto, comprobarAbierto) {
  for (const offsetY of [25, 40, 55, 70, 15]) {
    const rect = await page.evaluate((t) => {
      for (const el of document.querySelectorAll("div")) {
        if (el.children.length === 0 && el.textContent === t) {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    }, texto);
    if (!rect) return false;
    await page.mouse.click(rect.x, rect.y + offsetY);
    // POLLING, no un único chequeo a los 250ms fijos: cuando el clic acierta
    // de verdad sobre un NPC, `comprobarAbierto` espera un round-trip real
    // (npc:inspeccionar -> servidor -> npc:info), no solo un cambio local —
    // un chequeo único demasiado pronto puede leer "Cargando" todavía y dar
    // el intento por fallido aunque el clic fuera correcto (bug real de
    // este e2e, encontrado con panelNpc mostrando el contenido CORRECTO
    // justo después de que el intento ya se hubiera marcado como fallido).
    // 3500ms de margen por intento: bajo este sandbox (sin GPU, WebGL por
    // software) el round-trip real npc:inspeccionar->servidor->npc:info
    // puede tardar más que una ventana corta — 1200ms daba falsos NEGATIVOS
    // reproducibles (el panel final SIEMPRE mostraba el contenido correcto,
    // solo el bucle de sondeo de ESTE intento no llegaba a verlo a tiempo).
    const inicio = Date.now();
    while (Date.now() - inicio < 3500) {
      if (await comprobarAbierto()) return true;
      await page.waitForTimeout(100);
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  return false;
}

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const pageA = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const pageB = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const erroresA = [];
  pageA.on("pageerror", (e) => erroresA.push(String(e)));

  console.log("1) A y B entran a testflat (ambos spawnean en el mismo punto)...");
  await pageA.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_A}`, { waitUntil: "commit", timeout: 120000 });
  await pageB.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_B}`, { waitUntil: "commit", timeout: 120000 });
  await pageA.waitForFunction(() => window.__colonyDebug && window.__test && window.__jugadores && window.__npcs, null, { timeout: 30000 });
  await pageB.waitForFunction(() => window.__colonyDebug && window.__test, null, { timeout: 30000 });
  await pageA.waitForFunction(() => window.__jugadores().length >= 2, null, { timeout: 20000 });
  await esperar(500); // un par de patches de red + un frame de render para que la histéresis del nombre se resuelva

  console.log("2) juntos (mismo spawn) — el nombre de B debe verse en la pantalla de A...");
  comprobar("nombre de B visible con A al lado", await visibilidadNombre(pageA, NOMBRE_B) === true);

  console.log("3) B se teleporta lejos (fuera del radio de 15 de histéresis)...");
  const posA = (await pageA.evaluate(() => window.__jugadores().find((j) => j.nombre === "InspA")));
  await pageB.evaluate((p) => window.__test.enviar("admin:debug:teleport", { x: p.x + 40, y: p.y + 40 }), posA);
  await pageA.waitForFunction((p) => { const b = window.__jugadores().find((j) => j.nombre === "InspB"); return b && Math.hypot(b.x - p.x, b.y - p.y) > 30; }, posA, { timeout: 15000 });
  // La posición REAL (servidor) ya está lejos, pero la visual del cliente
  // llega interpolada con un lerp suave (game.ts, factor=1-exp(-12*dt)) — un
  // salto de 56 unidades tarda unos cientos de ms en "alcanzar" visualmente
  // el destino real; se espera con polling a que el nombre desaparezca, en
  // vez de un sleep fijo que puede pillar el cliente a mitad de camino.
  const ocultoTrasAlejarse = await pageA
    .waitForFunction((texto) => {
      for (const el of document.querySelectorAll("div")) {
        if (el.children.length === 0 && el.textContent === texto) return getComputedStyle(el).display === "none";
      }
      return false;
    }, NOMBRE_B, { timeout: 8000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  comprobar("nombre de B OCULTO tras alejarse (histéresis real, sin simular)", ocultoTrasAlejarse);
  await pageA.screenshot({ path: join(capturas, "inspeccion_1_nombre_oculto.png"), timeout: 45000 }).catch(() => {});

  console.log("4) B vuelve cerca de A...");
  await pageB.evaluate((p) => window.__test.enviar("admin:debug:teleport", { x: p.x + 2, y: p.y }), posA);
  await pageA.waitForFunction((p) => { const b = window.__jugadores().find((j) => j.nombre === "InspB"); return b && Math.hypot(b.x - p.x, b.y - p.y) < 5; }, posA, { timeout: 15000 });
  const visibleTrasVolver = await pageA
    .waitForFunction((texto) => {
      for (const el of document.querySelectorAll("div")) {
        if (el.children.length === 0 && el.textContent === texto) return getComputedStyle(el).display !== "none";
      }
      return false;
    }, NOMBRE_B, { timeout: 8000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  comprobar("nombre de B visible otra vez al volver cerca", visibleTrasVolver);

  console.log("5) A clica sobre B (rig real, sin bypass) — debe abrir el panel de inspección con su nombre...");
  await esperarCamaraEstable(pageA);
  const abrioJugador = await clicarPorEtiqueta(
    pageA,
    NOMBRE_B,
    // Comprueba el TÍTULO, no solo "algún panel abierto" — A está parado a
    // solo ~2 casillas de B (mismo spawn), así que un intento con el offset
    // equivocado podría acabar clicando el propio rig de A en vez del de B
    // (bug real de este e2e, encontrado al ver "InspA" en el panel de un
    // clic que debía abrir el de B).
    () => panelVisible(pageA).then((p) => !!p?.titulo?.includes(NOMBRE_B)),
  );
  const panelJugador = await panelVisible(pageA);
  comprobar("panel abierto tras clicar a B", abrioJugador && !!panelJugador, JSON.stringify(panelJugador));
  comprobar("panel muestra el nombre real de B", !!panelJugador?.titulo?.includes(NOMBRE_B), panelJugador?.titulo);
  comprobar("panel muestra 'Sin oficio' (B no ha elegido ninguno)", !!panelJugador?.cuerpo?.includes("Sin oficio"), panelJugador?.cuerpo);
  await pageA.screenshot({ path: join(capturas, "inspeccion_2_jugador.png"), timeout: 45000 }).catch(() => {});

  console.log("6) C entra a la aldea EFÍMERA (solo civiles reales) y clica a un vecino — round-trip npc:inspeccionar real...");
  const pageC = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const erroresC = [];
  pageC.on("pageerror", (e) => erroresC.push(String(e)));
  await pageC.goto(`http://localhost:${PUERTO_WEB}/?nombre=${NOMBRE_C}&sala=region&mapaId=${NOMBRE_MAPA_ALDEA}`, { waitUntil: "commit", timeout: 120000 });
  await pageC.waitForFunction(() => window.__colonyDebug && window.__test && window.__npcs && window.__proyectarMundo, null, { timeout: 30000 });
  // Aldea recién horneada: SOLO población civil real de poblacion/ — a
  // diferencia de testflat (Test Zone), aquí no hay dummies de combate
  // (hostil:true, agro automático real) ni NPCs "tutorial" pegados a una
  // puerta — cualquier NPC visible es seguro de acercarse y clicar.
  await pageC.waitForFunction(() => window.__npcs().lista.some((n) => n.visible), null, { timeout: 20000, polling: 500 }).catch(() => {});
  // Prefiere una NPC AISLADA (sin otra visible a <3 casillas) — la captura
  // real de un intento fallido mostró 4 vecinas apiñadas casi en la misma
  // casilla (punto de reunión del pueblo), con las etiquetas de nombre
  // literalmente superpuestas — clicar ahí es ambiguo de verdad (el rayo
  // puede colar entre modelos pequeños o acertar a la vecina equivocada),
  // no un fallo del propio clic. Si NINGUNA está aislada, cae a la primera
  // visible igualmente (mejor intentarlo que no probar nada).
  const npc = await pageC.evaluate(() => {
    const visibles = window.__npcs().lista.filter((n) => n.visible);
    const aislada = visibles.find((n) => !visibles.some((otra) => otra.id !== n.id && Math.hypot(otra.x - n.x, otra.y - n.y) < 3));
    return aislada ?? visibles[0];
  });
  comprobar("hay al menos un NPC visible en la aldea para probar", !!npc, JSON.stringify(npc));
  if (npc) {
    // Ni la MISMA casilla (bug real encontrado: el rig de C, literalmente
    // coincidente con el de la NPC, gana el raycast SIEMPRE — ningún reintento
    // de offset en `clicarPorEtiqueta` puede separar dos siluetas en el
    // mismo punto) ni un offset fijo tipo "-3,-3" (otro bug real: en una
    // aldea horneada de nuevas puede caer dentro de un edificio/muro, y
    // `casillaPisableMasCercana` empuja al jugador lejos de verdad). Se
    // prueba VARIAS direcciones (offsets calculados a mano fallaron dos veces
    // seguidas: uno cayó "dentro" de algo y `casillaPisableMasCercana`
    // empujó al jugador lejos de verdad, otro simplemente no había ningún
    // sitio pisable ahí). En vez de adivinar coordenadas, se teleporta
    // encima de la NPC (SIEMPRE pisable, ella está de pie ahí) y se CAMINA
    // un poco de verdad ("input" real, mismo mensaje que manda el cliente al
    // pulsar WASD) — el propio movimiento respeta la colisión real sin
    // "saltar lejos" nunca: como mucho no avanza si hay un obstáculo justo
    // al lado, nunca termina en un sitio inesperado.
    await pageC.evaluate((n) => window.__test.enviar("admin:debug:teleport", { x: n.x, y: n.y }), npc);
    const DIRECCIONES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
    let cerca = false;
    for (let intento = 0; intento < DIRECCIONES.length && !cerca; intento++) {
      const [dx, dy] = DIRECCIONES[intento];
      await pageC.evaluate(({ dx, dy }) => window.__test.enviar("input", { x: dx, y: dy, correr: false }), { dx, dy });
      await pageC.waitForTimeout(500);
      await pageC.evaluate(() => window.__test.enviar("input", { x: 0, y: 0, correr: false }));
      await pageC.waitForTimeout(150); // deja que el último patch de posición llegue antes de medir
      cerca = await pageC.evaluate((id) => {
        const n = window.__npcs().lista.find((x) => x.id === id);
        if (!n) return false;
        const d = Math.hypot(window.__colonyDebug.x - n.x, window.__colonyDebug.y - n.y);
        return d > 0.6; // ya no está en su misma casilla (evita taparla en el raycast) — no hace falta alejarse mucho, solo separarse
      }, npc.id);
    }
    comprobar("A se separó de la NPC caminando de verdad (sin teleport a ciegas)", cerca);
    await esperarCamaraEstable(pageC);
    const abrioNpc = await clicarPorEtiqueta(
      pageC,
      npc.nombre,
      // Comprueba el TÍTULO (nombre real de la NPC), no solo "algún panel
      // abierto" — mismo motivo que el chequeo de B más arriba.
      () => panelVisible(pageC).then((p) => incluyeNormalizado(p?.titulo, npc.nombre) && !p.cuerpo.includes("Cargando")),
    );
    await esperar(200); // margen extra tras el round-trip real npc:inspeccionar -> npc:info
    const panelNpc = await panelVisible(pageC);
    comprobar("panel abierto tras clicar al NPC, con su nombre real", abrioNpc && incluyeNormalizado(panelNpc?.titulo, npc.nombre), JSON.stringify(panelNpc));
    comprobar("panel del NPC ya no dice 'Cargando…' (llegó la respuesta real del servidor)", !panelNpc?.cuerpo?.includes("Cargando"), panelNpc?.cuerpo);
    comprobar("panel muestra una fila de Oficio", !!panelNpc?.cuerpo?.includes("Oficio"), panelNpc?.cuerpo);
    comprobar("panel muestra la ciudad real (Aldea pequeña)", !!panelNpc?.cuerpo?.includes("Aldea pequeña"), panelNpc?.cuerpo);
    await pageC.screenshot({ path: join(capturas, "inspeccion_3_npc.png"), timeout: 45000 }).catch(() => {});
  }
  comprobar("sin errores de JS en la página de C", erroresC.length === 0, erroresC.join(" | "));

  comprobar("sin errores de JS en la página de A", erroresA.length === 0, erroresA.join(" | "));

  console.log(fallos === 0 ? "\n✅ panelInspeccion.e2e: todo OK" : `\n❌ panelInspeccion.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("panelInspeccion.e2e reventó:", err);
  process.exit(1);
} finally {
  if (browser) await browser.close();
}
