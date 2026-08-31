"use strict";

// E2E de barrido AMPLIO-PERO-SUPERFICIAL de varios sistemas multijugador
// (pedido explícito del streamer 2026-08-31: "pasa rápido por MUCHOS
// sistemas con 2 jugadores reales, arregla solo lo obvio, anota lo que
// necesite sesión dedicada, sin bloquear en ninguno"). Cubre comercio
// directo, gremios, médico curando a OTRO jugador y asiento genérico —
// DOS jugadores Playwright reales conectados al MISMO servidor, mandando
// el protocolo Colyseus REAL (nunca un atajo que salte validación),
// reusando un ÚNICO arranque de servidor+cliente para TODOS los sistemas.
//
// Truco clave para no repetir la lentitud del e2e de mesaAjedrez (14
// pasadas completas, sobre todo por CAMINAR esquivando obstáculos sueltos
// hasta una parcela a ~80 casillas del spawn): los DOS jugadores aparecen
// en el MISMO punto de spawn del Hub (impreso al arrancar el servidor,
// ~1600.5,1600.5) — comercio/gremio/médico gatean por RADIO_INTERACCION
// (2.2) contra el OTRO JUGADOR, no contra una construcción fija lejana, así
// que con distancia 0 no hace falta caminar nada. La única construcción
// real que hace falta (silla_pino, para el asiento genérico) se siembra
// DIRECTAMENTE en la fila `construcciones` de la BD, en una casilla a 1
// paso del spawn (confirmada tierra libre aparte) — el sistema de
// "construir"/colocar YA está probado end-to-end (docs/GDD_Construccion,
// mesaAjedrez.e2e.cjs), así que repetirlo aquí solo para colocar una silla
// no aporta nada nuevo y sí ~80 casillas de paseo; lo que SÍ es nuevo aquí
// es asiento:sentarse/levantarse, que esto prueba con el mensaje real.
//
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/barridoSistemas.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const BD_RUTA = path.join(os.tmpdir(), "colony_barrido_sistemas_e2e.sqlite");
const CARPETA_CAPTURAS = "/tmp/claude-0/-home-user-Colony/e8c71677-b419-58f7-9cf0-a5b254d848d9/scratchpad";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawn del Hub sobre assets/mapas/principal (server/src/rooms/HubRoom.ts,
// impreso al arrancar) — confirmado aparte contra el bake real que (1601,1601)
// es tierra/camino libre sin prop suelto encima, a 1 paso del spawn.
const SPAWN = { x: 1600.5, y: 1600.5 };
const SILLA_XY = { x: 1601, y: 1601 };

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

  console.log("0) sembrando BD sqlite temporal — Jarl y Jugador2 con inventario/anatomía/silla ya listos...");
  let sillaId;
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
    `);
    const ahora = new Date().toISOString();
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, 'Jarl', ?)").run(ahora);

    // Jugador2 arranca YA herido (torso sangrando + pierna fracturada) —
    // atajo de siembra directa (mismo patrón que el inventario) para no
    // tener que re-simular aquí un combate real solo para producir una
    // herida: eso ya tiene su propio e2e (combate.e2e.mjs), lo nuevo aquí
    // es medico:vendar/entablillar CONTRA OTRO JUGADOR.
    const anatomiaB = {
      cabeza: zonaInicial(), torso: { ...zonaInicial(), sangrado: true },
      brazoIzq: zonaInicial(), brazoDer: zonaInicial(),
      piernaIzq: { ...zonaInicial(), fractura: true }, piernaDer: zonaInicial(),
    };
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, anatomia) VALUES (2, 'Jugador2', ?, ?)").run(ahora, JSON.stringify(anatomiaB));

    const itemsJarl = JSON.stringify([
      { id: 1, itemId: "madera_dura", cantidad: 4, x: 0, y: 0, rot: 0 },
      { id: 2, itemId: "venda", cantidad: 2, x: 1, y: 0, rot: 0 },
      { id: 3, itemId: "tablilla", cantidad: 2, x: 2, y: 0, rot: 0 },
    ]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 4, ?)").run(itemsJarl);
    const itemsB = JSON.stringify([{ id: 1, itemId: "lingote_hierro", cantidad: 3, x: 0, y: 0, rot: 0 }]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (2, 'cuerpo', 8, 6, 2, ?)").run(itemsB);

    // silla_pino sembrada DIRECTAMENTE (bypass de "construir", ver
    // comentario de cabecera) — "propiedad" solo necesita ser un id de
    // parcela real para que iniciarConstruccion() la cargue en ctx.vivas
    // (parcelas.parcelas.has(c.propiedad)); no importa que esté lejos, el
    // dueño real de esa parcela es irrelevante aquí (nunca pasa por
    // validarColocacion, que es lo único que lo comprobaría).
    const r = bd
      .prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("p_0001", "silla_pino", "mueble", SILLA_XY.x, SILLA_XY.y, 0, 0, null, ahora);
    sillaId = Number(r.lastInsertRowid);
    bd.close();
  }
  console.log(`  silla_pino sembrada, id=${sillaId}, en (${SILLA_XY.x},${SILLA_XY.y}) — a 1 paso del spawn (${SPAWN.x},${SPAWN.y})`);

  const ENV_SERVIDOR = { JARL_NOMBRES: "Jarl", BD_RUTA };
  let servidor = lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), ENV_SERVIDOR);
  let browser, browserB;

  try {
    lanzar("npx", ["vite", "--port", "5198", "--strictPort"], path.join(RAIZ, "client"));
    await esperarPuerto("http://localhost:5198/");
    await esperarPuerto("http://localhost:2567/");

    // Un proceso de Chromium POR JUGADOR (no browser.newContext() sobre el
    // mismo) — confirmado en mesaAjedrez.e2e.cjs que 2 pestañas de un solo
    // proceso compiten por el mismo hilo y una se queda sin CPU real.
    const ARGS_CHROMIUM = [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
    browser = await chromium.launch({ args: ARGS_CHROMIUM });
    browserB = await chromium.launch({ args: ARGS_CHROMIUM });

    const erroresConsola = [];
    const vigilar = (pagina, etiqueta) => {
      // SIN filtrar por type: la sesión anterior (mesaAjedrez) perdió mucho
      // tiempo porque los console.log("[xxx]", motivo) de game.ts (motivo
      // real de cada "*:error" del servidor) son type "log", no "error", y
      // un listener que solo miraba "error" nunca los mostraba. Aquí se
      // reenvían TODOS los mensajes que empiezan por "[" (la convención de
      // logging de game.ts), de cualquier tipo, en vivo.
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
    // esperar a que la carga async de vida/anatomía persistida del onJoin
    // (HubRoom.ts) resuelva antes de dar por bueno el estado inicial de B.
    const anatomiaBLista = await esperarCondicion(
      async () => {
        const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
        return j?.anatomia?.torso?.sangrado === true ? j : null;
      },
      10000,
    );
    comprobar(!!anatomiaBLista, `anatomía persistida de Jugador2 cargada en el servidor (torso.sangrado=true, piernaIzq.fractura=${anatomiaBLista?.anatomia?.piernaIzq?.fractura})`);

    // =====================================================================
    sistema("1) COMERCIO DIRECTO ENTRE 2 JUGADORES (comercio:solicitar/ofrecer/confirmar)");
    // =====================================================================
    await paginaA.evaluate(() => window.__test.enviar("comercio:solicitar"));
    await esperar(400);
    await paginaB.evaluate(() => window.__test.enviar("comercio:solicitar"));
    const comercioA = await esperarCondicion(() => paginaA.evaluate(() => window.__test.comercioPropio()), 5000);
    const comercioB = await esperarCondicion(() => paginaB.evaluate(() => window.__test.comercioPropio()), 5000);
    comprobar(!!comercioA && !!comercioB, `comercio abierto y visible en AMBOS clientes (A=${JSON.stringify(comercioA)})`);

    const itemsA0 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const itemsB0 = await paginaB.evaluate(() => window.__test.inventarioCuerpo());
    const maderaA = itemsA0.find((i) => i.itemId === "madera_dura");
    const hierroB = itemsB0.find((i) => i.itemId === "lingote_hierro");
    comprobar(!!maderaA && !!hierroB, `ítems sembrados presentes antes de ofertar (A tiene madera_dura=${!!maderaA}, B tiene lingote_hierro=${!!hierroB})`);

    await paginaA.evaluate((id) => window.__test.enviar("comercio:ofrecer", { instanciaId: id }), maderaA.id);
    await paginaB.evaluate((id) => window.__test.enviar("comercio:ofrecer", { instanciaId: id }), hierroB.id);
    const comercioConOfertas = await esperarCondicion(
      async () => {
        const c = await paginaA.evaluate(() => window.__test.comercioPropio());
        return c && c.ofertaA.length === 1 && c.ofertaB.length === 1 ? c : null;
      },
      5000,
    );
    comprobar(!!comercioConOfertas, `oferta de cada jugador reflejada en el estado sincronizado (${JSON.stringify(comercioConOfertas)})`);

    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "barrido_1_comercio_ofertas.png") }).catch(() => {});

    await paginaA.evaluate(() => window.__test.enviar("comercio:confirmar"));
    await paginaB.evaluate(() => window.__test.enviar("comercio:confirmar"));
    const comercioCerrado = await esperarCondicion(
      async () => (await paginaA.evaluate(() => window.__test.comercioPropio())) === null,
      5000,
    );
    comprobar(comercioCerrado !== null, "comercio se cerró tras la doble confirmación (completado)");

    const itemsA1 = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    const itemsB1 = await paginaB.evaluate(() => window.__test.inventarioCuerpo());
    comprobar(
      itemsA1.some((i) => i.itemId === "lingote_hierro" && i.cantidad === 3) && !itemsA1.some((i) => i.itemId === "madera_dura"),
      `A recibió lingote_hierro y perdió madera_dura (inventario A: ${JSON.stringify(itemsA1)})`,
    );
    comprobar(
      itemsB1.some((i) => i.itemId === "madera_dura" && i.cantidad === 4) && !itemsB1.some((i) => i.itemId === "lingote_hierro"),
      `B recibió madera_dura y perdió lingote_hierro (inventario B: ${JSON.stringify(itemsB1)})`,
    );
    cerrarSistema();

    // =====================================================================
    sistema("2) GREMIOS (gremio:fundar/invitar/aceptarInvitacion)");
    // =====================================================================
    await paginaA.evaluate(() => window.__test.enviar("gremio:fundar", { nombre: "TestGremio" }));
    const estadoFundado = await esperarCondicion(() => paginaA.evaluate(() => window.__test.ultimoEstadoGremio()), 5000);
    comprobar(!!estadoFundado && estadoFundado.nombre === "TestGremio" && estadoFundado.miembros?.length === 1, `Jarl fundó "TestGremio" (${JSON.stringify(estadoFundado)})`);

    await paginaA.evaluate(() => window.__test.enviar("gremio:invitar", { jugadorNombre: "Jugador2" }));
    const invitacionB = await esperarCondicion(() => paginaB.evaluate(() => window.__test.ultimaInvitacionGremio()), 5000);
    comprobar(!!invitacionB && invitacionB.gremioNombre === "TestGremio", `Jugador2 recibió la invitación real por su nombre (${JSON.stringify(invitacionB)})`);

    await paginaB.evaluate((gid) => window.__test.enviar("gremio:aceptarInvitacion", { gremioId: gid }), invitacionB.gremioId);
    const estadoTrasAceptarB = await esperarCondicion(() => paginaB.evaluate(() => window.__test.ultimoEstadoGremio()), 5000);
    comprobar(
      !!estadoTrasAceptarB && estadoTrasAceptarB.miembros?.length === 2 && estadoTrasAceptarB.miembros.some((m) => m.jugadorNombre === "Jugador2"),
      `Jugador2 se ve a sí mismo como miembro tras aceptar (${JSON.stringify(estadoTrasAceptarB)})`,
    );

    // el estado de A hay que refrescarlo con un gremio:estado explícito
    // (A no manda otro mensaje desde que fundó) — confirma que el gremio
    // SINCRONIZADO en el servidor ya tiene a los 2, visto desde el OTRO
    // cliente. OJO: `ultimoEstadoGremio()` YA es truthy desde la respuesta
    // de "fundar" (1 miembro) — esperar solo "truthy" da un falso negativo
    // (lee el valor viejo antes de que llegue la respuesta fresca), así que
    // la condición exige ver a Jugador2 en el roster, no cualquier valor.
    await paginaA.evaluate(() => window.__test.enviar("gremio:estado"));
    const estadoTrasAceptarA = await esperarCondicion(async () => {
      const e = await paginaA.evaluate(() => window.__test.ultimoEstadoGremio());
      return e && e.miembros?.some((m) => m.jugadorNombre === "Jugador2") ? e : null;
    }, 5000);
    comprobar(
      !!estadoTrasAceptarA && estadoTrasAceptarA.miembros?.some((m) => m.jugadorNombre === "Jugador2"),
      `Jarl (fundador) ve a Jugador2 en el roster del gremio (${JSON.stringify(estadoTrasAceptarA)})`,
    );

    const etiquetaB = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
    comprobar(etiquetaB?.gremioNombre === "TestGremio", `etiqueta pública de gremio de B (nametag) replicada y visible para A (${JSON.stringify({ gremioId: etiquetaB?.gremioId, gremioNombre: etiquetaB?.gremioNombre })})`);
    cerrarSistema();

    // =====================================================================
    sistema("3) MEDICO CURANDO A OTRO JUGADOR (medico:vendar/entablillar)");
    // =====================================================================
    comprobar(
      anatomiaBLista.anatomia.torso.sangrado === true && anatomiaBLista.anatomia.piernaIzq.fractura === true,
      "Jugador2 arranca con una herida real (torso sangrando + pierna fracturada, sembrada en BD)",
    );

    await paginaA.evaluate((sid) => window.__test.enviar("medico:vendar", { targetSessionId: sid, zona: "torso", conUnguento: false }), sessionIdB);
    const torsoCuradoVistoPorA = await esperarCondicion(
      async () => {
        const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
        return j?.anatomia?.torso?.sangrado === false ? j : null;
      },
      5000,
    );
    comprobar(!!torsoCuradoVistoPorA, "torso ya no sangra, visto por A (el médico) tras vendar a Jugador2");
    const torsoCuradoVistoPorB = await paginaB.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
    comprobar(torsoCuradoVistoPorB?.anatomia?.torso?.sangrado === false, "torso ya no sangra, visto por B (el paciente) sobre sí mismo — sincronizado en ambos clientes");

    await paginaA.evaluate((sid) => window.__test.enviar("medico:entablillar", { targetSessionId: sid, zona: "piernaIzq" }), sessionIdB);
    const piernaCurada = await esperarCondicion(
      async () => {
        const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
        return j?.anatomia?.piernaIzq?.fractura === false ? j : null;
      },
      5000,
    );
    comprobar(!!piernaCurada, "fractura de piernaIzq ya no activa tras entablillar a Jugador2 (visto por A)");

    const itemsATrasCurar = await paginaA.evaluate(() => window.__test.inventarioCuerpo());
    comprobar(itemsATrasCurar.find((i) => i.itemId === "venda")?.cantidad === 1, `la venda se consumió del inventario del médico (${JSON.stringify(itemsATrasCurar.find((i) => i.itemId === "venda"))})`);
    comprobar(itemsATrasCurar.find((i) => i.itemId === "tablilla")?.cantidad === 1, `la tablilla se consumió del inventario del médico (${JSON.stringify(itemsATrasCurar.find((i) => i.itemId === "tablilla"))})`);
    cerrarSistema();

    // =====================================================================
    sistema("4) ASIENTO GENÉRICO (asiento:sentarse/levantarse, silla_pino)");
    // =====================================================================
    await paginaB.evaluate((id) => window.__test.enviar("asiento:sentarse", { construccionId: id }), sillaId);
    const sentadoVistoPorB = await esperarCondicion(
      async () => {
        const j = await paginaB.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
        return j?.sentado === true ? j : null;
      },
      5000,
    );
    comprobar(!!sentadoVistoPorB, "B sentado=true, visto por B mismo tras asiento:sentarse real");
    const sentadoVistoPorA = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
    comprobar(sentadoVistoPorA?.sentado === true, "B sentado=true replicado y visto por A (el otro cliente)");

    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "barrido_2_asiento_sentado.png") }).catch(() => {});

    await paginaB.evaluate(() => window.__test.enviar("asiento:levantarse"));
    const levantadoVistoPorA = await esperarCondicion(
      async () => {
        const j = await paginaA.evaluate((sid) => window.__test.jugador(sid), sessionIdB);
        return j?.sentado === false ? j : null;
      },
      5000,
    );
    comprobar(!!levantadoVistoPorA, "B se levantó (sentado=false), replicado y visto por A tras asiento:levantarse real");
    cerrarSistema();

    // =====================================================================
    sistema("5) COMBATE PVE COOPERATIVO (combate:iniciar + combate:unirse) — STRETCH, solo si hay fauna a mano");
    // =====================================================================
    const objetivo = await esperarCondicion(
      () => paginaA.evaluate((s) => window.__test.faunaCercana(s.x, s.y, s.r), { x: SPAWN.x, y: SPAWN.y, r: 25 }),
      20000,
      1000,
    );
    const RADIO_INTERACCION_CLIENTE = 2.2; // debe coincidir con el real del servidor (RoomExteriorBase.ts)
    if (!objetivo || objetivo.dist > RADIO_INTERACCION_CLIENTE) {
      const motivo = !objetivo
        ? "sin fauna activa a <25 casillas del spawn del Hub en 20s (sector-activada, no determinista sin caminar)"
        : `la fauna más cercana (${objetivo.especieId}) está a ${objetivo.dist.toFixed(1)} casillas — combate:iniciar exige RADIO_INTERACCION (${RADIO_INTERACCION_CLIENTE}), y llegar hasta ahí requiere caminar de verdad (justo lo que este barrido evita)`;
      console.log(`PENDIENTE - ${motivo} — necesitaría una sesión aparte con caminata real (o el mapa demo, más pequeño, como combate.e2e.mjs); anotado, no bloquea el resto del barrido.`);
      resultados[resultados.length - 1].ok = null; // ni pass ni fail: no llegó
    } else {
      console.log(`  fauna encontrada: ${objetivo.especieId} (${objetivo.id}) a ${objetivo.dist.toFixed(1)} casillas del spawn`);
      await paginaA.evaluate((oid) => window.__test.enviar("combate:iniciar", { objetivoId: oid }), objetivo.id);
      // localizar el combate recién abierto (sin mensaje de vuelta con el
      // id): A debe aparecer como unidad en algún combate "pendiente".
      const combateId = await esperarCondicion(async () => {
        const combates = await paginaA.evaluate(() => window.__test.combates());
        const propio = combates.find((c) => c.unidades.includes(sessionIdA));
        return propio ? propio.id : null;
      }, 5000);
      comprobar(!!combateId, `combate:iniciar abrió una ventana de unión con A dentro (combateId=${combateId})`);
      if (combateId) {
        const faseAntes = await paginaA.evaluate((cid) => window.__test.combateEstado(cid), combateId);
        comprobar(faseAntes?.fase === "pendiente", `fase "pendiente" (ventana de unión abierta) antes de que B se una (${JSON.stringify(faseAntes)})`);
        await paginaB.evaluate((cid) => window.__test.enviar("combate:unirse", { combateId: cid }), combateId);
        const conBDentro = await esperarCondicion(async () => {
          const e = await paginaA.evaluate((cid) => window.__test.combateEstado(cid), combateId);
          return e && e.unidades.includes(sessionIdB) ? e : null;
        }, 5000);
        comprobar(!!conBDentro, `B se unió al combate co-op (combate:unirse real), visto desde A (${JSON.stringify(conBDentro)})`);
      }
      cerrarSistema();
    }

    comprobar(erroresConsola.length === 0, `sin errores de consola inesperados (${erroresConsola.slice(0, 8).join(" | ")})`);
  } finally {
    if (typeof browser !== "undefined") await browser.close().catch(() => {});
    if (typeof browserB !== "undefined") await browserB.close().catch(() => {});
    matarTodo();
    fs.rmSync(BD_RUTA, { force: true });
  }

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
