"use strict";

// E2E de la mesa de AJEDREZ (docs/GDD_Mesas_Minijuego.md) de punta a punta:
// servidor Colyseus + BD sqlite sembrada (jugador "Jarl" con los insumos de
// la receta ya en el cuerpo — mismo patrón de siembra directa que
// server/test/herramientasRecoleccion.e2e.mjs/persistenciaEquipo.e2e.mjs,
// NUNCA usado como atajo del FLUJO que se prueba, solo para no tener que
// re-simular aquí la recolección/refinamiento de materias primas, que ya
// tiene su propio e2e) + vite, DOS contextos de Playwright (Jarl/blancas y
// Jugador2/negras) recorriendo el camino REAL de un jugador:
//   1) Jarl elige oficio ingeniero y construye una mesa_delineante (gratis,
//      nivel 1) — "construir" real, mismo protocolo que docs/GDD_Construccion.
//   2) Jarl craftea "mesa_ajedrez_craft" en ella — crafteo:iniciar/recolectar
//      reales (sin panel de cliente todavía: no existe ningún panel de
//      crafteo en este repo hoy, así que se manda el mensaje Colyseus real
//      directamente — el MISMO protocolo que usaría ese panel el día que
//      exista, ver window.__ajedrez en client/src/game.ts).
//   3) Jarl COLOCA el mueble "mesa_ajedrez" con "construir" — el servidor
//      exige y consume el ítem craftado (requiereItemColocar).
//   4) Los dos jugadores se sientan (mensaje real "mesa:sentarse", validado
//      por el servidor con la distancia real tras caminar hasta la silla —
//      vía la sonda window.__ajedrez.sentarse, mismo criterio que
//      window.__carpintero/__sastre/__ingeniero: evita pelear con el
//      raycast del clic 3D en Playwright, ver sentarseConReintentos abajo;
//      en el juego real esto lo dispara un clic sobre la mesa, docs/
//      GDD_Mesas_Minijuego.md §8).
//   5) Con las 2 sillas ocupadas la partida arranca sola (fase "activo");
//      blancas mueven e2-e4 con dos clics REALES sobre el tablero DOM.
// Capturas en las 4 fases pedidas por el streamer, mismo patrón de spawn
// detached + kill de grupo que construccion.e2e.cjs/streaming.e2e.cjs.
//
// Ejecutar desde la raíz del repo:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/mesaAjedrez.e2e.cjs

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ, "assets", "mapas", "principal");
const BD_RUTA = path.join(os.tmpdir(), "colony_mesa_ajedrez_e2e.sqlite");
const CARPETA_CAPTURAS = "/tmp/claude-0/-home-user-Colony/e8c71677-b419-58f7-9cf0-a5b254d848d9/scratchpad";
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
// Mismo espejo MÍNIMO de la rejilla del servidor que construccion.e2e.cjs
// (mundo/mapaColision.ts): una casilla vale si su terreno es tierra
// transitable y no tiene encima un prop con colisión del bake.
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
  const sectores = new Map();
  const propsPorChunk = new Map();

  return function esTierraLibre(x, y) {
    const cx = Math.floor(x / T), cy = Math.floor(y / T);
    const claveSector = `${Math.floor(cx / S)}_${Math.floor(cy / S)}`;
    if (!sectores.has(claveSector)) {
      const ruta = path.join(RUTA_MAPA, `sector_${pad3(Math.floor(cx / S))}_${pad3(Math.floor(cy / S))}.json`);
      sectores.set(claveSector, fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : null);
    }
    const sector = sectores.get(claveSector);
    const chunk = sector && sector.chunks[`${cx}_${cy}`];
    if (!chunk) return false;

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

/**
 * ¿Línea recta de (x0,y0) a (x1,y1) enteramente sobre tierra libre? Muestreo
 * denso (cada ~0.25 casillas) — confirmado con VARIOS diagnósticos aparte
 * que SÍ hay obstáculos sueltos de 1 casilla cerca del spawn (p.ej. un prop
 * justo en (1591,1600)), y que sin evitarlos el jugador puede quedarse
 * pegado a uno de ellos DECENAS de segundos sin el pathfinding real del
 * juego (el A* de caminos del baker es solo offline, RoomExteriorBase.ts
 * nunca lo expone en vivo) — mejor elegir de antemano un hueco con línea
 * despejada que fiarlo todo al esquive reactivo de `caminarHacia`.
 *
 * BUG real encontrado y corregido aquí: una primera versión redondeaba
 * (x,y) al muestrear — con una línea casi horizontal (dy pequeño en todo el
 * trayecto), el `y` interpolado en el punto exacto del obstáculo puede
 * redondear a la fila DE AL LADO y saltárselo por 1 sola casilla (pasó de
 * verdad: el trayecto recto spawn->p_0003 pasaba muy cerca de (1591,1600) y
 * el muestreo redondeaba a y=1601, dejando pasar un obstáculo real que
 * frenó al jugador un minuto entero en un e2e real). Corregido comprobando
 * un PEQUEÑO CORREDOR (`Math.floor` Y `Math.ceil` de x e y en cada muestra,
 * no solo el redondeo más cercano) — cualquier prop de 1 casilla pegado a
 * la línea recta, no solo exactamente sobre ella, lo descarta.
 */
function lineaDespejada(esTierraLibre, x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const pasos = Math.max(1, Math.ceil(dist * 4));
  for (let i = 0; i <= pasos; i++) {
    const t = i / pasos;
    const mx = x0 + (x1 - x0) * t, my = y0 + (y1 - y0) * t;
    for (const cx of [Math.floor(mx), Math.ceil(mx)]) {
      for (const cy of [Math.floor(my), Math.ceil(my)]) {
        if (!esTierraLibre(cx, cy)) return false;
      }
    }
  }
  return true;
}

/**
 * Busca dentro de una parcela un hueco libre wxh (ambos ejes) que no pise
 * `reservadas` — mismo criterio que el buscador de la "casa 6x7" de
 * construccion.e2e.cjs, generalizado, MÁS una preferencia por el candidato
 * con LÍNEA RECTA despejada desde `cercaDe` (si se da) y, entre esos, el más
 * cercano: el jugador tiene que CAMINAR hasta aquí de verdad (RADIO_INTERACCION
 * real al sentarse) con el mismo movimiento simple del juego (sin
 * pathfinding en vivo), así que evitar un rodeo de antemano ahorra minutos
 * reales de e2e.
 */
function buscarHueco(parcela, esTierraLibre, reservadas, w, h, cercaDe) {
  const filas = new Map();
  for (const [y, x0, x1] of parcela.runs) {
    for (let x = x0; x <= x1; x++) {
      if (!esTierraLibre(x, y)) continue;
      if (!filas.has(y)) filas.set(y, []);
      filas.get(y).push(x);
    }
  }
  const libre = (x, y) => (filas.get(y) || []).includes(x) && !reservadas.has(`${x},${y}`);
  const candidatos = [];
  for (const y of filas.keys()) {
    for (const x of filas.get(y)) {
      let cabe = true;
      for (let dy = 0; dy < h && cabe; dy++) for (let dx = 0; dx < w && cabe; dx++) cabe = libre(x + dx, y + dy);
      if (cabe) candidatos.push({ x, y });
    }
  }
  let mejor = null;
  if (cercaDe) {
    let mejorRango = Infinity, mejorDist = Infinity;
    for (const c of candidatos) {
      const cx = c.x + w / 2, cy = c.y + h / 2;
      const dist = Math.hypot(cx - cercaDe.x, cy - cercaDe.y);
      const rango = lineaDespejada(esTierraLibre, cercaDe.x, cercaDe.y, cx, cy) ? 0 : 1; // despejados primero, luego por distancia
      if (rango < mejorRango || (rango === mejorRango && dist < mejorDist)) { mejorRango = rango; mejorDist = dist; mejor = c; }
    }
  } else {
    mejor = candidatos[0] ?? null;
  }
  if (mejor) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) reservadas.add(`${mejor.x + dx},${mejor.y + dy}`);
  return mejor;
}

/**
 * Búsqueda de hueco para mesa_ajedrez [3,2] con RUTA EN DOS TRAMOS
 * verificada de antemano: spawn -> (spawn.x, filaAsientos) -> asiento.
 *
 * Por qué dos tramos y no la línea recta de `buscarHueco`/`lineaDespejada`
 * directa: confirmado con VARIOS diagnósticos reales (no solo lectura del
 * bake) que la diagonal directa desde el spawn a CUALQUIER punto dentro de
 * p_0003 pasa rozando un obstáculo suelto real junto a (1591,1600), y que
 * dejarlo solo en manos del esquive reactivo de `caminarHacia` cuesta
 * DECENAS de segundos por si solo — a veces más que el propio timeout.
 * Buscando de antemano una FILA de asientos concreta con línea recta
 * despejada en los dos tramos (spawn->waypoint y waypoint->asiento, para
 * AMBAS sillas) el paseo real se resuelve en un puñado de segundos.
 *
 * Ambos asientos de mesa_ajedrez comparten la MISMA `dy` (1.0, ver
 * mesasJuego.ts) — así que colocando la mesa con su fila superior en
 * `filaAsientos - 1`, las dos sillas caen exactamente en `filaAsientos`.
 */
function buscarHuecoMesaAjedrezConRuta(parcela, esTierraLibre, reservadas, spawn) {
  const FILAS_ASIENTOS_CANDIDATAS = [1605, 1612, 1597, 1592, 1608, 1602, 1591, 1600];
  const waypoint = { x: spawn.x, y: 0 };
  for (const filaAsientos of FILAS_ASIENTOS_CANDIDATAS) {
    waypoint.y = filaAsientos;
    if (!lineaDespejada(esTierraLibre, spawn.x, spawn.y, waypoint.x, waypoint.y)) continue;
    const yMesa = filaAsientos - 1;
    const filaSup = parcela.runs.filter((r) => r[0] === yMesa);
    const filaInf = parcela.runs.filter((r) => r[0] === yMesa + 1);
    if (!filaSup.length || !filaInf.length) continue;
    let mejorX = null, mejorDist = Infinity;
    for (const [, x0, x1] of filaSup) {
      for (let x = x0; x <= x1 - 2; x++) {
        let cabe = true;
        for (let dy = 0; dy < 2 && cabe; dy++) for (let dx = 0; dx < 3 && cabe; dx++) cabe = esTierraLibre(x + dx, yMesa + dy) && !reservadas.has(`${x + dx},${yMesa + dy}`);
        if (!cabe) continue;
        if (!filaInf.some(([, rx0, rx1]) => x >= rx0 && x + 2 <= rx1)) continue;
        const dist = Math.abs(x + 1.5 - spawn.x);
        if (dist < mejorDist) { mejorDist = dist; mejorX = x; }
      }
    }
    if (mejorX == null) continue;
    const posBlancas = { x: mejorX + 2.5, y: filaAsientos };
    const posNegras = { x: mejorX + 0.5, y: filaAsientos };
    if (!lineaDespejada(esTierraLibre, waypoint.x, waypoint.y, posBlancas.x, posBlancas.y)) continue;
    if (!lineaDespejada(esTierraLibre, waypoint.x, waypoint.y, posNegras.x, posNegras.y)) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) reservadas.add(`${mejorX + dx},${yMesa + dy}`);
    return { x: mejorX, y: yMesa, waypoint: { x: spawn.x, y: filaAsientos } };
  }
  return null;
}

/**
 * Mueve al jugador hacia (tx,ty) MANTENIENDO las teclas pulsadas de verdad —
 * sube/baja solo cuando la dirección deseada cambia, NUNCA suelta-y-vuelve-
 * a-pulsar en cada ráfaga. Confirmado aparte con un diagnóstico dedicado:
 * el movimiento del juego tiene una rampa de arranque real de varios
 * segundos (soltar y repulsar cada pocos cientos de ms nunca llega a coger
 * velocidad de crucero — y un "detector de atasco" con un margen más corto
 * que esa rampa se dispara en FALSO constantemente, deshaciendo el propio
 * progreso). Por eso el margen de "atasco" aquí es generoso (6s) y se mide
 * sobre la posición de hace 6s, no sobre la última muestra.
 */
async function caminarHacia(pagina, tx, ty, timeoutMs = 240000) {
  const inicio = Date.now();
  let teclasActuales = new Set();
  let historial = []; // [{t, x, y}] — ventana larga para el chequeo de atasco
  let nudgeHasta = 0;
  let atascosSeguidos = 0;
  try {
    while (Date.now() - inicio < timeoutMs) {
      const pos = await pagina.evaluate(() => window.__colonyDebug ?? null);
      if (!pos) { await esperar(150); continue; }
      const ahora = Date.now();
      const dx = tx - pos.x, dy = ty - pos.y;
      // 1.5, no 0.7: solo hace falta caer DENTRO de RADIO_INTERACCION (2.2)
      // para poder sentarse — perseguir una tolerancia más estrecha que esa
      // solo alarga el paseo sin aportar nada al e2e.
      if (Math.hypot(dx, dy) < 1.5) return true;

      historial.push({ t: ahora, x: pos.x, y: pos.y });
      historial = historial.filter((h) => ahora - h.t <= 12000);

      let deseadas;
      if (ahora < nudgeHasta) {
        deseadas = teclasActuales; // esquive en curso: no lo interrumpas a media ráfaga
      } else if (historial.length > 3 && ahora - historial[0].t >= 11000 && Math.hypot(pos.x - historial[0].x, pos.y - historial[0].y) < 1.2) {
        // 12s sosteniendo la MISMA dirección y apenas 1.2 unidades de avance real: esto sí es un atasco de verdad (no la rampa de arranque, confirmada de sobra más lenta que esto con varios diagnósticos dedicados)
        //
        // Secuencia FIJA en vez de azar puro (bug real encontrado en un e2e
        // real: con 2 opciones a cara-o-cruz, varias tiradas seguidas pueden
        // repetir el mismo lado "malo" y el personaje se queda rebotando
        // contra el mismo obstáculo de 1 casilla los 4 minutos enteros del
        // timeout sin nunca probar la otra perpendicular, ni retroceder).
        // Ciclo perpendicular+ -> perpendicular- -> retroceder del objetivo
        // -> perpendicular- otra vez (por si la primera vez no bastó de
        // ancho): cada atasco sucesivo prueba algo DISTINTO al anterior,
        // nunca repite la tirada que ya falló.
        const perpA = Math.abs(dx) >= Math.abs(dy) ? "w" : "a";
        const perpB = Math.abs(dx) >= Math.abs(dy) ? "s" : "d";
        const retroceder = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "a" : "d") : (dy > 0 ? "w" : "s");
        const secuenciaEsquive = [perpA, perpB, retroceder, perpB];
        const tecla = secuenciaEsquive[atascosSeguidos % secuenciaEsquive.length];
        atascosSeguidos++;
        deseadas = new Set([tecla]);
        nudgeHasta = ahora + 3500;
        historial = [];
        console.log(`  [caminar] atascado de verdad cerca de (${pos.x.toFixed(1)},${pos.y.toFixed(1)}) -> esquive '${tecla}' (intento ${atascosSeguidos})`);
      } else {
        deseadas = new Set();
        if (dx > 0.3) deseadas.add("d"); else if (dx < -0.3) deseadas.add("a");
        if (dy > 0.3) deseadas.add("s"); else if (dy < -0.3) deseadas.add("w");
      }
      if (deseadas !== teclasActuales) {
        for (const k of teclasActuales) if (!deseadas.has(k)) await pagina.keyboard.up(k);
        for (const k of deseadas) if (!teclasActuales.has(k)) await pagina.keyboard.down(k);
        teclasActuales = deseadas;
      }
      // Confirmado con varios diagnósticos dedicados: el movimiento del
      // juego tiene una rampa de arranque de VARIOS segundos reales (no
      // ~300ms) — sondear cada 300ms no aporta nada de responsividad extra
      // que importe aquí y sí puede competir por el mismo hilo de JS de la
      // página con su propio bucle de render/interpolación. 2s de margen
      // entre sondeos, igual de capaz de detectar el objetivo o un atasco
      // real (las ventanas de arriba ya son de varios segundos).
      await esperar(2000);
    }
    return false;
  } finally {
    for (const k of teclasActuales) await pagina.keyboard.up(k).catch(() => {});
  }
}

/**
 * Corrección FINA a base de toques cortos (no mantener la tecla) — para el
 * último tramo antes de sentarse, no para recorrer distancia. `caminarHacia`
 * mantiene la tecla pulsada y sondea cada 2s: a velocidad de crucero eso deja
 * un margen real de sobrepaso entre "el cliente ve que ya llegó" y "el
 * servidor confirma que está quieto ahí" (input -> servidor -> simulación ->
 * patch de vuelta), y sin colisión sólida en la mesa (necesaria para poder
 * pisar la silla, `anchorType:"FLOOR_DECAL"`) ya no hay nada que frene ese
 * sobrepaso en seco. Un toque de 250ms + un asentamiento real de 700ms antes
 * de volver a mirar avanza poco por paso pero dejando each vez que la
 * posición real (la misma que valida el servidor) se estabilice del todo.
 */
async function creepHacia(pagina, tx, ty, maxPasos = 10) {
  for (let i = 0; i < maxPasos; i++) {
    const pos = await pagina.evaluate(() => window.__colonyDebug ?? null);
    if (!pos) { await esperar(200); continue; }
    const dx = tx - pos.x, dy = ty - pos.y;
    if (Math.hypot(dx, dy) < 0.8) return true;
    const tecla = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "d" : "a") : (dy > 0 ? "s" : "w");
    await pagina.keyboard.down(tecla);
    await esperar(250);
    await pagina.keyboard.up(tecla);
    await esperar(1200);
  }
  const posFinal = await pagina.evaluate(() => window.__colonyDebug ?? null);
  return !!(posFinal && Math.hypot(tx - posFinal.x, ty - posFinal.y) < 1.0);
}

/**
 * Se usa la sonda de test `window.__ajedrez.sentarse` (el MISMO mensaje
 * Colyseus real "mesa:sentarse", validado por el servidor con la MISMA
 * RADIO_INTERACCION real — nunca salta validación) en vez de disparar el
 * clic 3D real sobre la mesa: mismo criterio que
 * `carpinteroIngenieroLegendario.e2e.cjs` con window.__carpintero/__ingeniero
 * — acertar el raycast de Playwright sobre un mesh concreto es frágil, y
 * aquí lo que se quiere verificar es el PROTOCOLO/mecánica de la partida, no
 * el raycast del navegador (en el juego real la interacción es un clic
 * sobre la mesa → menú → "Jugar al ajedrez", docs/GDD_Mesas_Minijuego.md §8
 * — hasta 2026-09-01 era tecla F con auto-apuntado por proximidad, que
 * sentaba de forma inconsistente sin patrón encontrado, GDD §7bis.4; se
 * sustituyó el mecanismo entero en vez de seguir persiguiendo esa
 * detección).
 *
 * Los reintentos de aquí abajo cubren un problema DISTINTO y real (§7bis.3
 * del GDD): entre soltar las teclas de `caminarHacia` (declara "llegado" en
 * el sondeo de cada 2s) y que el servidor confirme la posición final hay una
 * vuelta de red real (input -> servidor -> simulación -> patch de vuelta) —
 * sentarse justo en ese hueco puede validar contra una posición todavía en
 * movimiento. Por eso se re-lee la posición real y se reintenta con
 * `creepHacia` si hace falta, en vez de fiarlo todo al primer intento.
 */
async function sentarseConReintentos(pagina, construccionId, sessionIdPropio, objetivo, silla, intentos = 7) {
  for (let i = 0; i < intentos; i++) {
    // Asentar de verdad antes de intentar: `caminarHacia` declara "llegado"
    // en cuanto el ÚLTIMO sondeo (cada 2s) cae dentro de 1.5 — pero entre
    // soltar las teclas y que el servidor confirme el "quieto" real hay una
    // vuelta de red real (input -> servidor -> simulación -> replicación de
    // vuelta al cliente). Sentarse justo en ese hueco puede validar contra
    // una posición todavía en movimiento. 2.5s de margen + re-leer la
    // posición real (misma fuente que usa el propio servidor para validar)
    // antes de mandar el mensaje, en vez de fiarlo todo al primer intento.
    await esperar(2500);
    if (objetivo) {
      const pos = await pagina.evaluate(() => window.__colonyDebug ?? null);
      if (pos && Math.hypot(objetivo.x - pos.x, objetivo.y - pos.y) > 1.0) {
        await creepHacia(pagina, objetivo.x, objetivo.y);
        await esperar(1000);
      }
    }
    await pagina.evaluate(({ id, s }) => window.__ajedrez.sentarse(id, s), { id: construccionId, s: silla });
    await esperar(600);
    const estado = await pagina.evaluate((id) => window.__ajedrez.estado(id), construccionId);
    if (estado && (estado.sillaBlancas === sessionIdPropio || estado.sillaNegras === sessionIdPropio)) return true;
  }
  return false;
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

  for (const puerto of [5199, 2567]) {
    const ocupado = await fetch(`http://localhost:${puerto}/`).then(() => true).catch(() => false);
    if (ocupado) throw new Error(`El puerto ${puerto} ya está ocupado (proceso zombi de otra ronda) — mátalo antes de correr el e2e`);
  }

  let fallos = 0;
  const comprobar = (condicion, mensaje) => {
    console.log(`${condicion ? "ok" : "FALLO"} - ${mensaje}`);
    if (!condicion) fallos++;
  };

  fs.rmSync(BD_RUTA, { force: true });

  console.log("1) sembrando BD sqlite temporal — Jarl con los insumos de la receta ya en el cuerpo (madera_dura x6, lingote_hierro x3; la receta pide 4 y 2 — sobra margen)...");
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
    `);
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, 'Jarl', ?)").run(new Date().toISOString());
    const items = JSON.stringify([
      { id: 1, itemId: "madera_dura", cantidad: 6, x: 0, y: 0, rot: 0 },
      { id: 2, itemId: "lingote_hierro", cantidad: 3, x: 1, y: 0, rot: 0 },
    ]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 3, ?)").run(items);
    bd.close();
  }

  // p_0003 ("Bancal de la Vieja Muralla", x 1510-1529, y 1590-1612): misma
  // banda de Y que el spawn (1600.5,1600.5) y camino tierra firme sin agua
  // de por medio — comprobado aparte con la rejilla de colisión real; p_0001
  // (la que usa construccion.e2e.cjs) queda al otro lado de un lago/río que
  // corta la ruta recta, así que aquí se elige la parcela que SÍ es
  // caminable en línea razonablemente recta desde el spawn.
  const PARCELA_ID = "p_0003";
  console.log(`2) eligiendo casillas de colocación dentro de ${PARCELA_ID} (mesa_delineante 1x1 + mesa_ajedrez 3x2, sin solaparse)...`);
  const parcelas = JSON.parse(fs.readFileSync(path.join(RUTA_MAPA, "parcelas.json"), "utf8"));
  const esTierraLibre = crearConsultaTierra();
  const reservadas = new Set();
  // spawn del Hub (server/src/index.ts lo imprime al arrancar): elegir el
  // hueco más cercano de verdad ahorra minutos de caminata al e2e.
  const SPAWN = { x: 1600.5, y: 1600.5 };
  // mesa_delineante: no hace falta caminar hasta ella (crafteo:iniciar/
  // recolectar no comprueban distancia — confirmado leyendo
  // RoomExteriorBase.ts::manejarCrafteoIniciar, sin RADIO_INTERACCION ahí),
  // así que cualquier hueco libre vale, sin verificación de ruta.
  const huecoMesaDelineante = buscarHueco(parcelas.parcelas[PARCELA_ID], esTierraLibre, reservadas, 1, 1, SPAWN);
  if (!huecoMesaDelineante) throw new Error(`${PARCELA_ID} no tiene hueco para mesa_delineante (¿cambió el bake?)`);
  // mesa_ajedrez: aquí SÍ hace falta caminar de verdad (sentarse gatea por
  // RADIO_INTERACCION) — ver buscarHuecoMesaAjedrezConRuta arriba para el
  // porqué de la ruta en dos tramos en vez de la línea recta simple.
  const huecoMesaAjedrez = buscarHuecoMesaAjedrezConRuta(parcelas.parcelas[PARCELA_ID], esTierraLibre, reservadas, SPAWN);
  if (!huecoMesaAjedrez) throw new Error(`${PARCELA_ID} no tiene ruta segura verificable para mesa_ajedrez (¿cambió el bake?)`);
  console.log("  mesa_delineante en", huecoMesaDelineante, "| mesa_ajedrez en", huecoMesaAjedrez, "vía waypoint", huecoMesaAjedrez.waypoint);

  const ENV_SERVIDOR = { JARL_NOMBRES: "Jarl", BD_RUTA };
  let servidor = lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), ENV_SERVIDOR);
  // Declarados aquí (no con const dentro del try) para que el finally de
  // abajo pueda cerrarlos aunque un paso intermedio lance.
  let browser, browserB;

  try {
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"));
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");

    // Con 2 páginas de un juego 3D en tiempo real (Three.js) a la vez, un solo
    // proceso de renderer de Chromium las hace competir por el mismo hilo —
    // confirmado con 2 rondas reales de este e2e: incluso con los flags de
    // abajo (que sí hacen falta, evitan el throttling de pestaña sin foco),
    // la página en segundo plano seguía sin recibir suficiente CPU para que
    // su bucle de juego (client/src/game.ts::bucle, gated por
    // requestAnimationFrame, es el que manda el input de movimiento) avance
    // a un ritmo fiable — unas veces llegaba tarde, otras no llegaba nunca.
    // Fix real: un proceso de Chromium POR JUGADOR (browser aparte, no
    // browser.newContext() sobre el mismo) — el scheduler del SO reparte CPU
    // entre procesos mucho mejor que Chromium entre pestañas de uno solo.
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
        // [mesa]/[crafteo] son console.log (type "log", no "error") — el
        // filtro de arriba nunca los habría mostrado, y son justo el motivo
        // real que manda el servidor en "mesa:error"/"crafteo:error" cuando
        // rechaza algo (game.ts). Imprimirlos SIEMPRE en vivo para poder
        // diagnosticar un rechazo sin adivinar.
        if (t.startsWith("[mesa]") || t.startsWith("[crafteo]")) console.log(`  <${etiqueta}> ${t}`);
      });
      pagina.on("pageerror", (err) => erroresConsola.push(`${etiqueta}: ${err}`));
    };

    // ---- Página A: Jarl / ingeniero / blancas ----
    const paginaA = await browser.newPage({ viewport: { width: 900, height: 600 } });
    vigilar(paginaA, "A");
    await paginaA.goto("http://localhost:5199/?nombre=Jarl");
    await paginaA.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await paginaA.waitForFunction(() => !!window.__construccion && !!window.__ajedrez, null, { timeout: 30000 });
    comprobar(true, "página A (Jarl) con streaming activo y sondas de construcción/ajedrez");

    // El Jarl puede construir en CUALQUIER parcela sin ser su dueño formal
    // (bypass server-side, docs/GDD_Construccion.md §5.1) — pero el ESPEJO
    // del cliente (ModoConstruccion.tieneAlgunaParcela) solo mira
    // `duenos[id].dueno`, sin conocer ese bypass, así que "activar()" no
    // se pondría en marcha sin esta asignación explícita (mismo paso que
    // ya hace construccion.e2e.cjs). No cambia nada del lado servidor: el
    // Jarl ya podía construir aquí igualmente.
    await paginaA.evaluate((id) => window.__construccion.asignarParcela(id, "Jarl"), PARCELA_ID);
    await paginaA
      .waitForFunction((id) => window.__construccion.parcelas()?.[id]?.dueno === "Jarl", PARCELA_ID, { timeout: 10000 })
      .catch(() => {});
    await paginaA.evaluate(() => { window.__construccion.activar(); });
    comprobar(await paginaA.evaluate(() => window.__construccion.activo()), "modo construcción activado (Jarl, dueño de la parcela)");

    // ---- Paso 3: construir la mesa_delineante (gratis, nivel 1 — GDD_Profesiones §0) ----
    console.log("3) construyendo mesa_delineante...");
    await paginaA.evaluate(({ x, y }) => {
      window.__construccion.seleccionar("mesa_delineante");
      window.__construccion.colocarEn(x, y);
    }, huecoMesaDelineante);
    await paginaA.waitForFunction(() => window.__construccion.construcciones() >= 1, null, { timeout: 15000 });
    const idMesaDelineante = await paginaA.evaluate(() => window.__construccion.idsDeObjeto("mesa_delineante")[0]);
    comprobar(typeof idMesaDelineante === "number", `mesa_delineante colocada, id=${idMesaDelineante}`);

    // ---- Paso 4: craftear mesa_ajedrez_craft (protocolo real crafteo:iniciar/recolectar) ----
    console.log("4) eligiendo oficio ingeniero y craftando mesa_ajedrez_craft (tiempoBaseSeg=40, espera real)...");
    await paginaA.evaluate(() => window.__ajedrez.elegirIngeniero());
    await paginaA.evaluate((id) => window.__ajedrez.craftear(id), idMesaDelineante);
    let crafteoCompletado = null;
    for (let intento = 0; intento < 30 && !crafteoCompletado; intento++) {
      await esperar(3000);
      await paginaA.evaluate(() => window.__ajedrez.recolectarCrafteo());
      crafteoCompletado = await paginaA.evaluate(() => window.__ajedrez.ultimoCrafteoCompletado());
    }
    comprobar(
      !!crafteoCompletado && crafteoCompletado.itemId === "mesa_ajedrez" && crafteoCompletado.cantidad === 1 && crafteoCompletado.enSuelo === false,
      `crafteo:completado recibido (${JSON.stringify(crafteoCompletado)})`,
    );

    // ---- Paso 5: colocar el mueble mesa_ajedrez (consume el ítem craftado — requiereItemColocar) ----
    console.log("5) colocando el mueble mesa_ajedrez...");
    const construccionesAntes = await paginaA.evaluate(() => window.__construccion.construcciones());
    await paginaA.evaluate(({ x, y }) => {
      window.__construccion.seleccionar("mesa_ajedrez"); // "seleccionar" ya resetea rot a 0
      window.__construccion.colocarEn(x, y);
    }, huecoMesaAjedrez);
    await paginaA.waitForFunction((antes) => window.__construccion.construcciones() > antes, construccionesAntes, { timeout: 15000 });
    const idMesaAjedrez = await paginaA.evaluate(() => window.__construccion.idsDeObjeto("mesa_ajedrez")[0]);
    comprobar(typeof idMesaAjedrez === "number", `mesa_ajedrez colocada de verdad (consumiendo el ítem craftado), id=${idMesaAjedrez}`);
    const erroresConstruirTrasColocar = await paginaA.evaluate(() => window.__construccion.errores().n);
    comprobar(erroresConstruirTrasColocar === 0, "colocar mesa_ajedrez no dio construir:error (el ítem craftado sí estaba en el inventario)");

    // posiciones mundo reales de cada silla (mismo cálculo que usa el propio cliente)
    const posBlancas = await paginaA.evaluate((id) => window.__ajedrez.posicionSilla(id, "blancas"), idMesaAjedrez);
    const posNegras = await paginaA.evaluate((id) => window.__ajedrez.posicionSilla(id, "negras"), idMesaAjedrez);
    comprobar(!!posBlancas && !!posNegras, `posiciones de silla calculadas: blancas=${JSON.stringify(posBlancas)} negras=${JSON.stringify(posNegras)}`);

    // ---- Paso 6: Jarl camina hasta la silla de blancas (ruta en dos tramos
    // ya verificada de antemano, ver buscarHuecoMesaAjedrezConRuta) —
    // CAPTURA 1 (mesa vacía) ----
    console.log("6) caminando hasta la silla de blancas (vía waypoint", huecoMesaAjedrez.waypoint, ")...");
    const llegoWaypointA = await caminarHacia(paginaA, huecoMesaAjedrez.waypoint.x, huecoMesaAjedrez.waypoint.y, 60000);
    comprobar(llegoWaypointA, "Jarl llegó al waypoint intermedio (tramo 1/2)");
    const llegoA = await caminarHacia(paginaA, posBlancas.x, posBlancas.y, 420000);
    comprobar(llegoA, "Jarl llegó junto a la mesa de ajedrez (tramo 2/2)");
    await esperar(400);
    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "ajedrez_1_mesa_vacia.png") });
    console.log("  captura: ajedrez_1_mesa_vacia.png");

    // ---- Paso 7: Jarl se sienta (mesa:sentarse real vía sonda, ver nota
    // sobre sentarseConReintentos) — CAPTURA 2 (sentado, esperando rival) ----
    console.log("7) Jarl se sienta (mesa:sentarse real)...");
    const sessionIdA = await paginaA.evaluate(() => window.__ajedrez.sessionId());
    const sentadoA = await sentarseConReintentos(paginaA, idMesaAjedrez, sessionIdA, posBlancas, "blancas");
    comprobar(sentadoA, "Jarl sentado (mesa:sentarse real validado por el servidor)");
    const estadoTrasSentarseA = await paginaA.evaluate((id) => window.__ajedrez.estado(id), idMesaAjedrez);
    comprobar(estadoTrasSentarseA?.fase === "esperando" && estadoTrasSentarseA.sillaBlancas, `Jarl sentado en blancas, fase="esperando" (${JSON.stringify(estadoTrasSentarseA)})`);
    await paginaA.waitForSelector(".panel-ajedrez", { state: "visible", timeout: 10000 });
    await esperar(300);
    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "ajedrez_2_sentado_esperando_rival.png") });
    console.log("  captura: ajedrez_2_sentado_esperando_rival.png");

    // ---- Paso 8: página B (Jugador2) entra, camina a la silla de negras y se sienta ----
    console.log("8) Jugador2 entra, camina hasta la silla de negras y se sienta...");
    const contextoB = await browserB.newContext({ viewport: { width: 900, height: 600 } });
    const paginaB = await contextoB.newPage();
    vigilar(paginaB, "B");
    await paginaB.goto("http://localhost:5199/?nombre=Jugador2");
    await paginaB.waitForFunction(() => window.__streaming && window.__streaming().materializados >= 4, null, { timeout: 60000 });
    await paginaB.waitForFunction(() => !!window.__ajedrez, null, { timeout: 30000 });
    await paginaB.waitForFunction((id) => window.__construccion && window.__construccion.idsDeObjeto("mesa_ajedrez").includes(id), idMesaAjedrez, { timeout: 30000 });
    comprobar(true, "Jugador2 ve la mesa_ajedrez ya colocada (sincronizada por el servidor)");

    const llegoWaypointB = await caminarHacia(paginaB, huecoMesaAjedrez.waypoint.x, huecoMesaAjedrez.waypoint.y, 60000);
    comprobar(llegoWaypointB, "Jugador2 llegó al waypoint intermedio (tramo 1/2)");
    const llegoB = await caminarHacia(paginaB, posNegras.x, posNegras.y, 420000);
    comprobar(llegoB, "Jugador2 llegó junto a la mesa de ajedrez (tramo 2/2)");
    const sessionIdB = await paginaB.evaluate(() => window.__ajedrez.sessionId());
    const sentadoB = await sentarseConReintentos(paginaB, idMesaAjedrez, sessionIdB, posNegras, "negras");
    comprobar(sentadoB, "Jugador2 sentado (mesa:sentarse real validado por el servidor)");

    // ---- Paso 9: las 2 sillas ocupadas -> arranca sola. blancas mueven e2-e4 con 2 clics reales ----
    await paginaA.waitForFunction((id) => window.__ajedrez.estado(id)?.fase === "activo", idMesaAjedrez, { timeout: 15000 });
    await paginaB.waitForFunction((id) => window.__ajedrez.estado(id)?.fase === "activo", idMesaAjedrez, { timeout: 15000 });
    const estadoActivoA = await paginaA.evaluate((id) => window.__ajedrez.estado(id), idMesaAjedrez);
    comprobar(
      estadoActivoA.fase === "activo" && !!estadoActivoA.sillaBlancas && !!estadoActivoA.sillaNegras && estadoActivoA.turnoDe === estadoActivoA.sillaBlancas,
      `partida activa con las 2 sillas ocupadas, turno de blancas (${JSON.stringify(estadoActivoA)})`,
    );

    console.log("9) blancas juegan e2-e4 con 2 clics reales sobre el tablero...");
    const fenInicial = estadoActivoA.fen;
    await paginaA.click('[data-casilla="e2"]');
    await paginaA.click('[data-casilla="e4"]');
    await paginaA.waitForFunction((id) => window.__ajedrez.estado(id)?.fen !== undefined && window.__ajedrez.estado(id).fen.startsWith("rnbqkbnr/pppp"), idMesaAjedrez, { timeout: 10000 }).catch(() => {});
    // sincronización real: AMBOS clientes deben ver el fen cambiado y el turno pasado al rival
    await paginaA.waitForFunction((args) => window.__ajedrez.estado(args.id)?.fen !== args.fenInicial, { id: idMesaAjedrez, fenInicial }, { timeout: 10000 });
    await paginaB.waitForFunction((args) => window.__ajedrez.estado(args.id)?.fen !== args.fenInicial, { id: idMesaAjedrez, fenInicial }, { timeout: 10000 });
    const estadoTrasJugadaA = await paginaA.evaluate((id) => window.__ajedrez.estado(id), idMesaAjedrez);
    const estadoTrasJugadaB = await paginaB.evaluate((id) => window.__ajedrez.estado(id), idMesaAjedrez);
    comprobar(estadoTrasJugadaA.fen === estadoTrasJugadaB.fen && estadoTrasJugadaA.fen !== fenInicial, `jugada e2-e4 sincronizada en los 2 clientes (fen: ${estadoTrasJugadaA.fen})`);
    comprobar(estadoTrasJugadaA.turnoDe === estadoTrasJugadaA.sillaNegras, "tras la jugada, el turno pasa a negras");

    // ---- Capturas 3 y 4: partida activa tras la jugada, desde CADA punto de vista ----
    await paginaA.waitForSelector(".panel-ajedrez", { state: "visible" });
    await esperar(300);
    await paginaA.screenshot({ path: path.join(CARPETA_CAPTURAS, "ajedrez_3_partida_activa_vista_blancas.png") });
    console.log("  captura: ajedrez_3_partida_activa_vista_blancas.png");

    await paginaB.waitForSelector(".panel-ajedrez", { state: "visible" });
    await esperar(300);
    await paginaB.screenshot({ path: path.join(CARPETA_CAPTURAS, "ajedrez_4_partida_activa_vista_negras.png") });
    console.log("  captura: ajedrez_4_partida_activa_vista_negras.png");

    comprobar(erroresConsola.length === 0, `sin errores de consola (${erroresConsola.slice(0, 5).join(" | ")})`);
  } finally {
    // Cierre de los 2 procesos de Chromium en el propio finally (no solo al
    // final del try): si algún paso de arriba lanza, `browser`/`browserB`
    // quedan sin cerrar y el siguiente `esperarPuerto` de la próxima ronda
    // se topa con procesos zombis — mismo criterio que `matarTodo()`.
    if (typeof browser !== "undefined") await browser.close().catch(() => {});
    if (typeof browserB !== "undefined") await browserB.close().catch(() => {});
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
