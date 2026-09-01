// E2E del minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería,
// pedido 2026-09-01) contra el servidor REAL — protocolo Colyseus real
// (colyseus.js Client directo, sin navegador: crafteo no tiene panel de
// cliente todavía, mismo criterio que oficios.e2e.mjs/
// herramientasRecoleccion.e2e.mjs), BD sqlite sembrada ANTES de arrancar
// (jugador con herrero nivel 2 + insumos + un "yunque_tocon" sembrado
// DIRECTO como construcción — mismo atajo que ya usó
// client/test/barridoSistemas2.e2e.cjs para esta misma mesa/receta de
// herrero, mismas coordenadas de spawn/mesa ya verificadas libres en el
// mapa principal real). Confirma:
//   1) crafteo:iniciar en daga_craft entra en el minijuego (fase CALENTAR),
//      NO en el camino normal de temporizador.
//   2) avivar calienta hasta FORJAR; golpear registra los 12 golpes con
//      dificultad server-autoritativa (el timing lo decide el cursor que
//      simula el SERVIDOR, nunca lo que mande el cliente); templar cierra
//      la sesión y entrega de verdad — daga si no fue perfecto,
//      daga_bonificada (+25% ataqueFisico) si fue perfecto (5★).
//   3) doble "crafteo:iniciar" mientras hay una forja en curso se rechaza
//      (no se puede pisar/duplicar la sesión).
//   4) cancelar limpia la sesión de verdad (una acción después ya no
//      encuentra ninguna forja).
//   5) los insumos se descuentan AL INICIAR (no al terminar) y NO se
//      devuelven al cancelar — agotados, un intento más se rechaza.
//   node server/test/herreria.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "herreria_e2e.sqlite");
const PUERTO = 2605;
const NOMBRE = "E2E-Herrero";
// Mismas coordenadas que client/test/barridoSistemas2.e2e.cjs (ya
// verificadas libres/alcanzables desde el spawn real 1600.5,1600.5 del
// mapa principal, RADIO_INTERACCION=2.2 — no hace falta caminar).
const SPAWN = { x: 1600.5, y: 1600.5 };
const YUNQUE_XY = { x: 1600, y: 1601 };
const PARCELA_ID = "p_0001";
const LINGOTES_SEMBRADOS = 8; // 4 intentos de daga_craft (2 lingote_hierro cada uno)

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (Jarl, herrero nivel 2, insumos, yunque_tocon sembrado directo)...");
let idYunque;
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
  `);
  const ahora = new Date().toISOString();
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, ahora);
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'herrero', 150)").run(); // nivel 2, daga_craft pide nivelMinimo 1

  const items = JSON.stringify([{ id: 1, itemId: "lingote_hierro", cantidad: LINGOTES_SEMBRADOS, x: 0, y: 0, rot: 0 }]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);

  idYunque = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "yunque_tocon", "mueble", YUNQUE_XY.x, YUNQUE_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  yunque_tocon id=${idYunque}@(${YUNQUE_XY.x},${YUNQUE_XY.y}), spawn=(${SPAWN.x},${SPAWN.y}), ${LINGOTES_SEMBRADOS} lingote_hierro`);

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
  await esperar(400); // deja que el jugador entre del todo antes del primer mensaje

  const progresos = [];
  const completados = [];
  const cancelados = [];
  const errores = [];
  room.onMessage("crafteo:herreria:iniciado", (m) => progresos.push({ tipo: "iniciado", ...m }));
  room.onMessage("crafteo:herreria:progreso", (m) => progresos.push({ tipo: "progreso", ...m }));
  room.onMessage("crafteo:herreria:completado", (m) => completados.push(m));
  room.onMessage("crafteo:herreria:cancelado", () => cancelados.push(true));
  room.onMessage("crafteo:error", (m) => errores.push(m.motivo));

  /** Arranca daga_craft en el yunque sembrado y espera crafteo:herreria:iniciado. */
  async function iniciarForja() {
    progresos.length = 0;
    errores.length = 0;
    room.send("crafteo:iniciar", { recetaId: "daga_craft", construccionId: idYunque });
    await esperar(500);
    if (progresos.length === 0) throw new Error(`FALLO: crafteo:iniciar no arrancó la forja, errores=${JSON.stringify(errores)}`);
  }

  /**
   * Manda una acción de forja y ESPERA de verdad a que llegue una respuesta
   * nueva (progreso/completado/error) en vez de dormir un tiempo fijo — bajo
   * carga del servidor (fauna/bosques en vivo, simulación 30Hz) un sleep
   * fijo corto es frágil (measured: 120ms no siempre basta para 12 golpes
   * seguidos); esto sondea cada 20ms hasta `timeoutMs`, tolerante a picos de
   * latencia puntuales sin alargar el caso normal (rápido).
   */
  async function enviarAccionForja(accion, timeoutMs = 3000) {
    const antesProgreso = progresos.length;
    const antesCompletado = completados.length;
    const antesError = errores.length;
    room.send("crafteo:herreria:accion", { accion });
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (progresos.length > antesProgreso || completados.length > antesCompletado || errores.length > antesError) return;
      await esperar(20);
    }
    throw new Error(`FALLO: "${accion}" no obtuvo ninguna respuesta en ${timeoutMs}ms`);
  }

  /** Juega una forja completa de principio a fin (avivar hasta FORJAR, golpear x12, templar) y devuelve el mensaje "completado". */
  async function jugarForjaCompleta() {
    for (let i = 0; i < 6 && progresos.at(-1)?.sesion?.fase !== "FORJAR"; i++) {
      await enviarAccionForja("avivar");
    }
    if (progresos.at(-1)?.sesion?.fase !== "FORJAR") throw new Error(`FALLO: no llegó a FORJAR tras avivar, último=${JSON.stringify(progresos.at(-1))} errores=${JSON.stringify(errores)}`);

    for (let i = 0; i < 14 && progresos.at(-1)?.sesion?.fase !== "TEMPLAR"; i++) {
      await enviarAccionForja("golpear");
    }
    if (progresos.at(-1)?.sesion?.fase !== "TEMPLAR") {
      throw new Error(
        `FALLO: no llegó a TEMPLAR tras 12 golpes, último=${JSON.stringify(progresos.at(-1))} errores=${JSON.stringify(errores)}`,
      );
    }

    completados.length = 0;
    await enviarAccionForja("templar");
    if (completados.length !== 1) throw new Error(`FALLO: templar debería disparar crafteo:herreria:completado, llegó ${JSON.stringify(completados)}`);
    return completados[0];
  }

  console.log("3) crafteo:iniciar en daga_craft entra en el minijuego (fase CALENTAR, no terminaEn)...");
  await iniciarForja();
  const iniciado = progresos.find((p) => p.tipo === "iniciado");
  if (!iniciado || iniciado.recetaId !== "daga_craft" || iniciado.sesion?.fase !== "CALENTAR" || !iniciado.cfg) {
    throw new Error(`FALLO: crafteo:herreria:iniciado no llegó como se esperaba, llegó ${JSON.stringify(iniciado)}`);
  }
  console.log(`   OK: ${JSON.stringify({ recetaId: iniciado.recetaId, fase: iniciado.sesion.fase })}`);

  console.log("4) mientras hay una forja en curso, un segundo crafteo:iniciar se rechaza (no se pisa la sesión)...");
  errores.length = 0;
  room.send("crafteo:iniciar", { recetaId: "daga_craft", construccionId: idYunque });
  await esperar(300);
  // Guard unificado 2026-09-01 (algunMinijuegoEnCurso, docs/GDD_Cocina.md) — mismo mensaje para crafteo/forja/alquimia/cocina, ya no uno específico por sistema.
  if (!errores.some((m) => /en curso/.test(m))) {
    throw new Error(`FALLO: doble iniciar debería rechazarse, llegó ${JSON.stringify(errores)}`);
  }
  console.log(`   OK: ${JSON.stringify(errores)}`);

  console.log("5) jugando la forja completa (avivar->FORJAR, 12 golpes, templar) — entrega real...");
  const resultado1 = await jugarForjaCompleta();
  const perfecta1 = resultado1.estrellas === 5;
  if (resultado1.perfecta !== perfecta1) throw new Error(`FALLO: perfecta debería ser estrellas===5, llegó ${JSON.stringify(resultado1)}`);
  const itemEsperado1 = perfecta1 ? "daga_bonificada" : "daga";
  if (resultado1.itemId !== itemEsperado1 || resultado1.cantidad !== 1) {
    throw new Error(`FALLO: con estrellas=${resultado1.estrellas} esperaba itemId=${itemEsperado1}, llegó ${JSON.stringify(resultado1)}`);
  }
  if (typeof resultado1.xp !== "number" || typeof resultado1.nivel !== "number") {
    throw new Error(`FALLO: completado debería traer xp/nivel de oficio, llegó ${JSON.stringify(resultado1)}`);
  }
  console.log(`   OK: ${JSON.stringify(resultado1)}`);

  console.log("6) cancelar una forja en curso limpia la sesión de verdad...");
  await iniciarForja();
  room.send("crafteo:herreria:accion", { accion: "avivar" });
  await esperar(200);
  cancelados.length = 0;
  room.send("crafteo:herreria:cancelar");
  await esperar(300);
  if (cancelados.length !== 1) throw new Error(`FALLO: cancelar debería confirmar crafteo:herreria:cancelado, llegó ${cancelados.length}`);
  errores.length = 0;
  room.send("crafteo:herreria:accion", { accion: "avivar" });
  await esperar(300);
  if (!errores.some((m) => /ninguna forja/.test(m))) {
    throw new Error(`FALLO: tras cancelar, una acción no debería encontrar forja alguna, llegó ${JSON.stringify(errores)}`);
  }
  console.log("   OK: cancelado y limpiado — una acción después ya no encuentra ninguna forja en curso");

  console.log("7) los insumos NO se devolvieron al cancelar (se gastan al iniciar, no al terminar) — agota lo que queda con más forjas completas...");
  // Sembrados 8 lingotes: intento 1 gastó 2, intento 2 (cancelado) gastó otros 2 -> quedan 4 (2 forjas más).
  await iniciarForja();
  await jugarForjaCompleta();
  await iniciarForja();
  await jugarForjaCompleta();
  console.log("   OK: 2 forjas completas más consumieron los 4 lingotes restantes sin error");

  console.log("8) sin insumos, un nuevo crafteo:iniciar se rechaza (confirma que se gastaron de verdad)...");
  errores.length = 0;
  room.send("crafteo:iniciar", { recetaId: "daga_craft", construccionId: idYunque });
  await esperar(300);
  if (!errores.some((m) => /lingote_hierro/.test(m))) {
    throw new Error(`FALLO: sin insumos debería rechazarse por falta de lingote_hierro, llegó ${JSON.stringify(errores)}`);
  }
  console.log(`   OK: ${JSON.stringify(errores)}`);

  await room.leave();
  console.log("\n✅ TODO OK: minijuego de forja verificado contra el servidor real — fases, doble-inicio bloqueado, cancelado limpio, insumos gastados al iniciar (nunca devueltos), entrega real (base o bonificada según estrellas).");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
if (fallo) { console.error(fallo); process.exit(1); }
