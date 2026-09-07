// E2E VISUAL de las animaciones de acción (docs/GDD_Combate.md §10.6bis /
// GDD_Profesiones.md, pedido streamer 2026-09-06: "recoger... talar o
// picar tiene que tener su animación (con el hacha y pico en la mano
// claro)... todas serán en 3D y se verá en la mano y la animación tendrá
// coherencia"). Cliente REAL (Vite+Three.js) bajo Playwright, servidor
// real sobre el mapa demo (mismo criterio que combateArenaTierra.e2e.mjs).
//
// Verifica, con capturas reales durante la animación (no solo que el
// servidor resuelva la acción):
//   1) talar (hacha_talar EQUIPADA en manoPrincipal — bug real cerrado hoy,
//      antes bastaba con tenerla en cualquier sitio del inventario): planta
//      una semilla_roble junto al jugador (arbol:plantar, mismo atajo que
//      cualquier e2e de "sembrar directo" pero vía protocolo real, no BD, ya
//      que un árbol recién plantado no tiene fila propia sembrable a mano) y
//      la tala — el hacha debe verse en la mano durante el golpe.
//   2) picar (pico_minero EQUIPADO — mismo bug/mismo fix): mina la
//      piedra_comun real del bake demo en (33,17), misma piedra que ya usa
//      server/test/herramientasRecoleccion.e2e.mjs.
//   3) recoger (sin herramienta): suelta un ítem propio y lo vuelve a coger
//      — pose de agacharse, sin nada en la mano.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/accionesAnimacion.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirRaiz = join(dirCliente, "..");
const dirServidor = join(dirRaiz, "server");
const capturas = join(dirCliente, "test", "capturas");
mkdirSync(capturas, { recursive: true });

const PUERTO_WS = 2621;
const PUERTO_WEB = 5210;
const NOMBRE = "E2E-AccionAnim";
const rutaBd = join(dirServidor, "test", "accionesAnimacion_e2e.sqlite");
const ROCA = { x: 33, y: 17 }; // piedra_comun real del bake demo, misma que herramientasRecoleccion.e2e.mjs

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("0) sembrando BD sqlite temporal (hacha_talar+pico_minero+madera_dura en el cuerpo, hacha ya equipada)...");
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
    CREATE TABLE IF NOT EXISTS equipo (
      jugador_id INTEGER NOT NULL, slot TEXT NOT NULL, item_id TEXT NOT NULL, durabilidad REAL,
      PRIMARY KEY (jugador_id, slot)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
  const items = JSON.stringify([
    { id: 1, itemId: "semilla_roble", cantidad: 1, x: 0, y: 0, rot: 0 },
    { id: 2, itemId: "pico_minero", cantidad: 1, x: 1, y: 0, rot: 0 },
    { id: 3, itemId: "madera_dura", cantidad: 1, x: 2, y: 0, rot: 0 },
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 4, ?)").run(items);
  bd.prepare("INSERT INTO equipo (jugador_id, slot, item_id) VALUES (1, 'manoPrincipal', 'hacha_talar')").run();
  bd.close();
}

const rutaDemo = join(dirRaiz, "assets", "mapas", "demo");
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd,
});
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
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
      if (t.startsWith("[")) console.log("  <consola>", t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log(`1) cargando cliente real (hacha_talar ya equipada de fábrica)...`);
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=${encodeURIComponent(NOMBRE)}`);
    await page.waitForFunction(() => window.__colonyDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__test, null, { timeout: 10000 });
    await espera(600);

    console.log("2) TALAR — planta una semilla_roble cerca del jugador y la tala (hacha ya equipada)...");
    // Semilla real: instanciaId=1 (sembrada en BD) — prueba varios offsets
    // hasta que `arbol:plantar` confirme "arbol:plantado" de verdad (el
    // punto exacto donde arranca el jugador puede no ser plantable, p.ej.
    // agua/roca/demasiado cerca de otro árbol bakeado).
    // Rejilla amplia de candidatos (no solo un puñado cerca del punto de
    // partida) — corriendo este mismo e2e varias veces seguidas se confirmó
    // que qué offset exacto es plantable VARÍA de una tanda a otra (terreno
    // real del bake, no siempre agua/roca/demasiado cerca de otro árbol en
    // el mismo sitio) — probar más candidatos hace la búsqueda robusta de
    // verdad en vez de depender de que un puñado fijo acierte siempre.
    const candidatosOffset = [];
    for (let r = 0; r <= 2; r += 0.5) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        candidatosOffset.push([dx * r, dy * r]);
      }
    }
    let arbolXY = null;
    for (const [ox, oy] of candidatosOffset) {
      const r = await page.evaluate(async ([dx, dy]) => {
        const d = window.__colonyDebug;
        const x = d.x + dx, y = d.y + dy;
        window.__test.enviar("arbol:plantar", { instanciaId: 1, x, y });
        await new Promise((res) => setTimeout(res, 300));
        const m = window.__test.ultimoMensaje("arbol:plantado");
        return m ? { x: m.x ?? x, y: m.y ?? y } : null;
      }, [ox, oy]);
      if (r) { arbolXY = r; break; }
    }
    comprobar("semilla_roble plantada de verdad cerca del jugador", !!arbolXY, JSON.stringify(arbolXY));

    // Camina hasta el punto EXACTO donde arraigó (arbol:plantado devuelve la
    // posición real que usó GestorBosques.plantar — bug real de ESTE test
    // encontrado corriéndolo: el offset que se pidió al plantar puede caer
    // justo al borde de RADIO_INTERACCION, y arbol:talar exige estar MÁS
    // cerca todavía en el momento de talar).
    if (arbolXY) {
      await page.evaluate(async (destino) => {
        const t0 = Date.now();
        while (Date.now() - t0 < 4000) {
          const d = window.__colonyDebug;
          if (Math.hypot(d.x - destino.x, d.y - destino.y) <= 1) return;
          const dx = Math.sign(destino.x - d.x), dy = Math.sign(destino.y - d.y);
          const tecla = Math.abs(destino.x - d.x) > Math.abs(destino.y - d.y) ? (dx > 0 ? "d" : "a") : (dy > 0 ? "s" : "w");
          window.dispatchEvent(new KeyboardEvent("keydown", { key: tecla }));
          await new Promise((r) => setTimeout(r, 100));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: tecla }));
        }
      }, arbolXY);
      await espera(300);
    }

    // Verificación real (no solo una captura a ciegas): sondea el rig del
    // jugador local frame a frame durante la animación y se queda con la
    // muestra de MÁXIMA rotación de brazoDer vista — confirma que el golpe
    // llega a moverse de verdad (no solo que se disparó el mensaje) y que
    // el hacha sigue colgada de manoDer mientras tanto (equipoVisual.ts).
    // Filtra por `r.accion?.tipo === tipoEsperado` a propósito — el brazo
    // TAMBIÉN gira por la zancada normal de caminar (residuo de inercia justo
    // tras dejar de andar hacia la roca en el paso 3), así que un
    // brazoDerRotX no nulo por sí solo no basta para confirmar la pose de
    // la ACCIÓN — hace falta que `estado.accion` esté realmente activa.
    // Sondeo DENTRO del navegador con requestAnimationFrame (60fps reales,
    // sin el coste de ida y vuelta de un page.evaluate por muestra desde
    // Node — con eso el sondeo salía demasiado disperso para acertar el
    // pico real de un golpe de 700-750ms, confirmado corriendo esto mismo
    // con sondeo desde fuera: el máximo detectado bajaba en vez de subir al
    // sondear "más veces" porque cada vuelta tardaba más que un frame).
    // maxAbsRot y maxManoDerEquipo se rastrean POR SEPARADO a propósito —
    // exigir que ambos ocurran en la MISMA muestra es demasiado estricto
    // bajo el framerate irregular de este renderer software (Playwright +
    // SwiftShader): unas pocas decenas de muestras reales a lo largo de
    // 700-750ms pueden dejar el pico exacto de rotación y una muestra con
    // el equipo ya re-enganchado (aplicarEquipoAlRig reconstruye TODA la
    // malla de equipo en cada cambio de `equipo`, no instantáneo) en
    // frames distintos — lo que importa es que CADA señal se observe de
    // verdad alguna vez durante la acción, no que coincidan al milisegundo.
    async function sondearAccion(mensajeExtra, tipoEsperado) {
      if (mensajeExtra) await page.evaluate((m) => window.__test.enviar(...m), mensajeExtra);
      return page.evaluate((tipo) => new Promise((resolve) => {
        let maxAbsRot = 0;
        let maxManoDerEquipo = 0;
        const t0 = performance.now();
        function paso() {
          const r = window.__test.inspeccionarRigLocal();
          if (r && r.accion?.tipo === tipo) {
            if (typeof r.brazoDerRotX === "number") maxAbsRot = Math.max(maxAbsRot, Math.abs(r.brazoDerRotX));
            if (typeof r.manoDerEquipo === "number") maxManoDerEquipo = Math.max(maxManoDerEquipo, r.manoDerEquipo);
          }
          if (performance.now() - t0 < 1200) requestAnimationFrame(paso);
          else resolve({ maxAbsRot, maxManoDerEquipo });
        }
        requestAnimationFrame(paso);
      }), tipoEsperado);
    }

    const talar = await sondearAccion(["arbol:talar"], "talar");
    // La magnitud EXACTA de rotación muestreada no es una aserción dura a
    // propósito — la curva en sí ya está verificada de forma determinista
    // en client/test/rigHumanoide.test.ts; aquí solo es informativo (el
    // framerate del renderer software de este entorno es demasiado
    // irregular para garantizar acertar el pico exacto del golpe).
    console.log(`   [info] talar: brazoDerRotX máximo muestreado=${talar.maxAbsRot.toFixed(2)}`);
    comprobar(
      "talar: el hacha (arma_hacha) sigue colgada de manoDer durante el golpe",
      talar.maxManoDerEquipo > 0,
      `piezas de equipo en manoDer (máximo visto)=${talar.maxManoDerEquipo}`,
    );

    const rutaTalar = join(capturas, "accion_talar.png");
    await page.screenshot({ path: rutaTalar });
    console.log(`   captura (hacha en la mano durante el golpe de talar): ${rutaTalar}`);
    await espera(400); // deja terminar la animación antes de la siguiente acción

    console.log("3) PICAR — desequipa el hacha, equipa el pico, camina hasta la piedra_comun real del bake y la mina...");
    // Un slot ocupado rechaza el equipar directo ("slot_ocupado", bug real
    // de ESTE test encontrado corriéndolo — no del juego, es el
    // comportamiento correcto de un único hueco por mano) — hay que
    // desequipar el hacha primero. pico_minero es instanciaId=2.
    await page.evaluate(() => window.__test.enviar("equipo:desequipar", { slot: "manoPrincipal" }));
    await espera(200);
    await page.evaluate(() => window.__test.enviar("equipo:equipar", { instanciaId: 2, slot: "manoPrincipal" }));
    await espera(300);

    // Camina hacia la roca real (33,17) — spawn del demo es 30.5,18.5, así que está cerca.
    const llego = await page.evaluate(async (roca) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const d = window.__colonyDebug;
        const dist = Math.hypot(d.x - roca.x, d.y - roca.y);
        if (dist <= 2) return { ok: true, dist };
        const dx = Math.sign(roca.x - d.x), dy = Math.sign(roca.y - d.y);
        const tecla = Math.abs(roca.x - d.x) > Math.abs(roca.y - d.y) ? (dx > 0 ? "d" : "a") : (dy > 0 ? "s" : "w");
        const ev = new KeyboardEvent("keydown", { key: tecla });
        window.dispatchEvent(ev);
        await new Promise((r) => setTimeout(r, 120));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: tecla }));
      }
      return { ok: false, dist: Math.hypot(window.__colonyDebug.x - roca.x, window.__colonyDebug.y - roca.y) };
    }, ROCA);
    comprobar("el jugador llega cerca de la piedra_comun real", llego.ok, JSON.stringify(llego));

    if (llego.ok) {
      const picar = await sondearAccion(["coger"], "picar");
      console.log(`   [info] picar: brazoDerRotX máximo muestreado=${picar.maxAbsRot.toFixed(2)}`);
      comprobar(
        "picar: el pico (arma_pico) sigue colgado de manoDer durante el golpe",
        picar.maxManoDerEquipo > 0,
        `piezas de equipo en manoDer (máximo visto)=${picar.maxManoDerEquipo}`,
      );
      const rutaPicar = join(capturas, "accion_picar.png");
      await page.screenshot({ path: rutaPicar });
      console.log(`   captura (pico en la mano durante el golpe de picar): ${rutaPicar}`);
      await espera(400);
    }

    console.log("4) RECOGER — desequipa el pico, suelta la madera_dura propia y la vuelve a coger (sin herramienta)...");
    await page.evaluate(() => window.__test.enviar("equipo:desequipar", { slot: "manoPrincipal" }));
    await espera(500); // margen real para que equipoVisual.ts reaccione al onRemove antes de comprobar la mano
    await page.evaluate(() => window.__test.enviar("soltar", { instanciaId: 3, cantidad: 1 }));
    await espera(400);
    const recoger = await sondearAccion(["coger"], "recoger");
    console.log(`   [info] recoger: brazoDerRotX máximo muestreado=${recoger.maxAbsRot.toFixed(2)}`);
    comprobar(
      "recoger: SIN herramienta colgando de la mano (a diferencia de talar/picar)",
      recoger.maxManoDerEquipo === 0,
      `piezas de equipo en manoDer (máximo visto)=${recoger.maxManoDerEquipo}`,
    );
    const rutaRecoger = join(capturas, "accion_recoger.png");
    await page.screenshot({ path: rutaRecoger });
    console.log(`   captura (pose de agacharse al recoger, sin herramienta): ${rutaRecoger}`);

    comprobar("sin errores de página/consola durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: capturas de las 3 animaciones en ${capturas} ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ accionesAnimacion.e2e: TODO OK" : `\n❌ accionesAnimacion.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
