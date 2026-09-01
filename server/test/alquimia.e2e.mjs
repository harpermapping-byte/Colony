// E2E del minijuego de alquimia/pociones (docs/GDD_Pociones.md, pedido
// 2026-09-01) contra el servidor REAL — protocolo Colyseus real
// (colyseus.js Client directo, sin navegador, mismo criterio que
// herreria.e2e.mjs/oficios.e2e.mjs: pociones no tiene panel de cliente
// todavía), BD sqlite sembrada ANTES de arrancar (jugador con curandero
// nivel 2 + ingredientes reales + un "caldero" sembrado DIRECTO como
// construcción, mismo atajo que barridoSistemas2.e2e.cjs/herreria.e2e.mjs).
//
// NOTA de robustez (hallazgo real durante esta pasada, confirmado con un
// repro mínimo AJENO a pociones — un simple "oficio:elegir" repetido cada
// 1s también lo sufre): el servidor real sobre el mapa principal tiene un
// hueco de ~3-4s SIN procesar mensajes en algún punto entre el segundo 8 y
// el 11 tras unirse a la room (probablemente carga bajo demanda de fauna/
// bosques al materializarse sectores nuevos) — se autorresuelve solo, no es
// un fallo de conexión (room.onError/onLeave nunca disparan). Como el
// minijuego EXIGE quedarse conectado varios segundos reales (duracionMinimaSeg),
// todas las esperas de este e2e son TOLERANTES (sondeo con timeout generoso,
// nunca un sleep fijo corto) en vez de asumir una respuesta inmediata.
//
//   node server/test/alquimia.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "alquimia_e2e.sqlite");
const PUERTO = 2607;
const NOMBRE = "E2E-Curandero";
const CALDERO_XY = { x: 1600, y: 1601 }; // mismas coords probadas en herreria.e2e.mjs/barridoSistemas2
const PARCELA_ID = "p_0001";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (Jarl, curandero nivel 2, ingredientes reales, caldero sembrado directo)...");
let idCaldero;
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
    CREATE TABLE IF NOT EXISTS construcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propiedad TEXT NOT NULL, objeto TEXT NOT NULL, categoria TEXT NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL, rot INTEGER NOT NULL DEFAULT 0, variante INTEGER NOT NULL DEFAULT 0,
      extra TEXT, creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jugador_oficios (
      jugador_id INTEGER NOT NULL, oficio TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jugador_id, oficio)
    );
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, ahora);
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'curandero', 150)").run(); // nivel 2 (caldero pide nivel 2)

  const items = JSON.stringify([
    { id: 1, itemId: "hierba_venenosa", cantidad: 3, x: 0, y: 0, rot: 0 }, // corruptivo
    { id: 2, itemId: "hierba_curativa", cantidad: 3, x: 1, y: 0, rot: 0 }, // catalizador
    { id: 3, itemId: "flor_medicinal", cantidad: 3, x: 2, y: 0, rot: 0 }, // catalizador
    { id: 4, itemId: "hongo_medicinal", cantidad: 3, x: 3, y: 0, rot: 0 }, // catalizador
    { id: 5, itemId: "hierba_aromatica", cantidad: 3, x: 4, y: 0, rot: 0 }, // neutro
    { id: 6, itemId: "lingote_hierro", cantidad: 5, x: 5, y: 0, rot: 0 }, // NO permitido en el caldero
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 7, ?)").run(items);

  idCaldero = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "caldero", "mueble", CALDERO_XY.x, CALDERO_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  caldero id=${idCaldero}@(${CALDERO_XY.x},${CALDERO_XY.y})`);

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
  console.log("2) arrancando servidor real sobre el mapa principal...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: NOMBRE });
  await esperar(400);

  const eventos = { iniciado: [], progreso: [], completado: [], cancelado: [], errores: [], bebida: [] };
  room.onMessage("alquimia:iniciado", (m) => eventos.iniciado.push(m));
  room.onMessage("alquimia:progreso", (m) => eventos.progreso.push(m));
  room.onMessage("alquimia:completado", (m) => eventos.completado.push(m));
  room.onMessage("alquimia:cancelado", () => eventos.cancelado.push(true));
  room.onMessage("alquimia:error", (m) => eventos.errores.push(m.motivo));
  room.onMessage("pocion:bebida", (m) => eventos.bebida.push(m));

  /** Manda un mensaje y ESPERA de verdad (sondeo, no un sleep fijo) a que una de las 2 bandejas (respuesta esperada / error) crezca — tolerante al hueco de silencio real del servidor (ver nota de cabecera). */
  async function enviarYEsperar(tipo, msg, bandejaRespuesta, timeoutMs = 15000) {
    const antesRespuesta = bandejaRespuesta.length;
    const antesError = eventos.errores.length;
    room.send(tipo, msg);
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (bandejaRespuesta.length > antesRespuesta || eventos.errores.length > antesError) return;
      await esperar(50);
    }
    throw new Error(`FALLO: "${tipo}" no obtuvo ninguna respuesta en ${timeoutMs}ms`);
  }

  console.log("3) el caldero rechaza un ingrediente que no está marcado para alquimia (lingote_hierro)...");
  await enviarYEsperar("alquimia:iniciar", { construccionId: idCaldero, instanciaIds: [1, 6] }, eventos.iniciado);
  if (!eventos.errores.some((m) => /lingote_hierro/.test(m))) {
    throw new Error(`FALLO: debería rechazar lingote_hierro, llegó ${JSON.stringify(eventos.errores)}`);
  }
  console.log(`   OK: ${JSON.stringify(eventos.errores)}`);

  console.log("4) arranca con los 3 catalizadores + 1 corruptivo (venenosa, curativa, flor, hongo) — mezcla avanzada esperada...");
  eventos.errores.length = 0;
  await enviarYEsperar("alquimia:iniciar", { construccionId: idCaldero, instanciaIds: [1, 2, 3, 4] }, eventos.iniciado);
  if (eventos.iniciado.length !== 1) throw new Error(`FALLO: alquimia:iniciado no llegó, errores=${JSON.stringify(eventos.errores)}`);
  const cfg = eventos.iniciado[0].cfg;
  console.log(`   OK: ${JSON.stringify({ construccionId: eventos.iniciado[0].construccionId, fase: eventos.iniciado[0].sesion.fase })}`);

  console.log("5) colar antes de la duración mínima se rechaza...");
  eventos.errores.length = 0;
  room.send("alquimia:colar");
  await esperar(400);
  if (!eventos.errores.some((m) => /pronto/.test(m))) throw new Error(`FALLO: colar pronto debería rechazarse, llegó ${JSON.stringify(eventos.errores)}`);
  console.log(`   OK: ${JSON.stringify(eventos.errores)}`);

  console.log(`6) gestionando el fuego (avivar hasta la ventana) y esperando ${cfg.duracionMinimaSeg}s reales antes de colar...`);
  for (let i = 0; i < 4; i++) {
    await enviarYEsperar("alquimia:accion", { accion: "avivar" }, eventos.progreso);
  }
  // Deja pasar la duración mínima real de una sentada (nada que mandar
  // mientras tanto: la sesión no caduca por estar quieta, solo cuenta el
  // tiempo). enviarYEsperar en el propio "colar" ya tolera el hueco de
  // silencio del servidor con su timeout generoso.
  await esperar((cfg.duracionMinimaSeg + 1) * 1000);
  eventos.completado.length = 0;
  eventos.errores.length = 0;
  await enviarYEsperar("alquimia:colar", undefined, eventos.completado);
  if (eventos.completado.length !== 1) throw new Error(`FALLO: alquimia:colar debería completar, llegó errores=${JSON.stringify(eventos.errores)}`);
  const resultado = eventos.completado[0];
  if (resultado.itemId !== "pocion_alquimica" || typeof resultado.instanciaId !== "number") {
    throw new Error(`FALLO: entrega inesperada, llegó ${JSON.stringify(resultado)}`);
  }
  // El negativo es genuinamente probabilístico (1 corruptivo -> 35% de
  // probabilidad, Math.random() real de producción, sin rnd inyectado en
  // este e2e) — solo lo positivo (mezcla avanzada con 3 catalizadores
  // distintos) es determinista: SIEMPRE 4 bonos. 4 ó 5 efectos totales son
  // ambos resultados válidos; 4 negativos o menos de 4 positivos no lo son.
  // Un "especial" (xpOficioX2/produccionCrafteoX2/sigilo, ampliación
  // 2026-09-01) no tiene magnitudPct — siempre cuenta como positivo, nunca
  // sale en el rol negativo (POOL_STATS_NEGATIVOS no los incluye).
  const positivos = resultado.efectos.filter((e) => e.categoria === "especial" || e.magnitudPct > 0);
  const negativos = resultado.efectos.filter((e) => e.categoria === "stat" && e.magnitudPct < 0);
  if (positivos.length !== 4) throw new Error(`FALLO: mezcla avanzada debería dar 4 positivos (stat o especial), llegó ${JSON.stringify(resultado.efectos)}`);
  if (resultado.efectos.length !== positivos.length + negativos.length || negativos.length > 1) {
    throw new Error(`FALLO: como mucho 1 efecto negativo, llegó ${JSON.stringify(resultado.efectos)}`);
  }
  console.log(`   OK: pureza=${resultado.pureza?.toFixed(2)} efectos=${JSON.stringify(resultado.efectos)}`);

  console.log("7) beber la poción aplica de verdad los efectos rolados a las stats de combate del jugador...");
  // Con el pool ampliado (8 stats + 3 especiales, ampliación 2026-09-01) la
  // mezcla avanzada ya NO garantiza que los 4 bonos caigan en los 4 stats
  // de combate — pueden salir velocidad/vida/estamina/carga/especiales. Se
  // comprueba lo que el propio servidor dice que roló (eventos.bebida[0].efectos,
  // el mismo array que colarPocion entregó) contra las stats de combate
  // reales ANTES/DESPUÉS: determinista dado el roll, en vez de asumir que
  // ataque/defensa concretamente cambian (ya no es siempre así).
  const leerCombate = () => {
    const p = room.state.players.get(room.sessionId);
    return { ataqueFisico: p.ataque, defensaFisica: p.defensa, ataqueMagico: p.ataqueMagico, defensaMagica: p.defensaMagica };
  };
  const antesCombate = leerCombate();
  await enviarYEsperar("pocion:beber", { instanciaId: resultado.instanciaId }, eventos.bebida);
  if (eventos.bebida.length !== 1) throw new Error(`FALLO: pocion:beber debería confirmar, llegó ${JSON.stringify(eventos.bebida)}`);
  await esperar(200);
  const despuesCombate = leerCombate();
  const efectosCombate = eventos.bebida[0].efectos.filter((e) => e.categoria === "stat" && e.stat in antesCombate);
  if (efectosCombate.length === 0) {
    console.log(`   OK (esta tirada no incluyó ningún stat de combate — pool ampliado, efectos reales: ${JSON.stringify(eventos.bebida[0].efectos)})`);
  } else {
    const huboCambio = efectosCombate.some((e) => antesCombate[e.stat] !== despuesCombate[e.stat]);
    if (!huboCambio) throw new Error(`FALLO: la tirada incluía stats de combate (${JSON.stringify(efectosCombate)}) pero ninguno cambió tras beber — antes=${JSON.stringify(antesCombate)} después=${JSON.stringify(despuesCombate)}`);
    console.log(`   OK: antes=${JSON.stringify(antesCombate)} después=${JSON.stringify(despuesCombate)}`);
  }

  console.log("8) cancelar una alquimia en curso limpia la sesión y NO devuelve los ingredientes...");
  eventos.iniciado.length = 0;
  await enviarYEsperar("alquimia:iniciar", { construccionId: idCaldero, instanciaIds: [1, 5] }, eventos.iniciado); // 1 corruptivo restante + 1 neutro
  if (eventos.iniciado.length !== 1) throw new Error(`FALLO: no arrancó el segundo intento, errores=${JSON.stringify(eventos.errores)}`);
  await enviarYEsperar("alquimia:cancelar", undefined, eventos.cancelado);
  if (eventos.cancelado.length !== 1) throw new Error(`FALLO: cancelar debería confirmar alquimia:cancelado`);
  eventos.errores.length = 0;
  await enviarYEsperar("alquimia:accion", { accion: "avivar" }, eventos.progreso);
  if (!eventos.errores.some((m) => /ninguna poción/.test(m))) throw new Error(`FALLO: tras cancelar no debería quedar sesión, llegó ${JSON.stringify(eventos.errores)}`);
  console.log("   OK: cancelado y limpiado");

  await room.leave();
  console.log("\n✅ TODO OK: alquimia/pociones verificado contra el servidor real — allowlist de ingredientes, gestión del fuego, mezcla avanzada, entrega real, buff real al beber, cancelado limpio.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
if (fallo) { console.error(fallo); process.exit(1); }
