// E2E de la fusión "transporte" como oficio de trabajador
// (docs/GDD_NPCs_Contratables.md §Fusión con transporte, pedido 2026-09-01):
// contra el servidor REAL (Colyseus real, BD sqlite real, mapa PRINCIPAL —
// mismo criterio que npcs_trabajadores_crafteo.e2e.mjs), con dos
// "propiedades" (p_9101/p_9102) y tres construcciones (una colmena
// productora, un cofre destino, dos yunques) sembradas DIRECTO en BD como
// atajo de test (mismo patrón ya establecido). Confirma:
//   1) contratar un trabajador de oficio "transporte" cuesta/aparece igual
//      que cualquier otro (mismo reclutador:contratar, mismo coste).
//   2) trabajador:asignarRuta con una construcción que NO es del jugador se
//      rechaza (misma validación de dueño que tenía el sistema previo).
//   3) trabajador:asignarRuta real (colmena propia → cofre propio) deja la
//      ruta activa: trabajador:listado la incluye en `rutas`, y el trabajador
//      camina como agente transportista (slot "contrato:<id>") en vez de
//      quedar plantado como NPC fijo.
//   4) reasignar la ruta de ESE MISMO trabajador (mismo origen, otro
//      destino) retira el contrato viejo y dispara uno nuevo — nunca dos
//      activos a la vez.
//   5) un trabajador de oficio de MESA (herrero) se reasigna de una
//      construcción a otra DISTINTA en caliente (ya contratado, sin
//      despedir/recontratar): trabajador:asignarMesa dos veces seguidas
//      teleporta cada vez a la construcción nueva.
//   node server/test/npcs_trabajadores_transporte.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "npcs_trabajadores_transporte_e2e.sqlite");
const PUERTO = 2607;
const JARL = "E2E-TransporteJarl"; // <=20 chars, ver nota de npcs_trabajadores_crafteo.e2e.mjs
const OTRO = "E2E-OtroJugador";
// Mismo criterio que npcs_trabajadores_crafteo.e2e.mjs: coordenadas cerca
// del spawn real 1600.5,1600.5 del mapa principal, terreno abierto ya
// verificado walkable/colocable por ese E2E.
const SPAWN = { x: 1600.5, y: 1600.5 };
const COLMENA_XY = { x: 1600, y: 1602 };
const COFRE_XY = { x: 1600, y: 1604 };
const COFRE2_XY = { x: 1598, y: 1602 };
const YUNQUE_A_XY = { x: 1600, y: 1601 };
const YUNQUE_B_XY = { x: 1601, y: 1602 };
// IDs de parcela REALES del mapa principal (assets/mapas/principal/parcelas.json)
// — una construcción solo se carga en ctx.vivas si su `propiedad` es una
// parcela CONOCIDA por el bake (RoomExteriorBase.ts: "parcelas.parcelas.has(c.propiedad)"),
// así que un id inventado (p_9101...) se cargaría con 0 construcciones. La
// geometría real de la parcela no importa aquí (el origen/destino de la
// ruta usan las x/y de la CONSTRUCCIÓN, nunca la geometría de la parcela).
const PARCELA_PROPIA = "p_0001"; // dueño = JARL (origen de la ruta)
const PARCELA_AJENA = "p_0002"; // dueño = OTRO (para probar el rechazo de §2)

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jarl + otro jugador con Farycoins, 2 propiedades con dueños distintos, colmena/cofres/yunques sembrados como construcciones reales)...");
let idColmena, idCofre, idCofre2, idYunqueA, idYunqueB, idCofreAjeno;
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
  `);
  const ahora = new Date().toISOString();
  const idJarl = Number(bd.prepare("INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES (?, ?, 5000)").run(JARL, ahora).lastInsertRowid);
  const idOtro = Number(bd.prepare("INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES (?, ?, 5000)").run(OTRO, ahora).lastInsertRowid);
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, 'parcela', 'ciudad', ?, ?)").run(PARCELA_PROPIA, idJarl, ahora);
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, 'parcela', 'ciudad', ?, ?)").run(PARCELA_AJENA, idOtro, ahora);

  const insertarConstruccion = (propiedad, objeto, categoria, xy) => Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(propiedad, objeto, categoria, xy.x, xy.y, 0, 0, null, ahora).lastInsertRowid,
  );
  idColmena = insertarConstruccion(PARCELA_PROPIA, "colmena", "exterior", COLMENA_XY);
  idCofre = insertarConstruccion(PARCELA_PROPIA, "cofre_pequeno", "mueble", COFRE_XY);
  idCofre2 = insertarConstruccion(PARCELA_PROPIA, "cofre_pequeno", "mueble", COFRE2_XY);
  idCofreAjeno = insertarConstruccion(PARCELA_AJENA, "cofre_pequeno", "mueble", { x: 1596, y: 1600 });
  idYunqueA = insertarConstruccion(PARCELA_PROPIA, "yunque_tocon", "mueble", YUNQUE_A_XY);
  idYunqueB = insertarConstruccion(PARCELA_PROPIA, "yunque_tocon", "mueble", YUNQUE_B_XY);
  bd.close();
}
console.log(`  colmena=${idColmena}@(${COLMENA_XY.x},${COLMENA_XY.y}) cofre=${idCofre}@(${COFRE_XY.x},${COFRE_XY.y}) cofre2=${idCofre2}@(${COFRE2_XY.x},${COFRE2_XY.y}) cofreAjeno=${idCofreAjeno} yunqueA=${idYunqueA} yunqueB=${idYunqueB}`);

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

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre el mapa PRINCIPAL...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd, JARL_NOMBRES: JARL });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: JARL });
  await esperar(500);

  const colocados = [];
  room.onMessage("admin:npcTutorial:colocado", (m) => colocados.push(m));
  console.log("3) el jarl coloca el reclutador en el spawn...");
  room.send("admin:npcTutorial:colocar", { tipoTutorial: "reclutador_trabajadores" });
  await esperar(400);
  if (colocados.length !== 1) throw new Error(`FALLO: debería confirmar la colocación del reclutador, llegó ${JSON.stringify(colocados)}`);
  console.log("   OK");

  console.log("4) catálogo del reclutador incluye 'transporte' como un oficio contratable más, con el MISMO coste que cualquiera...");
  const catalogos = [];
  room.onMessage("reclutador:catalogo", (m) => catalogos.push(m));
  room.send("reclutador:catalogo");
  await esperar(400);
  const catalogo = catalogos[0];
  if (!catalogo || !catalogo.oficios.includes("transporte")) throw new Error(`FALLO: 'transporte' debería estar en el catálogo, llegó ${JSON.stringify(catalogo)}`);
  console.log(`   OK: oficios=${JSON.stringify(catalogo.oficios)}, coste 1 oficio=${catalogo.costePorCantidad[0]}`);

  console.log("5) contrata un trabajador de oficio 'transporte' — cobra igual que cualquier oficio de mesa...");
  const contratados = [];
  const erroresTrabajador = [];
  room.onMessage("reclutador:contratado", (m) => contratados.push(m));
  room.onMessage("trabajador:error", (m) => erroresTrabajador.push(m));
  room.send("reclutador:contratar", { oficios: ["transporte"] });
  await esperar(500);
  if (contratados.length !== 1) throw new Error(`FALLO: debería contratar el transportista, llegó ${JSON.stringify(contratados)}, errores=${JSON.stringify(erroresTrabajador)}`);
  const idTransportista = contratados[0].trabajador.id;
  if (contratados[0].saldoRestante !== 5000 - catalogo.costePorCantidad[0]) {
    throw new Error(`FALLO: debería cobrar exactamente ${catalogo.costePorCantidad[0]} (mismo coste que cualquier oficio), saldo quedó ${contratados[0].saldoRestante}`);
  }
  console.log(`   OK: trabajador transporte #${idTransportista}, saldo restante ${contratados[0].saldoRestante}`);

  console.log("6) trabajador:asignarRuta con una construcción AJENA como origen se rechaza (no eres el dueño)...");
  erroresTrabajador.length = 0;
  room.send("trabajador:asignarRuta", { trabajadorId: idTransportista, origenConstruccionId: idCofreAjeno, destinoConstruccionId: idCofre });
  await esperar(400);
  if (!erroresTrabajador.some((e) => /dueñ/.test(e.motivo))) {
    throw new Error(`FALLO: debería rechazarse por no ser el dueño del origen, llegó ${JSON.stringify(erroresTrabajador)}`);
  }
  console.log(`   OK: ${JSON.stringify(erroresTrabajador[0])}`);

  console.log("7) trabajador:asignarRuta REAL (colmena propia → cofre propio) — la ruta queda activa...");
  const rutasAsignadas = [];
  room.onMessage("trabajador:rutaAsignada", (m) => rutasAsignadas.push(m));
  room.send("trabajador:asignarRuta", { trabajadorId: idTransportista, origenConstruccionId: idColmena, destinoConstruccionId: idCofre });
  await esperar(800);
  if (rutasAsignadas.length !== 1 || !rutasAsignadas[0].contrato) {
    throw new Error(`FALLO: debería confirmar la ruta asignada, llegó ${JSON.stringify(rutasAsignadas)}`);
  }
  const contratoId1 = rutasAsignadas[0].contrato.id;
  console.log(`   OK: contrato #${contratoId1}, origen=${rutasAsignadas[0].contrato.origenConstruccionId}, destino=${rutasAsignadas[0].contrato.destinoTenderoteId}`);

  console.log("8) trabajador:listar confirma la ruta en 'rutas', y el trabajador camina como agente transportista (slot contrato:<id>), sin NPC fijo duplicado...");
  const listados = [];
  room.onMessage("trabajador:listado", (m) => listados.push(m));
  room.send("trabajador:listar");
  await esperar(400);
  const ultimoListado = listados[listados.length - 1];
  const rutaEnListado = ultimoListado?.rutas?.find((r) => r.trabajadorId === idTransportista);
  if (!rutaEnListado || rutaEnListado.contratoId !== contratoId1) {
    throw new Error(`FALLO: trabajador:listado debería incluir la ruta activa, llegó ${JSON.stringify(ultimoListado)}`);
  }
  const npcFijoViejo = room.state.npcs.get(`trabajadorOficio_${idTransportista}`);
  if (npcFijoViejo) throw new Error("FALLO: no debería quedar un NPC fijo idle para un trabajador que ya camina su ruta");
  const npcCarretero = room.state.npcs.get(`contrato:${contratoId1}`);
  if (!npcCarretero) throw new Error("FALLO: el trabajador debería estar caminando la ruta como agente transportista (contrato:<id>)");
  console.log(`   OK: rutas=${JSON.stringify(ultimoListado.rutas)}, agente transportista en el mundo en (${npcCarretero.x},${npcCarretero.y})`);

  console.log("9) reasignar la ruta de ESE MISMO trabajador (mismo origen, otro destino) retira el contrato viejo y crea uno nuevo — nunca dos activos...");
  rutasAsignadas.length = 0;
  room.send("trabajador:asignarRuta", { trabajadorId: idTransportista, origenConstruccionId: idColmena, destinoConstruccionId: idCofre2 });
  await esperar(800);
  if (rutasAsignadas.length !== 1) throw new Error(`FALLO: debería confirmar la reasignación, llegó ${JSON.stringify(rutasAsignadas)}`);
  const contratoId2 = rutasAsignadas[0].contrato.id;
  if (contratoId2 === contratoId1) throw new Error("FALLO: reasignar debería crear un contrato NUEVO, no reusar el viejo");
  if (room.state.npcs.get(`contrato:${contratoId1}`)) throw new Error("FALLO: el agente del contrato VIEJO debería haberse retirado al reasignar");
  if (!room.state.npcs.get(`contrato:${contratoId2}`)) throw new Error("FALLO: debería haber un agente para el contrato NUEVO");
  console.log(`   OK: contrato viejo #${contratoId1} retirado, contrato nuevo #${contratoId2} activo — un solo trabajador, una sola ruta a la vez`);

  console.log("10) un trabajador de oficio de MESA (herrero) se reasigna EN CALIENTE de una construcción a otra DISTINTA, sin despedir/recontratar...");
  contratados.length = 0;
  room.send("reclutador:contratar", { oficios: ["herrero"] });
  await esperar(500);
  const idHerrero = contratados[0].trabajador.id;
  const slotHerrero = `trabajadorOficio_${idHerrero}`;

  const actualizados = [];
  room.onMessage("trabajador:actualizado", (m) => actualizados.push(m));
  room.send("trabajador:asignarMesa", { trabajadorId: idHerrero, construccionId: idYunqueA });
  await esperar(500);
  let npc = room.state.npcs.get(slotHerrero);
  if (!npc || Math.hypot(npc.x - (YUNQUE_A_XY.x + 0.5), npc.y - (YUNQUE_A_XY.y + 0.5)) > 0.01) {
    throw new Error(`FALLO: debería teleportar a la mesa A, quedó en ${JSON.stringify(npc)}`);
  }
  console.log(`   OK primera asignación: mesa A (${YUNQUE_A_XY.x},${YUNQUE_A_XY.y})`);

  actualizados.length = 0;
  room.send("trabajador:asignarMesa", { trabajadorId: idHerrero, construccionId: idYunqueB });
  await esperar(500);
  if (actualizados.length !== 1 || actualizados[actualizados.length - 1].trabajador.construccionId !== idYunqueB) {
    throw new Error(`FALLO: debería confirmar la reasignación a la mesa B, llegó ${JSON.stringify(actualizados)}`);
  }
  npc = room.state.npcs.get(slotHerrero);
  if (!npc || Math.hypot(npc.x - (YUNQUE_B_XY.x + 0.5), npc.y - (YUNQUE_B_XY.y + 0.5)) > 0.01) {
    throw new Error(`FALLO: debería haber TELEPORTADO a la mesa B, quedó en ${JSON.stringify(npc)}`);
  }
  // solo debe existir UN NPC para este trabajador (el slotId es el mismo, así que reusa la entrada — no debería haber duplicados en state.npcs).
  let apariciones = 0;
  for (const [id] of room.state.npcs.entries()) if (id === slotHerrero) apariciones++;
  if (apariciones !== 1) throw new Error(`FALLO: debería haber exactamente 1 NPC para este trabajador tras reasignar, hay ${apariciones}`);
  console.log(`   OK reasignación en caliente: mesa B (${YUNQUE_B_XY.x},${YUNQUE_B_XY.y}), sin despedir/recontratar, sin duplicados`);

  await room.leave();
  console.log("\n✅ TODO OK: 'transporte' contratable con el mismo coste que cualquier oficio → asignarRuta rechaza construcciones ajenas → ruta real activa (agente transportista real, visible en trabajador:listado) → reasignar retira el contrato viejo y crea uno nuevo (nunca dos a la vez) → un trabajador de mesa se reasigna en caliente entre dos construcciones distintas sin despedir/recontratar — todo contra el servidor real.");
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
