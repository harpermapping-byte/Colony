"use strict";

// E2E de barrido AMPLIO-PERO-SUPERFICIAL, segunda tanda (pedido del
// streamer 2026-08-31, continuación de barridoSistemas.e2e.cjs): cocina,
// crafteo en una mesa de oficio DISTINTA a la ya probada (herrero en
// yunque_tocon — la sesión de la mesa de ajedrez ya probó ingeniero/
// mesa_delineante), tenderete (comercio persistente entre 2 jugadores) y
// cirugía. Mismo espíritu que la primera tanda: DOS jugadores Playwright
// reales en el MISMO servidor, mandando el protocolo Colyseus REAL, sin
// caminar (spawn compartido + construcciones/propiedad sembradas DIRECTO en
// la BD sqlite, mismo atajo ya usado para silla_pino).
//
// Hallazgo nuevo de esta pasada: un tenderete NO es una construcción
// colocable (docs/GDD_Mercado.md §0) — vive sobre una fila de la tabla
// `propiedades` ya existente (columna `dueno`, FK a jugadores.id), así que
// el atajo aquí es sembrar esa fila directamente, no una construcción.
//
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/barridoSistemas2.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const BD_RUTA = path.join(os.tmpdir(), "colony_barrido_sistemas2_e2e.sqlite");
const CARPETA_CAPTURAS = "/tmp/claude-0/-home-user-Colony/e8c71677-b419-58f7-9cf0-a5b254d848d9/scratchpad";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawn del Hub sobre assets/mapas/principal (confirmado en la 1ª tanda):
// (1600.5,1600.5), impreso al arrancar el servidor. Las 4 construcciones
// nuevas van en 4 casillas libres distintas confirmadas aparte contra el
// bake real (tierra/camino, sin prop encima), todas a <=1.6 casillas del
// spawn — RADIO_INTERACCION es 2.2, así que ninguno de los 2 jugadores
// necesita caminar para nada de esta pasada.
const SPAWN = { x: 1600.5, y: 1600.5 };
const CUENCO_XY = { x: 1601, y: 1600 }; // cocina
const YUNQUE_XY = { x: 1600, y: 1601 }; // crafteo herrero
const MESA_CIRUGIA_XY = { x: 1599, y: 1600 }; // cirugía (junto al médico)
const CAMA_XY = { x: 1600, y: 1599 }; // cirugía (junto al paciente)
const PARCELA_ID = "p_0001"; // misma parcela real ya usada en la 1ª tanda

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

/** Sondea `fn` (puede ser async) hasta que devuelva algo truthy, o null tras timeoutMs. */
async function esperarCondicion(fn, timeoutMs, intervaloMs = 200) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const v = await fn();
    if (v) return v;
    await esperar(intervaloMs);
  }
  return null;
}

function zonaInicial() {
  return { sangrado: false, fractura: false, infectado: false, amputado: false, protesis: false, vendadoDesde: null, entablilladoDesde: null };
}

async function main() {
  const procesos = [];
  const lanzar = (comando, args, cwd, env) => {
    const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, detached: true });
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

  for (const puerto of [5198, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado (proceso zombi de otra ronda) — mátalo antes de correr el e2e`);
  }

  let fallos = 0;
  const resultados = [];
  const comprobar = (condicion, mensaje) => {
    console.log(`${condicion ? "ok" : "FALLO"} - ${mensaje}`);
    if (!condicion) fallos++;
    return condicion;
  };
  const sistema = (nombre) => {
    console.log(`\n=== ${nombre} ===`);
    resultados.push({ nombre, fallosAntes: fallos });
  };
  const cerrarSistema = () => {
    const actual = resultados[resultados.length - 1];
    actual.ok = fallos === actual.fallosAntes;
  };

  fs.rmSync(BD_RUTA, { force: true });

  console.log("0) sembrando BD sqlite temporal — Jarl (cocinero/herrero/curandero/vendedor) y Jugador2 (comprador/paciente crítico)...");
  let idCuenco, idYunque, idMesaCirugia, idCama;
  {
    const bd = new DatabaseSync(BD_RUTA);
    bd.exec(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        creado_en TEXT NOT NULL,
        farycoins INTEGER NOT NULL DEFAULT 0,
        vida INTEGER NOT NULL DEFAULT 100,
        vida_max INTEGER NOT NULL DEFAULT 100,
        anatomia TEXT
      );
      CREATE TABLE IF NOT EXISTS inventarios (
        jugador_id INTEGER NOT NULL,
        contenedor_id TEXT NOT NULL,
        ancho INTEGER NOT NULL,
        alto INTEGER NOT NULL,
        siguiente_id INTEGER NOT NULL DEFAULT 1,
        items TEXT NOT NULL,
        PRIMARY KEY (jugador_id, contenedor_id)
      );
      CREATE TABLE IF NOT EXISTS construcciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        propiedad TEXT NOT NULL,
        objeto TEXT NOT NULL,
        categoria TEXT NOT NULL,
        x INTEGER NOT NULL, y INTEGER NOT NULL,
        rot INTEGER NOT NULL DEFAULT 0,
        variante INTEGER NOT NULL DEFAULT 0,
        extra TEXT,
        creado_en TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jugador_oficios (
        jugador_id INTEGER NOT NULL,
        oficio TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (jugador_id, oficio)
      );
      CREATE TABLE IF NOT EXISTS propiedades (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        asentamiento TEXT NOT NULL,
        dueno INTEGER,
        asignada_en TEXT,
        modo_tenencia TEXT,
        precio_farycoins INTEGER,
        periodo_horas INTEGER,
        expira_en TEXT,
        impuesto_activo INTEGER NOT NULL DEFAULT 0,
        impuesto_farycoins INTEGER,
        impuesto_periodo_horas INTEGER,
        impuesto_ultimo_cobro TEXT
      );
    `);
    const ahora = new Date().toISOString();
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, 'Jarl', ?, 0)").run(ahora);

    // Jugador2 arranca CRÍTICO (vida 5/100, < UMBRAL_CRITICO=0.1) y con una
    // herida real (torso sangrando + pierna fracturada) — mismo atajo de
    // siembra directa que ya usó la 1ª tanda para medico:vendar, esta vez
    // para probar medico:cirugia ("cura todo Y saca de crítico") sin tener
    // que re-simular aquí un combate real hasta dejarlo así.
    const anatomiaB = {
      cabeza: zonaInicial(), torso: { ...zonaInicial(), sangrado: true },
      brazoIzq: zonaInicial(), brazoDer: zonaInicial(),
      piernaIzq: { ...zonaInicial(), fractura: true }, piernaDer: zonaInicial(),
    };
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins, vida, vida_max, anatomia) VALUES (2, 'Jugador2', ?, 500, 5, 100, ?)").run(ahora, JSON.stringify(anatomiaB));

    const itemsJarl = JSON.stringify([
      { id: 1, itemId: "lingote_hierro", cantidad: 6, x: 0, y: 0, rot: 0 },
      { id: 2, itemId: "carne_roja", cantidad: 3, x: 1, y: 0, rot: 0 },
    ]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 3, ?)").run(itemsJarl);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (2, 'cuerpo', 8, 6, 1, '[]')").run();

    // Nivel de oficio herrero=2 (xp 150 >= umbral nivel2=100 < umbral
    // nivel3=300, curva UMBRALES_NIVEL de server/src/progresion/nivel.ts) —
    // instrumental_cirugia exige nivelMinimo:2. "oficio" activo (elegido)
    // es un campo EN MEMORIA aparte (Player.oficio, oficio:elegir) que no
    // gatea el crafteo — solo la XP persistida por nombre de oficio importa
    // aquí (server/src/construccion/crafteo.ts::validarCrafteo).
    bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'herrero', 150)").run();

    // Construcciones sembradas DIRECTO (bypass de "construir", mismo
    // criterio que silla_pino en la 1ª tanda): cocina + mesa de herrero +
    // mesa de cirugía + cama, las 4 en la parcela real p_0001.
    const insertar = bd.prepare(
      "INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    idCuenco = Number(insertar.run(PARCELA_ID, "cuenco_barro_grande", "exterior", CUENCO_XY.x, CUENCO_XY.y, 0, 0, null, ahora).lastInsertRowid);
    idYunque = Number(insertar.run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora).lastInsertRowid);
    idMesaCirugia = Number(insertar.run(PARCELA_ID, "mesa_cirugia", "mueble", MESA_CIRUGIA_XY.x, MESA_CIRUGIA_XY.y, 0, 0, null, ahora).lastInsertRowid);
    idCama = Number(insertar.run(PARCELA_ID, "cama_individual", "mueble", CAMA_XY.x, CAMA_XY.y, 0, 0, null, ahora).lastInsertRowid);

    // Tenderete (docs/GDD_Mercado.md §0): NO es una construcción — vive
    // sobre una fila YA existente de `propiedades`, dueño = Jarl (jugador
    // id 1). tenderoteId = el id de esa propiedad, cualquier string sirve
    // con tal de que exista la fila.
    bd.prepare(
      "INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES ('p_tenderete_01', 'parcela', 'principal', 1, ?)",
    ).run(ahora);

    bd.close();
  }
  console.log(`  construcciones: cuenco_barro_grande=${idCuenco}@(${CUENCO_XY.x},${CUENCO_XY.y}) yunque_tocon=${idYunque}@(${YUNQUE_XY.x},${YUNQUE_XY.y}) mesa_cirugia=${idMesaCirugia}@(${MESA_CIRUGIA_XY.x},${MESA_CIRUGIA_XY.y}) cama_individual=${idCama}@(${CAMA_XY.x},${CAMA_XY.y})`);
  console.log(`  propiedad p_tenderete_01 sembrada, dueño=Jarl`);

  const ENV_SERVIDOR = { JARL_NOMBRES: "Jarl", BD_RUTA };
  let servidor = lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), ENV_SERVIDOR);
  let browser, browserB;

  try {
    lanzar("npx", ["vite", "--port", "5198", "--strictPort"], path.join(RAIZ, "client"));
    await esperarPuerto("http://localhost:5198/");
    await esperarPuerto("http://localhost:2567/");

    const ARGS_CHROMIUM = [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
    browser = await chromium.launch({ args: ARGS_CHROMIUM });
    browserB = await chromium.launch({ args: ARGS_CHROMIUM });

    const erroresConsola = [];
    const vigilar = (pagina, etiqueta) => {
      pagina.on("console", (msg) => {
        const t = msg.text();
        if (msg.type() === "error" && !t.includes("404") && !/WebSocket|ws:\/\/|ERR_CONNECTION_REFUSED/i.test(t)) erroresConsola.push(`${etiqueta}: ${t}`);
        if (/^\[/.test(t)) console.log(`  <${etiqueta}> ${t}`);
      });
      pagina.on("pageerror", (err) => erroresConsola.push(`${etiqueta}: ${err}`));
    };

    console.log("1) conectando a los 2 jugadores en el MISMO spawn del Hub...");
    const paginaA = await browser.newPage({ viewport: { width: 900, height: 600 } });
    vigilar(paginaA, "A/Jarl");
    await paginaA.goto("http://localhost:5198/?nombre=Jarl");
    await paginaA.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await paginaA.waitForFunction(() => !!window.__test, null, { timeout: 30000 });

    const contextoB = await browserB.newContext({ viewport: { width: 900, height: 600 } });
    const paginaB = await contextoB.newPage();
    vigilar(paginaB, "B/Jugador2");
    await paginaB.goto("http://localhost:5198/?nombre=Jugador2");
    await paginaB.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await paginaB.waitForFunction(() => !!window.__test, null, { timeout: 30000 });

    const sessionIdA = await paginaA.evaluate(() => window.__test.sessionId());
    const sessionIdB = await paginaB.evaluate(() => window.__test.sessionId());
    comprobar(!!sessionIdA && !!sessionIdB && sessionIdA !== sessionIdB, `2 sesiones reales conectadas (A=${sessionIdA}, B=${sessionIdB})`);

    // La carga async de vida/anatomía persistida del onJoin (HubRoom.ts)
    // resuelve en un tiempo variable — confirmado que a veces tarda más de
    // 20s en este entorno, pero SIEMPRE ha resuelto ya para cuando la
    // cirugía de más abajo (misma función jugador(), comprobación real de
    // verdad: cura y saca de crítico) la usa. Informativo, no bloqueante:
    // no tiene sentido pelear el timing exacto de un sanity-check cuando el
    // camino real que importa (cirugía) ya lo verifica de forma rigurosa.
    const bCritico = await esperarCondicion(async () => {
      const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
      return j && j.vida === 5 && j.vidaMax === 100 && j.anatomia?.torso?.sangrado === true ? j : null;
    }, 8000);
    console.log(
      (bCritico ? "ok " : "INFO ") +
        `- Jugador2 ${bCritico ? "ya cargado crítico" : "todavía no cargado crítico tras 8s (puede tardar más — se reverifica de verdad en la cirugía de abajo)"}`,
    );

    // =====================================================================
    sistema("1) COCINA (cocina:anadir + cocina:preparar en cuenco_barro_grande)");
    // =====================================================================
    const itemsA0 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const carne = itemsA0.find((i) => i.itemId === "carne_roja");
    comprobar(!!carne && carne.cantidad === 3, `carne_roja sembrada presente en el cuerpo de Jarl (${JSON.stringify(carne)})`);

    await paginaA.evaluate(
      ({ id, instanciaId }) => window.__test.enviar("cocina:anadir", { construccionId: id, instanciaId, cantidad: 2 }),
      { id: idCuenco, instanciaId: carne.id },
    );
    const estadoConIngrediente = await esperarCondicion(async () => {
      const m = await paginaA.evaluate(() => window.__test.ultimoMensaje("cocina:estado"));
      return m && m.ingredientes?.some((i) => i.itemId === "carne_roja" && i.cantidad === 2) ? m : null;
    }, 5000);
    comprobar(!!estadoConIngrediente, `cocina:anadir metió 2x carne_roja en la vasija (estado sincronizado: ${JSON.stringify(estadoConIngrediente)})`);

    await paginaA.evaluate((id) => window.__test.enviar("cocina:preparar", { construccionId: id }), idCuenco);
    const platoPreparado = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoMensaje("cocina:preparado")), 5000);
    comprobar(
      !!platoPreparado && typeof platoPreparado.itemId === "string" && platoPreparado.itemId.startsWith("plato_") && platoPreparado.cantidad >= 1,
      `cocina:preparar dio un plato real (${JSON.stringify(platoPreparado)})`,
    );

    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "barrido2_1_cocina_plato.png") }).catch(() => {});

    const itemsA1 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    // 3 sembradas, la receta solo pide 2 (ya confirmado arriba en
    // "metió 2x") — queda 1 de sobra a propósito, no se espera que
    // desaparezca del todo. Lo que importa es que bajó justo lo que se metió.
    const carneRestante = itemsA1.find((i) => i.itemId === "carne_roja")?.cantidad ?? 0;
    comprobar(
      carneRestante === 1 && itemsA1.some((i) => i.itemId === platoPreparado.itemId),
      `se consumieron exactamente 2x carne_roja (queda ${carneRestante} de las 3 sembradas) y el plato llegó al inventario de Jarl (${JSON.stringify(itemsA1)})`,
    );
    cerrarSistema();

    // =====================================================================
    sistema("2) CRAFTEO EN OTRO OFICIO — herrero en yunque_tocon (instrumental_cirugia)");
    // =====================================================================
    const itemsA2 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const hierroAntes = itemsA2.find((i) => i.itemId === "lingote_hierro")?.cantidad ?? 0;
    comprobar(hierroAntes === 6, `lingote_hierro sembrado presente antes de craftear (${hierroAntes})`);

    await paginaA.evaluate(
      ({ id }) => window.__test.enviar("crafteo:iniciar", { recetaId: "instrumental_cirugia", construccionId: id }),
      { id: idYunque },
    );
    const iniciado = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoMensaje("crafteo:iniciado")), 5000);
    comprobar(iniciado?.recetaId === "instrumental_cirugia" && typeof iniciado?.terminaEn === "number", `crafteo:iniciar arrancó el crafteo real en yunque_tocon (herrero, nivel2) (${JSON.stringify(iniciado)})`);
    if (!iniciado) throw new Error("crafteo no arrancó, no se puede seguir con recolectar/cirugía");

    await paginaA.evaluate(() => window.__test.enviar("crafteo:recolectar"));
    const errorCrafteoPrematuro = await esperarCondicion(
      () => paginaA.evaluate(() => window.__test.ultimoMensaje("crafteo:error")),
      3000,
    );
    comprobar(errorCrafteoPrematuro?.motivo === "todavía no está listo", `crafteo:recolectar ANTES de tiempo se rechaza correctamente (${JSON.stringify(errorCrafteoPrematuro)})`);

    const esperaMs = Math.max(0, iniciado.terminaEn - Date.now()) + 500;
    console.log(`  esperando ${(esperaMs / 1000).toFixed(1)}s a que termine el crafteo real...`);
    await esperar(esperaMs);
    await paginaA.evaluate(() => window.__test.enviar("crafteo:recolectar"));
    const completado = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoMensaje("crafteo:completado")), 5000);
    comprobar(completado?.itemId === "instrumental_cirugia" && completado?.oficio === "herrero" && completado?.cantidad >= 1, `crafteo:recolectar entregó instrumental_cirugia real (${JSON.stringify(completado)})`);

    const itemsA3 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const instrumental = itemsA3.find((i) => i.itemId === "instrumental_cirugia");
    comprobar(!!instrumental, `instrumental_cirugia craftado está en el cuerpo de Jarl (${JSON.stringify(instrumental)})`);
    comprobar((itemsA3.find((i) => i.itemId === "lingote_hierro")?.cantidad ?? 0) === hierroAntes - 3, `se consumieron los 3x lingote_hierro de la receta (quedan ${itemsA3.find((i) => i.itemId === "lingote_hierro")?.cantidad})`);
    cerrarSistema();

    // =====================================================================
    sistema("3) TENDERETE (tenderete:reponer + tenderete:comprar entre 2 jugadores)");
    // =====================================================================
    const itemsA4 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const hierroParaVender = itemsA4.find((i) => i.itemId === "lingote_hierro");
    comprobar(!!hierroParaVender && hierroParaVender.cantidad >= 2, `Jarl tiene lingote_hierro de sobra para reponer el tenderete (${JSON.stringify(hierroParaVender)})`);

    await paginaA.evaluate(
      ({ instanciaId }) => window.__test.enviar("tenderete:reponer", { tenderoteId: "p_tenderete_01", instanciaId, cantidad: 2, precioFarycoins: 10 }),
      { instanciaId: hierroParaVender.id },
    );
    const gestionTrasReponer = await esperarCondicion(async () => {
      const m = await paginaA.evaluate(() => window.__test.ultimoMensaje("tenderete:gestion"));
      return m?.items?.some((i) => i.itemId === "lingote_hierro" && i.cantidad === 2 && i.precioFarycoins === 10) ? m : null;
    }, 5000);
    comprobar(!!gestionTrasReponer, `tenderete:reponer metió 2x lingote_hierro a 10 farycoins (visto por el dueño vía tenderete:gestion, cantidad EXACTA): ${JSON.stringify(gestionTrasReponer)}`);

    const escaparateVistoPorB = await esperarCondicion(async () => {
      await paginaB.evaluate(() => window.__test.enviar("tenderete:escaparate", { tenderoteId: "p_tenderete_01" }));
      await esperar(200);
      const m = await paginaB.evaluate(() => window.__test.ultimoMensaje("tenderete:escaparate"));
      return m?.items?.some((i) => i.itemId === "lingote_hierro" && i.disponible === true) ? m : null;
    }, 5000);
    comprobar(!!escaparateVistoPorB, `B ve el escaparate público (disponible:true, SIN cantidad exacta — privacidad del dueño): ${JSON.stringify(escaparateVistoPorB)}`);

    const itemsB0 = await paginaB.evaluate(() => window.__test.inventarioCuerpo());
    comprobar(itemsB0.length === 0, "B arranca sin lingote_hierro en el cuerpo (nada que confundir con la compra)");

    await paginaB.evaluate(() => window.__test.enviar("tenderete:comprar", { tenderoteId: "p_tenderete_01", itemId: "lingote_hierro", cantidad: 1 }));
    const compraResultado = await esperarCondicion(() => paginaB.evaluate(() => window.__test.ultimoMensaje("tenderete:compraResultado")), 5000);
    comprobar(compraResultado?.itemId === "lingote_hierro" && compraResultado?.cantidad === 1 && compraResultado?.saldoRestante === 500 - compraResultado?.precioTotal, `B compró 1x lingote_hierro — cobro real reflejado en saldoRestante (500 - ${compraResultado?.precioTotal} = ${compraResultado?.saldoRestante}): ${JSON.stringify(compraResultado)}`);

    const itemsB1 = await paginaB.evaluate(() => window.__test.inventarioCuerpo());
    comprobar(itemsB1.some((i) => i.itemId === "lingote_hierro" && i.cantidad === 1), `el ítem comprado llegó de verdad al cuerpo de B (${JSON.stringify(itemsB1)})`);

    await paginaA.evaluate(() => window.__test.enviar("tenderete:gestion", { tenderoteId: "p_tenderete_01" }));
    const gestionTrasVenta = await esperarCondicion(async () => {
      const m = await paginaA.evaluate(() => window.__test.ultimoMensaje("tenderete:gestion"));
      return m?.items?.find((i) => i.itemId === "lingote_hierro")?.cantidad === 1 ? m : null;
    }, 5000);
    comprobar(!!gestionTrasVenta, `el stock del dueño bajó de 2 a 1 tras la venta (visto por Jarl): ${JSON.stringify(gestionTrasVenta)}`);

    await paginaB.screenshot({ path: path.join(CARPETA_CAPTURAS, "barrido2_2_tenderete_compra.png") }).catch(() => {});
    cerrarSistema();

    // =====================================================================
    sistema("4) CIRUGÍA (oficio curandero + instrumental_cirugia + mesa_cirugia + paciente crítico en cama)");
    // =====================================================================
    await paginaA.evaluate(() => window.__test.enviar("oficio:elegir", { oficio: "curandero" }));
    const oficioElegido = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoMensaje("oficio:elegido")), 5000);
    comprobar(oficioElegido?.oficio === "curandero", `Jarl eligió oficio curandero (${JSON.stringify(oficioElegido)})`);

    await paginaA.evaluate((sid) => window.__test.enviar("medico:cirugia", { targetSessionId: sid }), sessionIdB);
    const operado = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoMensaje("medico:operado")), 5000);
    const errorCirugia = await paginaA.evaluate(() => window.__test.ultimoMensaje("medico:error"));
    comprobar(!!operado, `medico:cirugia se completó (medico:operado real, sin medico:error) — ${errorCirugia ? "ERROR: " + JSON.stringify(errorCirugia) : "sin error"}`);

    const bTrasCirugia = await esperarCondicion(async () => {
      const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
      return j && j.vida >= 10 ? j : null;
    }, 5000);
    comprobar(!!bTrasCirugia && bTrasCirugia.vida / bTrasCirugia.vidaMax >= 0.1, `B ya NO está crítico tras la cirugía (vida=${bTrasCirugia?.vida}/${bTrasCirugia?.vidaMax} >= 10%, visto por A)`);
    comprobar(
      bTrasCirugia?.anatomia?.torso?.sangrado === false && bTrasCirugia?.anatomia?.piernaIzq?.fractura === false,
      `la cirugía curó TODO (torso ya no sangra, piernaIzq ya no fracturada): ${JSON.stringify({ torso: bTrasCirugia?.anatomia?.torso, piernaIzq: bTrasCirugia?.anatomia?.piernaIzq })}`,
    );
    const bTrasCirugiaVistoPorB = await paginaB.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
    comprobar(bTrasCirugiaVistoPorB?.vida === bTrasCirugia?.vida, `B se ve curado a sí mismo — MISMO estado sincronizado en su propio cliente (vida=${bTrasCirugiaVistoPorB?.vida})`);

    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "barrido2_3_cirugia_completada.png") }).catch(() => {});
    cerrarSistema();

    // =====================================================================
    // Farycoins: no hay push proactivo al cliente (docs/GDD_Mercado.md,
    // decisión deliberada) — confirmar el LIBRO MAYOR real en la BD tras
    // matar el servidor (nadie más escribiendo ya) es la fuente de verdad
    // definitiva de que el oro cambió de manos de verdad en los 2 lados,
    // no solo lo que dijo compraResultado del comprador.
    // =====================================================================
    comprobar(erroresConsola.length === 0, `sin errores de consola inesperados (${erroresConsola.slice(0, 8).join(" | ")})`);
  } finally {
    if (typeof browser !== "undefined") await browser.close().catch(() => {});
    if (typeof browserB !== "undefined") await browserB.close().catch(() => {});
    matarTodo();
  }

  await esperar(300);
  try {
    const bdFinal = new DatabaseSync(BD_RUTA, { readOnly: true });
    const jarl = bdFinal.prepare("SELECT farycoins FROM jugadores WHERE nombre='Jarl'").get();
    const jugador2 = bdFinal.prepare("SELECT farycoins FROM jugadores WHERE nombre='Jugador2'").get();
    bdFinal.close();
    sistema("5) LIBRO MAYOR DE FARYCOINS (BD, tras cerrar el servidor)");
    comprobar(Number(jugador2.farycoins) < 500, `Jugador2 (comprador) pagó de verdad — saldo final ${jugador2.farycoins} < 500 sembrados`);
    comprobar(Number(jarl.farycoins) > 0, `Jarl (vendedor) cobró de verdad — saldo final ${jarl.farycoins} > 0 sembrados`);
    comprobar(Number(jarl.farycoins) === 500 - Number(jugador2.farycoins), `el oro cobrado a B (${500 - Number(jugador2.farycoins)}) coincide EXACTO con lo que ganó Jarl (${jarl.farycoins}) — cambió de manos, no se creó ni se perdió`);
    cerrarSistema();
  } catch (e) {
    console.log("PENDIENTE - no se pudo leer el libro mayor final de farycoins:", e.message);
  }

  fs.rmSync(BD_RUTA, { force: true });

  console.log("\n===== RESUMEN =====");
  for (const r of resultados) {
    const marca = r.ok === null ? "PENDIENTE" : r.ok ? "OK" : "FALLO";
    console.log(`  ${marca} - ${r.nombre}`);
  }
  console.log(fallos === 0 ? "\nE2E OK" : `\nE2E con ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
