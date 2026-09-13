"use strict";

// E2E VISUAL de "Lootear" por clic sobre un cadáver del MUNDO (auditoría de
// interacciones 2026-09-13, mismo patrón que mascotaMonturaClic.e2e.cjs/
// barcoClic.e2e.cjs). Hallazgo real: `L` (cadaverMasCercano) ya manda un
// `cadaverId` REAL al servidor (manejarCadaverLootear siempre exigió un id
// explícito, nunca "auto-apuntar") — pero clicar un cadáver directamente
// nunca ofrecía "Lootear", solo abría el panel de inspección. El fix es
// puro cliente: `cadaveresVisual` (Map nuevo) + userData.cadaverId + una
// rama de menú, cero cambio de servidor.
//
// Reusa el patrón ya probado de client/test/cadaveresVisual.e2e.cjs: login
// HTTP real de superadmin, `admin:debug:matar {tipo:"fauna", id}` sobre
// fauna real del mapa demo para producir un Cadaver real (con contenedor
// real, no un mock), `admin:debug:teleport` para garantizar estar dentro
// de RADIO_INTERACCION del cadáver antes de clicarlo.
//
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/cadaverClic.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const PUERTO_WS = 2568; // distinto del 2567 que usa cadaveresVisual.e2e.cjs, para poder correr ambos sin chocar
const PUERTO_WEB = 5199;
const USUARIO_SUPERADMIN = "superadmin";
const PASSWORD_SUPERADMIN = "colony-superadmin-2026";

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

async function esperarCondicion(fn, timeoutMs, intervaloMs = 300) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const v = await fn();
    if (v) return v;
    await esperar(intervaloMs);
  }
  return null;
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
    // BD_RUTA=":memory:" (mismo criterio que cadaveresVisual.e2e.cjs) —
    // sin esto, el servidor cae a la BD de dev persistente y un cadáver de
    // una ejecución ANTERIOR de este mismo test reaparece al arrancar
    // (HubRoom.onCreate recarga cadáveres persistidos), contaminando la
    // fauna/cadáver "real" de la pasada actual. Encontrado de verdad
    // depurando este mismo test (dos ejecuciones seguidas, el segundo
    // cadáver leído era el de la primera).
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {
      PORT: String(PUERTO_WS), RUTA_MAPA: path.join(RAIZ, "assets", "mapas", "demo"), BD_RUTA: ":memory:",
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_WEB), "--strictPort"], path.join(RAIZ, "client"), {
      VITE_COLYSEUS_URL: `ws://localhost:${PUERTO_WS}`, VITE_RUTA_MAPA: "/assets/mapas/demo",
    });
    await esperarPuerto(`http://localhost:${PUERTO_WS}/`);
    await esperarPuerto(`http://localhost:${PUERTO_WEB}/`);

    console.log("0) login HTTP real de superadmin (para admin:debug:matar/teleport)...");
    const loginR = await fetch(`http://localhost:${PUERTO_WS}/auth/admin/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: USUARIO_SUPERADMIN, password: PASSWORD_SUPERADMIN }),
    });
    const loginDatos = await loginR.json().catch(() => null);
    comprobar("login de superadmin -> token", loginR.status === 200 && !!loginDatos?.token, JSON.stringify(loginDatos));
    if (!loginDatos?.token) throw new Error("sin token de superadmin, no se puede seguir");
    const token = loginDatos.token;

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const erroresConsola = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(t)) erroresConsola.push(t);
    });
    page.on("pageerror", (err) => erroresConsola.push(String(err)));

    console.log("1) cargando cliente real como superadmin...");
    await page.goto(`http://localhost:${PUERTO_WEB}/?nombre=CadaverClicTester&adminSession=${token}`);
    await page.waitForFunction(() => !!window.__colonyDebug, null, { timeout: 20000 });
    // El panel "Guía y novedades" (docs/GDD_UI_Paneles.md §14, 2026-09-13)
    // se auto-abre CENTRADO en un navegador sin preferencia guardada.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="panel-tutorial"]');
      return !el || getComputedStyle(el).display === "none";
    }, null, { timeout: 5000 }).catch(() => {});

    console.log("2) matando fauna real del mapa demo (admin:debug:matar) para producir un cadáver real...");
    const objetivo = await esperarCondicion(async () => {
      const lista = await page.evaluate(() => window.__fauna?.() ?? []);
      return lista[0] ?? null;
    }, 20000, 1000);
    comprobar("aparece fauna salvaje activa en el mapa demo", !!objetivo, JSON.stringify(objetivo));
    if (!objetivo) throw new Error("sin fauna activa, no se puede producir un cadáver");
    await page.evaluate((id) => window.__test.enviar("admin:debug:matar", { tipo: "fauna", id }), objetivo.id);
    const cadaveres = await esperarCondicion(async () => {
      const lista = await page.evaluate(() => window.__cadaveres?.() ?? []);
      return lista.length > 0 ? lista : null;
    }, 8000, 500);
    const animalMuerto = (cadaveres || []).find((c) => c.tipoOrigen === "animal");
    comprobar("admin:debug:matar crea un Cadaver real en state.cadaveres", !!animalMuerto, JSON.stringify(cadaveres));
    if (!animalMuerto) throw new Error("no se generó ningún cadáver");

    console.log("3) teletransportando al jugador junto al cadáver (garantiza RADIO_INTERACCION)...");
    await page.evaluate((c) => window.__test.enviar("admin:debug:teleport", { x: c.x, y: c.y }), animalMuerto);
    await esperar(500);

    console.log("4) clicando la posición real del cadáver (proyección mundo→pantalla): 'Lootear'...");
    const menuSel = '[data-testid="menu-interaccion"]';
    // Un cadáver "caído" (crearAnimalVoxel, opciones.caido) se rota 90° en Z
    // y se sube según su propio ancho — su masa visual real NO está
    // centrada sobre `cadaver.x,y` como pasaba con mascota/barco (rig de
    // pie, simétrico), queda desplazada hacia un lado según la especie y el
    // "lado" aleatorio del volcado (hash del id). En vez de adivinar
    // alturas+jitter a ciegas (encontrado real: 25 combinaciones con
    // ±0.25 de jitter fallaron contra un arrendajo desplazado ~0.3 en X),
    // se usa `window.__cadaverBBox(id)` (sonda nueva, mismo criterio que
    // `__proyectarMundo` — no lee nada que un jugador real no vea, solo
    // calcula la caja delimitadora real del mismo Object3D que ya está en
    // la escena) para clicar el CENTRO real de la caja, sea cual sea la
    // especie/rotación. Con pequeño jitter alrededor de ese centro por si
    // cae justo en un hueco vacío del vóxel (un modelo no es sólido).
    const bbox = await page.evaluate((id) => window.__cadaverBBox?.(id), animalMuerto.id);
    comprobar("se pudo leer la caja delimitadora real del cadáver (sonda __cadaverBBox)", !!bbox, JSON.stringify(bbox));
    if (!bbox) throw new Error("sin bbox, no se puede calcular dónde clicar");
    const centro = { x: (bbox.min[0] + bbox.max[0]) / 2, y: (bbox.min[1] + bbox.max[1]) / 2, z: (bbox.min[2] + bbox.max[2]) / 2 };
    const JITTER = [[0, 0], [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05], [0.05, 0.05], [-0.05, -0.05]];
    let opcionesMenu = "";
    for (const [jx, jz] of JITTER) {
      const px = await page.evaluate(([x, y, h]) => window.__proyectarMundo(x, y, h), [centro.x + jx, centro.z + jz, centro.y]);
      await page.mouse.click(px.x, px.y);
      await esperar(200);
      const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === "none") return null;
        return el.textContent || "";
      }, menuSel);
      if (info != null) { opcionesMenu = info; break; }
      await page.keyboard.press("Escape");
      await esperar(150);
    }
    const menuConLootear = /Lootear/.test(opcionesMenu);
    comprobar("el menú al clicar el cadáver ofrece 'Lootear'", menuConLootear, opcionesMenu.slice(0, 200));
    if (!menuConLootear) throw new Error("no se encontró el cadáver clicando su posición real");

    console.log("5) clicando 'Lootear' — debe mandar cadaver:lootear con el id REAL del clicado...");
    await page.locator(`${menuSel} >> text=Lootear`).click();
    const lootado = await esperarCondicion(
      () => page.evaluate(() => window.__test.ultimoMensaje("cadaver:lootado")),
      5000, 200,
    );
    comprobar("el servidor responde cadaver:lootado (el round-trip clic->cadaver:lootear funciona)", !!lootado, JSON.stringify(lootado));

    comprobar("sin errores de consola/página durante todo el flujo", erroresConsola.length === 0, erroresConsola.slice(0, 5).join(" | "));

    console.log(`\n=== RESUMEN: lootear un cadáver por clic ya funciona ===`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n✅ cadaverClic.e2e: TODO OK" : `\n❌ cadaverClic.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el e2e:", err);
    process.exit(1);
  });
