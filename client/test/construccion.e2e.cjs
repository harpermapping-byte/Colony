"use strict";

// E2E del sistema de CONSTRUCCIÓN de punta a punta (docs/GDD_Construccion):
// servidor Colyseus con BD sqlite limpia + vite, dos páginas Playwright
// (Jarl y Espectador) y el flujo completo del contrato — asignar parcela,
// colocar 5 construcciones dentro de p_0001 (3 empalizadas en fila, valla y
// una casa rotada que genera interior), rechazo por solape, visibilidad
// desde otro cliente, y PERSISTENCIA real: se mata SOLO el servidor, se
// relanza con la misma BD y todo sigue ahí (interior de la casa incluido,
// verificado leyendo el sqlite directamente).
//
// Mismo patrón que streaming.e2e.cjs: spawn detached + kill del GRUPO al
// salir y puertos comprobados libres antes de arrancar.
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/construccion.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ, "assets", "mapas", "principal");
// BD temporal del test: se borra al empezar para que la primera fase parta
// de cero y la segunda demuestre que lo leído viene de ESTA base.
const BD_RUTA = path.join(os.tmpdir(), "colony_construccion_e2e.sqlite");
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

async function esperarPuertoLibre(url, intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    const ocupado = await fetch(url).then(() => true).catch(() => false);
    if (!ocupado) return;
    await esperar(500);
  }
  throw new Error(`${url} sigue ocupado tras matar el proceso`);
}

// ---------------------------------------------------------------------------
// Espejo MÍNIMO de la rejilla del servidor (mundo/mapaColision.ts) para poder
// ELEGIR casillas colocables sin ensayo-error: una casilla vale si su terreno
// es tierra transitable y no tiene encima un prop con colision del bake. El
// test elige con esta verdad y luego el SERVIDOR (autoritativo) confirma
// aceptando las 5 colocaciones — si el espejo divergiera, el e2e fallaría.
function crearConsultaTierra() {
  const indice = JSON.parse(fs.readFileSync(path.join(RUTA_MAPA, "indice.json"), "utf8"));
  const T = indice.tamanoChunk;
  const S = indice.tamanoSectorChunks;
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "catalogo", "terrenos.json"), "utf8"));

  const solidos = new Set();
  for (const archivo of ["vegetacion.json", "rocas.json", "animales.json"]) {
    const cat = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "catalogo", archivo), "utf8"));
    for (const [id, d] of Object.entries(cat)) if (!id.startsWith("_") && d && d.colision === true) solidos.add(id);
  }
  const rutaDeco = path.join(RAIZ, "ciudades", "catalogo", "decoracion.json");
  if (fs.existsSync(rutaDeco)) {
    const deco = JSON.parse(fs.readFileSync(rutaDeco, "utf8"));
    for (const [id, d] of Object.entries(deco)) if (!id.startsWith("_") && d && d.colision === true) solidos.add(id);
  }

  const pad3 = (n) => String(n).padStart(3, "0");
  const sectores = new Map(); // cache: un sector se lee UNA vez
  const propsPorChunk = new Map(); // "cx_cy" -> Set de claves locales con prop sólido

  return function esTierraLibre(x, y) {
    const cx = Math.floor(x / T), cy = Math.floor(y / T);
    const claveSector = `${Math.floor(cx / S)}_${Math.floor(cy / S)}`;
    if (!sectores.has(claveSector)) {
      const ruta = path.join(RUTA_MAPA, `sector_${pad3(Math.floor(cx / S))}_${pad3(Math.floor(cy / S))}.json`);
      sectores.set(claveSector, fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : null);
    }
    const sector = sectores.get(claveSector);
    const chunk = sector && sector.chunks[`${cx}_${cy}`];
    if (!chunk) return false; // chunk ausente = pared (mismo criterio que el servidor)

    const lx = x % T, ly = y % T;
    const id = indice.leyendaTerreno[parseInt(chunk.terreno[ly * chunk.tamano + lx], 36)];
    const t = terrenos[id];
    if (!t || t.requiereNadar || t.transitable === false) return false;

    const claveChunk = `${cx}_${cy}`;
    if (!propsPorChunk.has(claveChunk)) {
      const conProp = new Set();
      for (const obj of chunk.objetos || []) if (solidos.has(obj.i)) conProp.add(obj.y * T + obj.x);
      propsPorChunk.set(claveChunk, conProp);
    }
    return !propsPorChunk.get(claveChunk).has(ly * T + lx);
  };
}

// Elige dentro de p_0001 (leyendo sus runs REALES) las casillas del guion:
// hueco 6x7 para la casa (huella [7,6] rotada 1 → [6,7]), fila de 3 para las
// empalizadas y 1 para la valla — todo tierra libre y sin solaparse entre sí.
function elegirCasillas(parcela, esTierraLibre) {
  const dentro = new Set();
  const filas = new Map(); // y -> lista de x válidos (para buscar filas de 3)
  for (const [y, x0, x1] of parcela.runs) {
    for (let x = x0; x <= x1; x++) {
      if (!esTierraLibre(x, y)) continue;
      dentro.add(`${x},${y}`);
      if (!filas.has(y)) filas.set(y, []);
      filas.get(y).push(x);
    }
  }
  const reservadas = new Set();
  const libre = (x, y) => dentro.has(`${x},${y}`) && !reservadas.has(`${x},${y}`);
  const reservar = (x, y) => reservadas.add(`${x},${y}`);

  // casa 6x7 primero (el hueco más difícil de encontrar)
  let casa = null;
  const ys = [...filas.keys()].sort((a, b) => a - b);
  buscaCasa: for (const y of ys) {
    for (const x of filas.get(y)) {
      let cabe = true;
      for (let dy = 0; dy < 7 && cabe; dy++) for (let dx = 0; dx < 6 && cabe; dx++) cabe = libre(x + dx, y + dy);
      if (cabe) {
        casa = { x, y };
        for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 6; dx++) reservar(x + dx, y + dy);
        break buscaCasa;
      }
    }
  }
  // fila de 3 empalizadas
  let fila = null;
  buscaFila: for (const y of ys) {
    for (const x of filas.get(y)) {
      if (libre(x, y) && libre(x + 1, y) && libre(x + 2, y)) {
        fila = [{ x, y }, { x: x + 1, y }, { x: x + 2, y }];
        for (const c of fila) reservar(c.x, c.y);
        break buscaFila;
      }
    }
  }
  // valla suelta
  let valla = null;
  buscaValla: for (const y of ys) {
    for (const x of filas.get(y)) {
      if (libre(x, y)) { valla = { x, y }; reservar(x, y); break buscaValla; }
    }
  }
  if (!casa || !fila || !valla) throw new Error("p_0001 no tiene hueco para el guion del e2e (¿cambió el bake?)");
  return { casa, fila, valla };
}

async function main() {
  const procesos = [];
  const lanzar = (comando, args, cwd, env) => {
    const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, detached: true });
    // drenar stdout/stderr SIEMPRE (mismo patrón que mecanicas.e2e.mjs): si
    // nadie lee el pipe, el buffer del SO (64KB) se llena y el proceso hijo
    // se bloquea escribiendo — en un e2e largo con servidor+vite esto se
    // vio como ERR_CONNECTION_REFUSED/timeouts tardíos que no eran del motor
    p.stdout.on("data", (d) => process.stdout.write(`[${comando}] ${d}`));
    p.stderr.on("data", (d) => process.stderr.write(`[${comando}] ${d}`));
    procesos.push(p);
    return p;
  };
  const matar = (p) => {
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
    try { p.kill("SIGKILL"); } catch {}
  };
  const matarTodo = () => { for (const p of procesos) matar(p); };

  for (const puerto of [5199, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado (proceso zombi de otra ronda) — mátalo antes de correr el e2e`);
  }

  let fallos = 0;
  const comprobar = (condicion, mensaje) => {
    console.log(`${condicion ? "ok" : "FALLO"} - ${mensaje}`);
    if (!condicion) fallos++;
  };

  // BD limpia: la primera fase parte de cero de verdad
  fs.rmSync(BD_RUTA, { force: true });

  // casillas del guion elegidas ANTES de arrancar nada (dato estático)
  const parcelas = JSON.parse(fs.readFileSync(path.join(RUTA_MAPA, "parcelas.json"), "utf8"));
  const guion = elegirCasillas(parcelas.parcelas.p_0001, crearConsultaTierra());
  console.log("casillas elegidas en p_0001:", JSON.stringify(guion));

  const ENV_SERVIDOR = { JARL_NOMBRES: "Jarl", BD_RUTA };
  let servidor = lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), ENV_SERVIDOR);

  try {
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"));
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");

    const browser = await chromium.launch();
    const erroresConsola = [];
    const vigilar = (page, etiqueta) => {
      page.on("console", (msg) => {
        // 404 de sondas .glb esperado; el corte de conexión al matar el
        // servidor (fase de persistencia, paso 5) también es parte del
        // guion — tanto el WebSocket como cualquier fetch/XHR normal
        // (streaming de sectores, etc.) dan ERR_CONNECTION_REFUSED durante
        // esa ventana, no solo el mensaje que menciona "WebSocket"/"ws://"
        const t = msg.text();
        if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(`${etiqueta}: ${t}`);
      });
      page.on("pageerror", (err) => erroresConsola.push(`${etiqueta}: ${err}`));
    };

    // ---- Página A: el Jarl ----
    const paginaA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    vigilar(paginaA, "A");
    await paginaA.goto("http://localhost:5199/?nombre=Jarl");
    await paginaA.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await paginaA.waitForFunction(() => !!window.__construccion, null, { timeout: 30000 });
    comprobar(true, "página A (Jarl) con streaming activo y sonda de construcción");

    // ---- Paso 2: el jarl se asigna p_0001 y llega "parcelas:estado" ----
    await paginaA.evaluate(() => window.__construccion.asignarParcela("p_0001", "Jarl"));
    await paginaA
      .waitForFunction(() => window.__construccion.parcelas()?.p_0001?.dueno === "Jarl", null, { timeout: 10000 })
      .catch(() => {});
    const estadoParcelas = await paginaA.evaluate(() => window.__construccion.parcelas());
    comprobar(estadoParcelas?.p_0001?.dueno === "Jarl", `"parcelas:estado" con p_0001 del Jarl (${JSON.stringify(estadoParcelas?.p_0001?.dueno)})`);
    const modoActivo = await paginaA.evaluate(() => { window.__construccion.activar(); return window.__construccion.activo(); });
    comprobar(modoActivo, "el modo construcción se activa (el Jarl ya tiene parcela)");

    // ---- Paso 3: colocar 5 construcciones dentro de p_0001 ----
    // cada colocación espera su broadcast (construcciones sube) o el rechazo
    // (errores sube) — así el fallo señala la pieza exacta
    const colocar = async (objeto, x, y, rot) => {
      const antes = await paginaA.evaluate(() => ({
        n: window.__construccion.construcciones(),
        e: window.__construccion.errores().n,
      }));
      await paginaA.evaluate(({ objeto, x, y, rot }) => {
        window.__construccion.seleccionar(objeto); // seleccionar resetea rot a 0
        for (let i = 0; i < rot; i++) window.__construccion.rotar();
        window.__construccion.colocarEn(x, y);
      }, { objeto, x, y, rot });
      await paginaA.waitForFunction(
        (antes) => window.__construccion.construcciones() > antes.n || window.__construccion.errores().n > antes.e,
        antes,
        { timeout: 15000 },
      );
      return paginaA.evaluate(() => ({
        n: window.__construccion.construcciones(),
        e: window.__construccion.errores().n,
        motivo: window.__construccion.errores().motivo,
      }));
    };

    let r;
    for (let i = 0; i < 3; i++) {
      r = await colocar("empalizada_tramo", guion.fila[i].x, guion.fila[i].y, 0);
      comprobar(r.n === i + 1 && r.e === 0, `empalizada_tramo ${i + 1}/3 colocada en (${guion.fila[i].x},${guion.fila[i].y}) → construcciones=${r.n}${r.e ? ` ERROR: ${r.motivo}` : ""}`);
    }
    r = await colocar("valla_madera", guion.valla.x, guion.valla.y, 0);
    comprobar(r.n === 4 && r.e === 0, `valla_madera colocada en (${guion.valla.x},${guion.valla.y}) → construcciones=${r.n}${r.e ? ` ERROR: ${r.motivo}` : ""}`);
    r = await colocar("casa_humilde", guion.casa.x, guion.casa.y, 1);
    comprobar(r.n === 5 && r.e === 0, `casa_humilde (edificio, rot 1) colocada en (${guion.casa.x},${guion.casa.y}) → construcciones=${r.n}${r.e ? ` ERROR: ${r.motivo}` : ""}`);

    // repetir la misma casilla → "construir:error" por solape
    r = await colocar("empalizada_tramo", guion.fila[0].x, guion.fila[0].y, 0);
    comprobar(r.n === 5 && r.e === 1, `repetir la casilla (${guion.fila[0].x},${guion.fila[0].y}) se rechaza con "construir:error" (motivo: "${r.motivo}")`);

    // ---- Paso 4: página B (otro contexto = otro jugador) ve las 5 ----
    const contextoB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const paginaB = await contextoB.newPage();
    vigilar(paginaB, "B");
    await paginaB.goto("http://localhost:5199/?nombre=Espectador");
    await paginaB
      .waitForFunction(() => window.__construccion && window.__construccion.construcciones() === 5, null, { timeout: 60000 })
      .catch(() => {});
    const enB = await paginaB.evaluate(() => window.__construccion.construcciones());
    comprobar(enB === 5, `el Espectador ve las 5 construcciones (ve ${enB})`);

    // Caminar al Jarl hasta su parcela para que la captura ENSEÑE lo
    // construido (la cámara sigue al jugador). Blando a propósito: si un
    // sólido del bake lo frena por el camino, la captura sale igualmente y
    // el e2e no falla por esto — la verdad ya está comprobada arriba.
    const objetivoX = guion.casa.x - 6;
    await paginaA.keyboard.down("d");
    for (let i = 0; i < 60; i++) {
      const antes = await paginaA.evaluate(() => window.__colonyDebug?.x ?? 0);
      await esperar(700);
      const ahora = await paginaA.evaluate(() => window.__colonyDebug?.x ?? 0);
      if (ahora >= objetivoX) break;
      if (ahora - antes < 0.5) {
        // atascado contra un sólido del bake: esquivar bajando un poco
        await paginaA.keyboard.down("s");
        await esperar(600);
        await paginaA.keyboard.up("s");
      }
    }
    await paginaA.keyboard.up("d");
    await esperar(1500); // que la interpolación y el streaming asienten
    await paginaA.screenshot({ path: path.join(__dirname, "construccion_e2e.png") });
    console.log("captura: client/test/construccion_e2e.png");

    // ---- Paso 5: PERSISTENCIA — matar SOLO el servidor y relanzar ----
    matar(servidor);
    await esperarPuertoLibre("http://localhost:2567/");
    servidor = lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), ENV_SERVIDOR);
    await esperarPuerto("http://localhost:2567/");

    await paginaB.reload();
    await paginaB
      .waitForFunction(() => window.__construccion && window.__construccion.construcciones() === 5, null, { timeout: 60000 })
      .catch(() => {});
    const trasReinicio = await paginaB.evaluate(() => window.__construccion.construcciones());
    comprobar(trasReinicio === 5, `tras reiniciar el servidor con la misma BD siguen las 5 construcciones (hay ${trasReinicio})`);

    // la casa guardó su interior generado: se lee el sqlite DIRECTAMENTE
    const { DatabaseSync } = require("node:sqlite");
    const bd = new DatabaseSync(BD_RUTA);
    const filas = bd.prepare("SELECT objeto, categoria, extra FROM construcciones").all();
    bd.close();
    comprobar(filas.length === 5, `la BD tiene 5 construcciones (tiene ${filas.length})`);
    const casa = filas.find((f) => f.objeto === "casa_humilde");
    let salas = 0;
    try {
      const interior = JSON.parse(String(casa?.extra ?? "null"))?.interior;
      for (const planta of interior?.plantas ?? []) salas += (planta.salas ?? []).length;
    } catch {}
    comprobar(!!casa && casa.categoria === "edificio", "la casa_humilde está en la BD como edificio");
    comprobar(salas > 0, `el extra de la casa contiene su interior generado (${salas} sala(s))`);

    comprobar(erroresConsola.length === 0, `sin errores de consola (${erroresConsola.slice(0, 3).join(" | ")})`);

    await browser.close();
  } finally {
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }

  console.log(fallos === 0 ? "E2E OK" : `E2E con ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
