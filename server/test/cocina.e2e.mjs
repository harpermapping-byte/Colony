// E2E del minijuego de cocina (docs/GDD_Cocina.md, pedido 2026-09-01: "dale
// con minijuego cocina") contra el servidor REAL — protocolo Colyseus real
// (colyseus.js Client directo, sin navegador, mismo criterio que
// herreria.e2e.mjs/alquimia.e2e.mjs), BD sqlite sembrada ANTES de arrancar
// (jugador con cocinero nivel 2 + ingredientes reales + un "cuenco_barro_grande"
// (sartén, hierveAgua:false — sin esperar hervor, va directo al minijuego)
// sembrado DIRECTO como construcción, mismo atajo que herreria.e2e.mjs).
//
// Mismo hallazgo de robustez que alquimia.e2e.mjs: el servidor real tiene un
// hueco de ~3-4s sin procesar mensajes en algún punto tras unirse a la room
// — todas las esperas de este e2e son TOLERANTES (sondeo, nunca un sleep fijo
// corto asumiendo respuesta inmediata).
//
//   node server/test/cocina.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "cocina_e2e.sqlite");
const PUERTO = 2608;
const NOMBRE = "E2E-Cocinero";
const VASIJA_XY = { x: 1600, y: 1601 }; // mismas coords probadas en herreria.e2e.mjs/alquimia.e2e.mjs
const PARCELA_ID = "p_0001";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (Jarl, cocinero nivel 2, ingredientes reales, cuenco_barro_grande sembrado directo)...");
let idVasija;
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
  bd.prepare("INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (1, 'cocinero', 150)").run(); // nivel 2 (vasijas piden nivel 2)

  const items = JSON.stringify([
    { id: 1, itemId: "zanahoria", cantidad: 4, x: 0, y: 0, rot: 0 }, // vegetal
    { id: 2, itemId: "carne_roja", cantidad: 4, x: 1, y: 0, rot: 0 }, // animal — mezclaBonus con zanahoria
    { id: 3, itemId: "lingote_hierro", cantidad: 5, x: 2, y: 0, rot: 0 }, // NO sirve para cocinar (sin aportesCocina)
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 4, ?)").run(items);

  idVasija = Number(
    bd.prepare("INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(PARCELA_ID, "cuenco_barro_grande", "exterior", VASIJA_XY.x, VASIJA_XY.y, 0, 0, null, ahora).lastInsertRowid,
  );
  bd.close();
}
console.log(`  cuenco_barro_grande id=${idVasija}@(${VASIJA_XY.x},${VASIJA_XY.y})`);

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

  const eventos = { estado: [], iniciado: [], progreso: [], preparado: [], cancelado: [], errores: [] };
  room.onMessage("cocina:estado", (m) => eventos.estado.push(m));
  room.onMessage("cocina:iniciado", (m) => eventos.iniciado.push(m));
  room.onMessage("cocina:progreso", (m) => eventos.progreso.push(m));
  room.onMessage("cocina:preparado", (m) => eventos.preparado.push(m));
  room.onMessage("cocina:cancelado", () => eventos.cancelado.push(true));
  room.onMessage("cocina:error", (m) => eventos.errores.push(m.motivo));

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

  console.log("3) la vasija rechaza un ingrediente sin aportesCocina (lingote_hierro)...");
  await enviarYEsperar("cocina:anadir", { construccionId: idVasija, instanciaId: 3, cantidad: 1 }, eventos.estado);
  if (!eventos.errores.some((m) => /no es un ingrediente/.test(m))) {
    throw new Error(`FALLO: debería rechazar lingote_hierro, llegó ${JSON.stringify(eventos.errores)}`);
  }
  console.log(`   OK: ${JSON.stringify(eventos.errores)}`);

  console.log("4) añade zanahoria + carne_roja (vegetal+animal -> mezclaBonus esperado) — sartén, sin esperar hervor...");
  eventos.errores.length = 0;
  await enviarYEsperar("cocina:anadir", { construccionId: idVasija, instanciaId: 1, cantidad: 2 }, eventos.estado);
  if (eventos.errores.length > 0) throw new Error(`FALLO: añadir zanahoria no debería dar error, llegó ${JSON.stringify(eventos.errores)}`);
  await enviarYEsperar("cocina:anadir", { construccionId: idVasija, instanciaId: 2, cantidad: 2 }, eventos.estado);
  if (eventos.errores.length > 0) throw new Error(`FALLO: añadir carne_roja no debería dar error, llegó ${JSON.stringify(eventos.errores)}`);
  console.log(`   OK: zanahoria + carne_roja añadidas, vasija: ${JSON.stringify(eventos.estado.at(-1)?.ingredientes)}`);

  console.log("5) cocina:preparar ARRANCA la sesión (cocinero nivel 2, ya no es instantáneo)...");
  await enviarYEsperar("cocina:preparar", { construccionId: idVasija }, eventos.iniciado);
  if (eventos.iniciado.length !== 1) throw new Error(`FALLO: cocina:iniciado no llegó, errores=${JSON.stringify(eventos.errores)}`);
  const cfg = eventos.iniciado[0].cfg;
  console.log(`   OK: ${JSON.stringify({ cfg: cfg.duracionMinimaSeg, fase: eventos.iniciado[0].sesion.fase })}`);

  console.log("6) un segundo 'cocina:preparar' mientras hay sesión se rechaza (guard mutuo)...");
  eventos.errores.length = 0;
  await enviarYEsperar("cocina:preparar", { construccionId: idVasija }, eventos.errores);
  if (!eventos.errores.some((m) => /en curso/.test(m))) throw new Error(`FALLO: debería rechazar doble sesión, llegó ${JSON.stringify(eventos.errores)}`);
  console.log(`   OK: ${JSON.stringify(eventos.errores)}`);

  console.log("7) servir antes de la duración mínima se rechaza...");
  eventos.errores.length = 0;
  room.send("cocina:servir");
  await esperar(400);
  if (!eventos.errores.some((m) => /pronto/.test(m))) throw new Error(`FALLO: servir pronto debería rechazarse, llegó ${JSON.stringify(eventos.errores)}`);
  console.log(`   OK: ${JSON.stringify(eventos.errores)}`);

  console.log(`8) gestionando el fuego (avivar hasta la ventana) y esperando ${cfg.duracionMinimaSeg}s reales antes de servir...`);
  for (let i = 0; i < 4; i++) {
    await enviarYEsperar("cocina:accion", { accion: "avivar" }, eventos.progreso);
  }
  await esperar((cfg.duracionMinimaSeg + 1) * 1000);
  eventos.preparado.length = 0;
  eventos.errores.length = 0;
  await enviarYEsperar("cocina:servir", undefined, eventos.preparado);
  if (eventos.preparado.length !== 1) throw new Error(`FALLO: cocina:servir debería completar, llegó errores=${JSON.stringify(eventos.errores)}`);
  const resultado = eventos.preparado[0];
  if (typeof resultado.itemId !== "string" || resultado.cantidad < 1) {
    throw new Error(`FALLO: entrega inesperada, llegó ${JSON.stringify(resultado)}`);
  }
  if (resultado.mezclaBonus !== true) throw new Error(`FALLO: zanahoria+carne_roja debería dar mezclaBonus, llegó ${JSON.stringify(resultado)}`);
  if (resultado.oficio !== "cocinero" || typeof resultado.nivel !== "number") {
    throw new Error(`FALLO: debería otorgar XP/nivel de cocinero, llegó ${JSON.stringify(resultado)}`);
  }
  console.log(`   OK: pureza=${resultado.pureza?.toFixed(2)} ${resultado.cantidad}x ${resultado.nombre} nivel_cocinero=${resultado.nivel}`);

  console.log("9) cancelar una cocina en curso limpia la sesión (sin devolver ingredientes ya gastados)...");
  eventos.errores.length = 0;
  room.send("cocina:anadir", { construccionId: idVasija, instanciaId: 1, cantidad: 1 });
  await esperar(300);
  eventos.iniciado.length = 0;
  await enviarYEsperar("cocina:preparar", { construccionId: idVasija }, eventos.iniciado);
  if (eventos.iniciado.length !== 1) throw new Error(`FALLO: no arrancó el segundo intento, errores=${JSON.stringify(eventos.errores)}`);
  await enviarYEsperar("cocina:cancelar", undefined, eventos.cancelado);
  if (eventos.cancelado.length !== 1) throw new Error(`FALLO: cancelar debería confirmar cocina:cancelado`);
  eventos.errores.length = 0;
  await enviarYEsperar("cocina:accion", { accion: "avivar" }, eventos.progreso);
  if (!eventos.errores.some((m) => /ningún plato/.test(m))) throw new Error(`FALLO: tras cancelar no debería quedar sesión, llegó ${JSON.stringify(eventos.errores)}`);
  console.log("   OK: cancelado y limpiado");

  await room.leave();
  console.log("\n✅ TODO OK: minijuego de cocina verificado contra el servidor real — gate cocinero nivel 2, allowlist de ingredientes, guard mutuo, sesión completa (iniciar→avivar→servir), mezclaBonus real, XP de cocinero, cancelado limpio.");
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
}
if (fallo) { console.error(fallo); process.exit(1); }
