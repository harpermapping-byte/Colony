// Huellas de nieve (huellasNieve.ts, pedido streamer 2026-09-11) —
// verificación de integración real: servidor+cliente reales, forzando nieve
// al máximo (`?nieve=4`) y moviendo al jugador de verdad con el teclado,
// confirmando con `window.__colorNieveEn(x,y)` que el píxel de la máscara
// de nieve bajo sus pies deja de ser blanco puro tras pisarlo — la lógica
// pura (temporizador/caché/no repintar la misma casilla) ya la cubre
// `client/test/huellasNieve.test.ts`; esto confirma que el cableado real
// en `game.ts` (posición interpolada -> `registrarPisada` -> canvas real de
// Three.js) funciona de punta a punta, no solo en aislado.
//   node test/huellasNieve.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2603;
const PUERTO_WEB = 5203;

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo");
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA: rutaDemo, DIA_FORZADO: "262", HORA_FORZADA: "13",
});
const vite = lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], dirCliente, {
  VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
});
const matar = () => {
  for (const p of [servidor, vite]) {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  }
};
process.on("exit", matar);

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  console.log(`${ok ? "OK" : "FALLO"} ${nombre}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos++;
};

try {
  await new Promise((r) => setTimeout(r, 3500));
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const errores = [];

  // 1) Con nieve al máximo: caminar deja huella real.
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    // Solo `pageerror` (excepciones JS reales), no `console`-tipo-error: en
    // este sandbox sin salida a internet, la fuente Cinzel de Google Fonts
    // falla con ERR_CONNECTION_RESET de forma benigna y consistente — mismo
    // criterio ya establecido en el resto de e2e del proyecto (nieveNiveles.e2e.mjs).
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(`http://localhost:${PUERTO_WEB}/?dia=262&hora=13&nieve=4`, { waitUntil: "load", timeout: 20000 });
    await page.waitForFunction(() => (window).__jugadores && (window).__jugadores().length > 0, { timeout: 20000 });
    // el sector que contiene al jugador tarda un instante en materializarse
    // (fetch async del streaming) — esperar a que la sonda deje de dar null.
    await page.waitForFunction(() => {
      const j = (window).__jugadores()[0];
      return (window).__colorNieveEn(j.x, j.y) !== null;
    }, { timeout: 20000 });

    const antes = await page.evaluate(() => {
      const j = (window).__jugadores()[0];
      return { x: j.x, y: j.y, color: (window).__colorNieveEn(j.x, j.y) };
    });
    comprobar("nieve intacta (blanca) antes de pisar", antes.color !== null && antes.color[0] === 255 && antes.color[1] === 255 && antes.color[2] === 255, JSON.stringify(antes.color));

    // camina un rato en una dirección
    await page.keyboard.down("d");
    await page.waitForTimeout(1800);
    await page.keyboard.up("d");
    await page.waitForTimeout(300); // deja que la interpolación se asiente

    const despues = await page.evaluate(() => {
      const j = (window).__jugadores()[0];
      return { x: j.x, y: j.y };
    });
    comprobar("el jugador se movió de verdad (no se quedó en el mismo sitio)", Math.hypot(despues.x - antes.x, despues.y - antes.y) > 0.5, `${antes.x.toFixed(2)},${antes.y.toFixed(2)} -> ${despues.x.toFixed(2)},${despues.y.toFixed(2)}`);

    // La posición VISUAL interpolada (la que de verdad decide dónde se
    // pinta la huella, `estado.x/estado.z` en game.ts) persigue con
    // suavizado exponencial la posición autoritativa del servidor
    // (`__jugadores()[0].x/y`) — nunca coinciden al frame exacto, así que
    // comprobar solo la casilla FINAL es fràgil (un frame de diferencia
    // basta para que aún no haya llegado). Se comprueba en su lugar
    // cualquier casilla del tramo recorrido (antes.x .. despues.x): la
    // huella real tiene que estar en AL MENOS una de ellas.
    const tramo = await page.evaluate((rango) => {
      const [desde, hasta] = rango;
      const colores = [];
      for (let gx = Math.floor(desde) - 1; gx <= Math.ceil(hasta) + 1; gx++) {
        colores.push({ gx, color: (window).__colorNieveEn(gx + 0.5, 18.5) });
      }
      return colores;
    }, [antes.x, despues.x]);
    const conHuella = tramo.filter((t) => t.color && !(t.color[0] === 255 && t.color[1] === 255 && t.color[2] === 255));
    comprobar(
      "al menos una casilla del tramo recorrido tiene huella real (ya no es blanco puro)",
      conHuella.length > 0,
      JSON.stringify(tramo),
    );

    await page.screenshot({ path: join(dirCliente, "test", "capturas", "huellas_nieve.png") });
    await page.close();
  }

  // 2) Sin nieve acumulada (nivel 0, por defecto): caminar NO deja huella —
  // confirma que el gate `nivelNieveGlobal > 0` funciona de verdad, no solo
  // que el canvas de nieve nunca cambia por otra razón.
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(`http://localhost:${PUERTO_WEB}/?dia=262&hora=13&nieve=0`, { waitUntil: "load", timeout: 20000 });
    await page.waitForFunction(() => (window).__jugadores && (window).__jugadores().length > 0, { timeout: 20000 });
    await page.waitForFunction(() => {
      const j = (window).__jugadores()[0];
      return (window).__colorNieveEn(j.x, j.y) !== null;
    }, { timeout: 20000 });
    await page.keyboard.down("d");
    await page.waitForTimeout(1800);
    await page.keyboard.up("d");
    await page.waitForTimeout(300);
    const j = await page.evaluate(() => (window).__jugadores()[0]);
    const color = await page.evaluate((pos) => (window).__colorNieveEn(pos.x, pos.y), j);
    // sin nieve acumulada la máscara sigue siendo blanca (nunca se pinta huella)
    comprobar("sin nieve acumulada (nivel 0), caminar no pinta ninguna huella", color !== null && color[0] === 255 && color[1] === 255 && color[2] === 255, JSON.stringify(color));
    await page.close();
  }

  if (errores.length) comprobar("sin errores de consola en ninguna página", false, errores.join(" | "));
  else comprobar("sin errores de consola en ninguna página", true);

  await browser.close();
} catch (e) {
  console.log("FALLO excepción:", e);
  fallos++;
} finally {
  matar();
  await new Promise((r) => setTimeout(r, 500));
}

console.log(fallos === 0 ? "\nTODO OK." : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
