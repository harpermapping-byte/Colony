"use strict";
// Verificación VISUAL de que los cadáveres de jugador/NPC/animal salen con
// su modelo real tumbado (docs/GDD_Muerte_Respawn.md, pedido 2026-09-01),
// no la caja genérica de antes. Arranca servidor+cliente reales, hace login
// de superadmin (HTTP real) para poder usar `admin:debug:matar` (Test Zone,
// self-target para jugador; id real de Schema para npc/enemigo/fauna) y
// saltarse un combate entero — el cadáver sale por el MISMO camino
// (`finalizarMuerte`/`manejarMuerteJugador`) que usaría el combate real.
// NO es parte de la suite automática (arranca server+cliente de verdad).
// Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node client/test/cadaveresVisual.e2e.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_cadaveres");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

const PUERTO_WS = 2567; // puerto por defecto del server — el cliente en dev apunta aquí sin configurar nada (client/src/config.ts)
const PUERTO_HTTP_CLIENTE = 5198;
const URL_HTTP_SERVIDOR = `http://localhost:${PUERTO_WS}`;
const USUARIO_SUPERADMIN = "superadmin"; // sembrado por seedAdmin.ts con BD en memoria
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
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, detached: true });
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

  try {
    const rutaDemo = path.join(RAIZ, "assets", "mapas", "demo");
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {
      PORT: String(PUERTO_WS),
      RUTA_MAPA: rutaDemo,
      BD_RUTA: ":memory:",
    });
    lanzar("npx", ["vite", "--port", String(PUERTO_HTTP_CLIENTE), "--strictPort"], path.join(RAIZ, "client"), {});
    await esperarPuerto(`http://localhost:${PUERTO_HTTP_CLIENTE}/`);
    await esperarPuerto(URL_HTTP_SERVIDOR);
    await esperar(1500); // siembra de admin_cuentas (seedAdmin) tras el primer arranque con BD en memoria

    const loginR = await fetch(`${URL_HTTP_SERVIDOR}/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: USUARIO_SUPERADMIN, password: PASSWORD_SUPERADMIN }),
    });
    const loginDatos = await loginR.json().catch(() => null);
    comprobar("login HTTP de superadmin de test -> token", loginR.status === 200 && !!loginDatos?.token, JSON.stringify(loginDatos));
    if (!loginDatos?.token) throw new Error("sin token de superadmin, no se puede seguir");
    const token = loginDatos.token;

    const browser = await chromium.launch();

    // --- 1) Jugador muerto: pose caída, en el Hub. ---
    // El propio jugador que muere se DESCONECTA al respawnear (portal:ir ->
    // navegarA recarga la página) y el Hub de Colyseus se autodispone en
    // cuanto se queda sin clientes — así que sin un segundo cliente
    // "testigo" que se quede conectado, el respawn destruiría la room ANTES
    // de poder comprobar el cadáver (bug real de este harness de test, no
    // del servidor: se descubrió al ver `cadaveres=[]` tras cada respawn).
    {
      const testigo = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      testigo.on("pageerror", (err) => console.log("[error página, testigo]", String(err)));
      await testigo.goto(`http://localhost:${PUERTO_HTTP_CLIENTE}/?nombre=Testigo&adminSession=${token}`);
      await esperarCondicion(() => testigo.evaluate(() => !!(window).__test?.sessionId?.()), 15000);

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("pageerror", (err) => console.log("[error página, jugador]", String(err)));
      await page.goto(`http://localhost:${PUERTO_HTTP_CLIENTE}/?nombre=CorpseTester&adminSession=${token}`);
      await esperarCondicion(() => page.evaluate(() => !!(window).__test?.sessionId?.()), 15000);
      // NOTA: no se equipa nada antes de morir — no hay sonda de test para
      // leer instanciaId del inventario y así poder mandar "equipo:equipar"
      // (aplicarEquipoAlRig, reutilizado tal cual por el cadáver, ya está
      // cubierto aparte por sus propios tests/uso en vivo); esto solo
      // verifica el rig+pose real del cadáver "desnudo".
      await page.evaluate(() => (window).__test.enviar("admin:debug:matar", { tipo: "jugador" }));

      // Se lee desde el TESTIGO (nunca se desconecta, así que la room sigue
      // viva) — mismo state de room que ve el propio muerto tras respawnear.
      const cadaveres = await esperarCondicion(async () => {
        const v = await testigo.evaluate(() => (window).__cadaveres?.() ?? []);
        return v.length > 0 ? v : null;
      }, 10000, 500);
      const jugadorMuerto = (cadaveres || []).find((c) => c.tipoOrigen === "jugador");
      comprobar("admin:debug:matar (jugador) crea un Cadaver tipoOrigen=jugador", !!jugadorMuerto, JSON.stringify(cadaveres));
      if (jugadorMuerto) {
        await testigo.evaluate((c) => (window).__test.enviar("admin:debug:teleport", { x: c.x, y: c.y }), jugadorMuerto);
      }
      await esperar(800); // deja que la cámara/interpolación se asiente
      await testigo.screenshot({ path: path.join(CARPETA_CAPTURAS, "jugador_muerto.png") });
      await page.close();
      await testigo.close();
    }

    // --- 2) Animal muerto: fauna salvaje del mapa demo. ---
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("pageerror", (err) => console.log("[error página, animal]", String(err)));
      await page.goto(`http://localhost:${PUERTO_HTTP_CLIENTE}/?nombre=CorpseTester2&adminSession=${token}`);
      await esperarCondicion(() => page.evaluate(() => !!(window).__test?.sessionId?.()), 15000);
      const objetivo = await esperarCondicion(async () => {
        const lista = await page.evaluate(() => (window).__fauna?.() ?? []);
        return lista[0] ?? null;
      }, 20000, 1000);
      comprobar("aparece fauna salvaje activa en el mapa demo", !!objetivo, JSON.stringify(objetivo));
      if (objetivo) {
        await page.evaluate((id) => (window).__test.enviar("admin:debug:matar", { tipo: "fauna", id }), objetivo.id);
        await esperar(500);
        try {
          console.log("  admin:debug:ok =", await page.evaluate(() => (window).__test.ultimoMensaje("admin:debug:ok")));
          console.log("  admin:error =", await page.evaluate(() => (window).__test.ultimoMensaje("admin:error")));
        } catch { /* navegación en curso — no crítico, se reintenta abajo */ }
        const cadaveres = await esperarCondicion(async () => {
          try { return await page.evaluate(() => (window).__cadaveres?.() ?? []); }
          catch { return null; }
        }, 8000, 500);
        const animalMuerto = (cadaveres || []).find((c) => c.tipoOrigen === "animal");
        comprobar("admin:debug:matar (fauna) crea un Cadaver tipoOrigen=animal", !!animalMuerto, JSON.stringify(cadaveres));
        // se acerca la cámara al cadáver (teleport del propio jugador justo
        // encima) para una captura de cerca — el spawn y la fauna no
        // siempre caen en el mismo sitio de la pantalla.
        if (animalMuerto) {
          await page.evaluate((c) => (window).__test.enviar("admin:debug:teleport", { x: c.x, y: c.y }), animalMuerto);
        }
        await esperar(800);
        await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "animal_muerto.png") });
      }
      await page.close();
    }

    // --- 3) NPC muerto: jefe humanoide de mazmorra (busca cualquier mapa
    // horneado en assets/mapas/** que traiga un portal de mazmorra con
    // enemigos humanoides — "dungeon_test"/"torre_nigromante" no siempre
    // está presente en el repo, así que se prueba con lo que haya). ---
    {
      const raizMapas = path.join(RAIZ, "assets", "mapas");
      let mapaId = null, portal = null;
      for (const carpeta of fs.readdirSync(raizMapas, { withFileTypes: true })) {
        if (!carpeta.isDirectory()) continue;
        const rutaIndice = path.join(raizMapas, carpeta.name, "indice.json");
        if (!fs.existsSync(rutaIndice)) continue;
        try {
          const indice = JSON.parse(fs.readFileSync(rutaIndice, "utf8"));
          const candidato = (indice.portales || []).find((p) => p.esMazmorra);
          if (candidato) { mapaId = carpeta.name; portal = candidato; break; }
        } catch { /* indice.json corrupto/parcial — se prueba con el siguiente mapa */ }
      }
      comprobar("algún mapa horneado trae un portal de mazmorra", !!portal, mapaId ? `${mapaId}:${JSON.stringify(portal)}` : "ninguno en assets/mapas/**");
      if (portal) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.on("pageerror", (err) => console.log("[error página, npc]", String(err)));
        const url = `http://localhost:${PUERTO_HTTP_CLIENTE}/?sala=mazmorra&mapaId=${encodeURIComponent(mapaId)}&edificio=${encodeURIComponent(portal.edificio)}&nivel=0&nombre=CorpseTester3&adminSession=${token}`;
        await page.goto(url);
        await esperarCondicion(() => page.evaluate(() => !!(window).__test?.sessionId?.()), 15000);
        const boss = await esperarCondicion(async () => {
          const info = await page.evaluate(() => (window).__enemigos?.() ?? null);
          return info?.lista?.find((e) => e.esBoss) ?? null;
        }, 15000, 500);
        comprobar("aparece un jefe (esBoss) en la mazmorra", !!boss, JSON.stringify(boss));
        if (boss) {
          // El envío puede caer justo en medio de una recarga en curso
          // (mapa de mazmorra pesado, más lento de cargar que el resto de
          // pruebas) — reintenta unas cuantas veces en vez de fallar en seco.
          let enviado = false;
          for (let intento = 0; intento < 6 && !enviado; intento++) {
            try {
              await page.evaluate((id) => (window).__test.enviar("admin:debug:matar", { tipo: "enemigo", id }), boss.id);
              enviado = true;
            } catch {
              await esperar(500);
            }
          }
          comprobar("se pudo enviar admin:debug:matar (enemigo) sin que la navegación lo interrumpiera", enviado);
          await esperar(500);
          try {
            console.log("  [debug] matar(enemigo) ok=", await page.evaluate(() => (window).__test.ultimoMensaje("admin:debug:ok")), "error=", await page.evaluate(() => (window).__test.ultimoMensaje("admin:error")));
          } catch { /* navegación en curso */ }
          const cadaveres = await esperarCondicion(async () => {
            try { return await page.evaluate(() => (window).__cadaveres?.() ?? []); }
            catch { return null; }
          }, 8000, 500);
          const npcMuerto = (cadaveres || []).find((c) => c.tipoOrigen === "npc");
          comprobar("admin:debug:matar (enemigo jefe humanoide) crea un Cadaver tipoOrigen=npc", !!npcMuerto, JSON.stringify(cadaveres));
          comprobar("el cadáver del jefe trae datosVisual con enemigoId (pool de figuras, mismo aspecto que en vivo)", !!npcMuerto && JSON.parse(npcMuerto.datosVisual || "{}").enemigoId, JSON.stringify(npcMuerto));
          if (npcMuerto) {
            try { await page.evaluate((c) => (window).__test.enviar("admin:debug:teleport", { x: c.x, y: c.y }), npcMuerto); } catch { /* navegación en curso, no crítico para la captura */ }
          }
          await esperar(800);
          await page.screenshot({ path: path.join(CARPETA_CAPTURAS, "npc_muerto.png") });
        }
        await page.close();
      }
    }

    await browser.close();
  } finally {
    matarTodo();
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? `\n✅ cadaveresVisual.e2e: todo OK — capturas en ${CARPETA_CAPTURAS}` : `\n❌ cadaveresVisual.e2e: ${fallos} fallo(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ERROR en el smoke test:", err);
    process.exit(1);
  });
