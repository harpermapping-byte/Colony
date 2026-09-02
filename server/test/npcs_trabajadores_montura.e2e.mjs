// E2E de "trabajador:asignarMontura" (docs/GDD_Carros.md §12/§14 Fase 5,
// pedido 2026-09-03) contra el servidor REAL sobre el mapa PRINCIPAL — mismo
// patrón que npcs_trabajadores_transporte.e2e.mjs (parcela p_0001 propia,
// colmena origen + cofre destino sembrados directo en BD como atajo), MÁS
// una mascota montable (caballo) y un conjunto de tiro YA fusionado (buey +
// carro_materiales_pequeno) sembrados en `mascotas`/`conjuntos_tiro`.
// Confirma:
//   1) trabajador:asignarRuta SIN montura asignada usa VEL_NPC de base
//      (duracionViajeSeg == caminoIda.length/VEL_NPC) y cargaPorViaje ==
//      CARGA_POR_VIAJE_TRANSPORTE (10) — comportamiento previo intacto.
//   2) trabajador:asignarMontura {mascotaId Y conjuntoId a la vez} se
//      rechaza (mutuamente excluyentes).
//   3) trabajador:asignarMontura con una mascota AJENA se rechaza.
//   4) trabajador:asignarMontura {mascotaId} con una ruta YA activa:
//      recalcula la duración (persistida) y el trabajador camina más rápido
//      de verdad — medido por distancia real recorrida en un intervalo fijo,
//      igual que carros.e2e.mjs midió la velocidad de un conjunto.
//   5) trabajador:asignarMontura {conjuntoId} reemplaza la mascota (mutua
//      exclusión real, no acumulativa) y sigue siendo más rápido que a pie.
//   6) trabajador:asignarMontura sin campos (desasignar) vuelve a la
//      velocidad base VEL_NPC — degradación consistente, sin error.
//   7) un conjunto categoria "materiales" asignado ANTES de asignarRuta
//      sustituye cargaPorViaje por la capacidad real de su rejilla (mucho
//      mayor que el CARGA_POR_VIAJE_TRANSPORTE plano).
//   node server/test/npcs_trabajadores_montura.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "npcs_trabajadores_montura_e2e.sqlite");
const PUERTO = 2608;
const JARL = "E2E-MonturaJarl"; // <=20 chars
const OTRO = "E2E-MonturaOtro";
const VEL_NPC = 1.9;
const CARGA_POR_VIAJE_TRANSPORTE = 10;
// Mismas coordenadas de referencia que npcs_trabajadores_transporte.e2e.mjs
// (terreno abierto ya verificado walkable/colocable cerca del spawn real).
const COLMENA_XY = { x: 1600, y: 1602 };
const COFRE_XY = { x: 1600, y: 1604 };
const PARCELA_PROPIA = "p_0001";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl + otro jugador, parcela propia, colmena+cofre, un caballo propio SIN montar, un conjunto buey+carro_materiales_pequeno propio, una mascota ajena)...");
let idColmena, idCofre, idCaballo, idConjuntoMateriales, idMascotaAjena;
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0,
      vida INTEGER NOT NULL DEFAULT 100,
      vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS propiedades (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      asentamiento TEXT NOT NULL,
      dueno INTEGER,
      asignada_en TEXT,
      modo_tenencia TEXT, precio_farycoins INTEGER, periodo_horas INTEGER, expira_en TEXT,
      impuesto_activo INTEGER NOT NULL DEFAULT 0, impuesto_farycoins INTEGER, impuesto_periodo_horas INTEGER, impuesto_ultimo_cobro TEXT
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
    CREATE TABLE IF NOT EXISTS mascotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jugador_id INTEGER NOT NULL,
      especie_id TEXT NOT NULL,
      ubicacion TEXT NOT NULL DEFAULT 'siguiendo',
      propiedad_id TEXT,
      creado_en TEXT NOT NULL,
      montura INTEGER NOT NULL DEFAULT 0,
      arnes INTEGER NOT NULL DEFAULT 0,
      arnes_peso_maximo REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS conjuntos_tiro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jugador_id INTEGER NOT NULL,
      mascota_id INTEGER NOT NULL,
      especie_animal_id TEXT NOT NULL,
      carro_tipo_id TEXT NOT NULL,
      mapa_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      creado_en TEXT NOT NULL
    );
  `);
  const ahora = new Date().toISOString();
  const idJarl = Number(bd.prepare("INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES (?, ?, 5000)").run(JARL, ahora).lastInsertRowid);
  const idOtro = Number(bd.prepare("INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES (?, ?, 5000)").run(OTRO, ahora).lastInsertRowid);
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, 'parcela', 'ciudad', ?, ?)").run(PARCELA_PROPIA, idJarl, ahora);

  idColmena = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_PROPIA, "colmena", "exterior", COLMENA_XY.x, COLMENA_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  idCofre = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_PROPIA, "cofre_pequeno", "mueble", COFRE_XY.x, COFRE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );

  idCaballo = Number(
    bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (?, 'caballo', 'siguiendo', NULL, ?, 0, 0, 0)")
      .run(idJarl, ahora).lastInsertRowid,
  );
  idMascotaAjena = Number(
    bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (?, 'caballo', 'siguiendo', NULL, ?, 0, 0, 0)")
      .run(idOtro, ahora).lastInsertRowid,
  );
  const idBueyFundido = Number(
    bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (?, 'buey', 'siguiendo', NULL, ?, 0, 1, 150)")
      .run(idJarl, ahora).lastInsertRowid,
  );
  idConjuntoMateriales = Number(
    bd.prepare("INSERT INTO conjuntos_tiro (jugador_id, mascota_id, especie_animal_id, carro_tipo_id, mapa_id, x, y, creado_en) VALUES (?,?,?,?,?,?,?,?)")
      .run(idJarl, idBueyFundido, "buey", "carro_materiales_pequeno", "principal", COLMENA_XY.x + 3, COLMENA_XY.y, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  colmena=${idColmena} cofre=${idCofre} caballo=${idCaballo} conjuntoMateriales=${idConjuntoMateriales} mascotaAjena=${idMascotaAjena}`);

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[srv:err] ${d}`));
  procesos.push(p);
  return p;
}
function matarTodo() {
  for (const p of procesos) { try { process.kill(-p.pid, "SIGKILL"); } catch {} try { p.kill("SIGKILL"); } catch {} }
}
process.on("exit", matarTodo);

async function esperarPuerto(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function esperarMensaje(room, tipo, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando mensaje "${tipo}"`)), ms);
    room.onMessage(tipo, (m) => { clearTimeout(t); resolve(m); });
  });
}

/**
 * Tiempo REAL (segundos) que tarda un agente del GestorAgentes en recorrer
 * origen→destino tras salir de la pausa inicial de parada (agentes.ts:
 * PAUSA_PARADA_SEG=7s QUIETO al (re)crearse, luego el trayecto en sí) —
 * medir "cuánto tarda en llegar" por UMBRALES DE POSICIÓN ABSOLUTOS (¿ya
 * salió del origen? ¿ya llegó al destino?) en vez de "velocidad
 * instantánea por muestra" evita dos trampas del sondeo por wifi/event
 * loop: el mensaje que dispara la (re)creación del agente puede llegar
 * antes que el siguiente patch de sincronización del Schema (15hz), y un
 * hueco de sondeo más largo de lo pedido (GC, consola) infla cualquier
 * "velocidad instantánea" si se divide por un Δt nominal fijo — con
 * umbrales absolutos solo importan los DOS instantes de cruce, no cuántas
 * muestras hubo entre medias. Menor tiempo devuelto = más rápido.
 */
async function medirTiempoTravesiaNpc(room, slotId, origen, destino, msMax = 16000, msPaso = 100) {
  const ox = origen.x + 0.5, oy = origen.y + 0.5;
  const dx = destino.x + 0.5, dy = destino.y + 0.5;
  let tInicioMovimiento = null;
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    await esperar(msPaso);
    const npc = room.state.npcs.get(slotId);
    if (!npc) throw new Error(`FALLO: el agente ${slotId} desapareció durante la medición`);
    if (tInicioMovimiento === null) {
      if (Math.hypot(npc.x - ox, npc.y - oy) > 0.25) tInicioMovimiento = Date.now();
    } else if (Math.hypot(npc.x - dx, npc.y - dy) < 0.25) {
      return (Date.now() - tInicioMovimiento) / 1000;
    }
  }
  throw new Error(`FALLO: el agente ${slotId} no completó el trayecto origen→destino en ${msMax}ms`);
}

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre el mapa PRINCIPAL...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  // deja que el simulationInterval del room (30hz) purgue cualquier ráfaga
  // de "puesta al día" de sus primeros ticks (carga de catálogos/mapa
  // recién terminada) ANTES de crear ningún agente — si no, una medición
  // de velocidad que caiga justo en esa ráfaga sale artificialmente
  // rápida (no es un bug del juego, es un artefacto de arrancar el
  // servidor y medir inmediatamente después).
  await esperar(3000);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: JARL });
  await esperar(500);

  const erroresTrabajador = [];
  room.onMessage("trabajador:error", (m) => erroresTrabajador.push(m));

  console.log("3a) el jarl coloca el reclutador en el spawn (requisito de reclutador:contratar)...");
  const colocados = [];
  room.onMessage("admin:npcTutorial:colocado", (m) => colocados.push(m));
  room.send("admin:npcTutorial:colocar", { tipoTutorial: "reclutador_trabajadores" });
  await esperar(400);
  if (colocados.length !== 1) throw new Error(`FALLO: debería confirmar la colocación del reclutador, llegó ${JSON.stringify(colocados)}`);

  console.log("3b) contrata un trabajador de oficio 'transporte'...");
  const contratados = [];
  room.onMessage("reclutador:contratado", (m) => contratados.push(m));
  room.send("reclutador:contratar", { oficios: ["transporte"] });
  await esperar(500);
  if (contratados.length !== 1) throw new Error(`FALLO: debería contratar el transportista, llegó ${JSON.stringify(contratados)}, errores=${JSON.stringify(erroresTrabajador)}`);
  const idTrabajador = contratados[0].trabajador.id;
  console.log(`   OK: trabajador transporte #${idTrabajador}`);

  console.log("4) trabajador:asignarRuta SIN montura asignada — velocidad/carga de base (VEL_NPC, CARGA_POR_VIAJE_TRANSPORTE)...");
  let rutaAsignada = esperarMensaje(room, "trabajador:rutaAsignada");
  room.send("trabajador:asignarRuta", { trabajadorId: idTrabajador, origenConstruccionId: idColmena, destinoConstruccionId: idCofre });
  const ruta1 = await rutaAsignada;
  const contratoId = ruta1.contrato.id;
  const pathLen = ruta1.contrato.caminoIda.length;
  const duracionBase = ruta1.contrato.duracionViajeSeg;
  const duracionEsperadaBase = Math.max(5, pathLen / VEL_NPC);
  if (Math.abs(duracionBase - duracionEsperadaBase) > 0.05) {
    throw new Error(`FALLO: duracionViajeSeg base debería ser ${duracionEsperadaBase.toFixed(3)} (VEL_NPC), llegó ${duracionBase}`);
  }
  if (ruta1.contrato.cargaPorViaje !== CARGA_POR_VIAJE_TRANSPORTE) {
    throw new Error(`FALLO: cargaPorViaje base debería ser ${CARGA_POR_VIAJE_TRANSPORTE}, llegó ${ruta1.contrato.cargaPorViaje}`);
  }
  console.log(`   OK: contrato #${contratoId}, camino de ${pathLen} casillas, duracionViajeSeg=${duracionBase.toFixed(2)} (a pie), cargaPorViaje=${ruta1.contrato.cargaPorViaje}`);

  // Calentamiento: el PRIMER agente activado justo tras arrancar la room
  // puede arrastrar un pequeño desfase de reloj de su primer tramo (el
  // Clock interno de Colyseus poniéndose al día tras la carga inicial) —
  // se descarta esta primera vuelta colmena→cofre y se mide la REAL en el
  // tramo de vuelta cofre→colmena que el propio agente encadena solo
  // (mismo bucle de paradas, sin volver a tocar el servidor), ya con el
  // reloj estabilizado.
  await medirTiempoTravesiaNpc(room, `contrato:${contratoId}`, COLMENA_XY, COFRE_XY);
  console.log("   midiendo tiempo REAL del trayecto cofre→colmena a pie (referencia, tras el calentamiento)...");
  const tPie = await medirTiempoTravesiaNpc(room, `contrato:${contratoId}`, COFRE_XY, COLMENA_XY);
  console.log(`   ${tPie.toFixed(2)}s a pie`);

  console.log("5) trabajador:asignarMontura con mascotaId Y conjuntoId a la vez se rechaza...");
  erroresTrabajador.length = 0;
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador, mascotaId: idCaballo, conjuntoId: idConjuntoMateriales });
  await esperar(400);
  if (!erroresTrabajador.some((e) => /monta o engancha/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazar mascotaId+conjuntoId a la vez, llegó ${JSON.stringify(erroresTrabajador)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresTrabajador[0])}`);

  console.log("6) trabajador:asignarMontura con una mascota AJENA se rechaza...");
  erroresTrabajador.length = 0;
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador, mascotaId: idMascotaAjena });
  await esperar(400);
  if (!erroresTrabajador.some((e) => /no es tuya/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazar mascota ajena, llegó ${JSON.stringify(erroresTrabajador)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresTrabajador[0])}`);

  console.log("7) trabajador:asignarMontura {mascotaId: caballo propio} con ruta YA activa — recalcula duración y camina más rápido de verdad...");
  const actualizados = [];
  room.onMessage("trabajador:actualizado", (m) => actualizados.push(m));
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador, mascotaId: idCaballo });
  await esperar(500);
  const act1 = actualizados[actualizados.length - 1];
  if (!act1 || act1.trabajador.mascotaAsignadaId !== idCaballo || act1.trabajador.conjuntoAsignadoId !== null) {
    throw new Error(`FALLO: debería confirmar mascotaAsignadaId=${idCaballo}, llegó ${JSON.stringify(act1)}`);
  }
  const tCaballo = await medirTiempoTravesiaNpc(room, `contrato:${contratoId}`, COLMENA_XY, COFRE_XY);
  console.log(`   ${tCaballo.toFixed(2)}s montado (caballo, catálogo=8.5) vs ${tPie.toFixed(2)}s a pie`);
  if (tCaballo >= tPie / 1.5) {
    throw new Error(`FALLO: debería tardar bastante MENOS con el caballo asignado (a pie=${tPie.toFixed(2)}s, con caballo=${tCaballo.toFixed(2)}s)`);
  }
  console.log("   OK: el trayecto real tarda menos al asignar la montura");

  console.log("8) trabajador:asignarMontura {conjuntoId} REEMPLAZA la mascota (mutuamente excluyentes, no acumulativo)...");
  actualizados.length = 0;
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador, conjuntoId: idConjuntoMateriales });
  await esperar(500);
  const act2 = actualizados[actualizados.length - 1];
  if (!act2 || act2.trabajador.conjuntoAsignadoId !== idConjuntoMateriales || act2.trabajador.mascotaAsignadaId !== null) {
    throw new Error(`FALLO: debería confirmar conjuntoAsignadoId=${idConjuntoMateriales} y mascotaAsignadaId=null (reemplazo, no acumulación), llegó ${JSON.stringify(act2)}`);
  }
  const tConjunto = await medirTiempoTravesiaNpc(room, `contrato:${contratoId}`, COLMENA_XY, COFRE_XY);
  console.log(`   ${tConjunto.toFixed(2)}s con el conjunto (buey×FACTOR_CARRO_NORMAL≈4.125) vs ${tPie.toFixed(2)}s a pie`);
  if (tConjunto >= tPie / 1.1) {
    throw new Error(`FALLO: debería seguir tardando menos que a pie con el conjunto asignado (a pie=${tPie.toFixed(2)}s, con conjunto=${tConjunto.toFixed(2)}s)`);
  }
  console.log("   OK: reemplazo real (una montura, no las dos), y sigue tardando menos que a pie");

  console.log("9) trabajador:asignarMontura sin campos — desasigna, vuelve a la velocidad base VEL_NPC...");
  actualizados.length = 0;
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador });
  await esperar(500);
  const act3 = actualizados[actualizados.length - 1];
  if (!act3 || act3.trabajador.mascotaAsignadaId !== null || act3.trabajador.conjuntoAsignadoId !== null) {
    throw new Error(`FALLO: debería desasignar ambos campos a null, llegó ${JSON.stringify(act3)}`);
  }
  const tDesasignado = await medirTiempoTravesiaNpc(room, `contrato:${contratoId}`, COLMENA_XY, COFRE_XY);
  console.log(`   ${tDesasignado.toFixed(2)}s tras desasignar vs ${tConjunto.toFixed(2)}s con el conjunto (referencia) — esperado ≈${tPie.toFixed(2)}s (a pie)`);
  if (tDesasignado <= tConjunto * 1.2) {
    throw new Error(`FALLO: debería volver a tardar más (velocidad lenta a pie) tras desasignar (con conjunto=${tConjunto.toFixed(2)}s, desasignado=${tDesasignado.toFixed(2)}s)`);
  }
  console.log("   OK: degradación consistente, sin error, vuelve a caminar a pie");

  console.log("10) un SEGUNDO trabajador con el conjunto de materiales asignado ANTES de asignarRuta — cargaPorViaje sustituida por la capacidad real de la rejilla...");
  contratados.length = 0;
  room.send("reclutador:contratar", { oficios: ["transporte"] });
  await esperar(500);
  const idTrabajador2 = contratados[contratados.length - 1].trabajador.id;
  room.send("trabajador:asignarMontura", { trabajadorId: idTrabajador2, conjuntoId: idConjuntoMateriales });
  await esperar(400);
  rutaAsignada = esperarMensaje(room, "trabajador:rutaAsignada");
  room.send("trabajador:asignarRuta", { trabajadorId: idTrabajador2, origenConstruccionId: idColmena, destinoConstruccionId: idCofre });
  const ruta2 = await rutaAsignada;
  if (ruta2.contrato.cargaPorViaje <= CARGA_POR_VIAJE_TRANSPORTE) {
    throw new Error(`FALLO: cargaPorViaje debería sustituirse por la capacidad real del carro de materiales (>${CARGA_POR_VIAJE_TRANSPORTE}), llegó ${ruta2.contrato.cargaPorViaje}`);
  }
  console.log(`   OK: cargaPorViaje=${ruta2.contrato.cargaPorViaje} (>> ${CARGA_POR_VIAJE_TRANSPORTE} plano) — la carreta de materiales carga mucho más que a lomos`);

  await room.leave();
  console.log("\n✅ TODO OK: sin montura asignada se mantiene el comportamiento previo (VEL_NPC/CARGA_POR_VIAJE_TRANSPORTE) → mascotaId+conjuntoId a la vez se rechaza → mascota ajena se rechaza → asignar montura EN CALIENTE (ruta ya activa) recalcula duración y el agente camina más rápido DE VERDAD (medido) → asignar un conjunto reemplaza la mascota (mutuamente excluyentes) y sigue siendo más rápido → desasignar degrada de vuelta a VEL_NPC sin error → un conjunto de materiales asignado ANTES de la ruta sustituye cargaPorViaje por la capacidad real de su rejilla — todo contra el servidor real.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
if (fallo) {
  console.error("\n❌ FALLO:", fallo.message || fallo);
  process.exit(1);
}
process.exit(0);
