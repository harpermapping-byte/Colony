// E2E de la Test Zone (docs/GDD_Admin.md, pedido 2026-08-31: "necesito
// tenerlo para ver como vamos") contra el servidor REAL sobre
// assets/mapas/testzone/. A diferencia de probarlo con un navegador real
// (frágil aquí: Chromium headless con WebGL software se cae solo bajo
// carga repetida, no es representativo), esto habla colyseus.js puro,
// igual que el resto de e2e de este proyecto — más rápido y estable para
// verificar la LÓGICA de servidor de los comandos admin:debug:* y los
// cofres de mundo.
//   node test/testZoneDebug.e2e.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { spawn } from "node:child_process";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "testzone_debug_e2e.sqlite");
const rutaTestzone = join(raiz, "assets", "mapas", "testzone");
const PUERTO = 2605;
const NOMBRE_ADMIN = "E2E-Superadmin";
const NOMBRE_NORMAL = "E2E-Normal";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

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

let fallo = null;
let ok = 0, malos = 0;
function comprobar(desc, cond, extra) {
  if (cond) { console.log(`OK ${desc}`, extra ?? ""); ok++; }
  else { console.log(`FALLO ${desc}`, extra ?? ""); malos++; }
}

try {
  console.log("1) arrancando servidor real sobre assets/mapas/testzone/...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
    PORT: String(PUERTO),
    RUTA_MAPA: rutaTestzone,
    BD_RUTA: rutaBd,
    JARL_NOMBRES: NOMBRE_ADMIN,
  });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  await esperar(500);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));

  console.log("2) admin (JARL_NOMBRES) se conecta al hub de testzone...");
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const room = await cliente.joinOrCreate("hub", { name: NOMBRE_ADMIN });
  await esperar(500);

  // --- darItem ---
  console.log("3) admin:debug:darItem con un item real...");
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:darItem", { itemId: "hacha_talar", cantidad: 3 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("darItem responde ok", m?.accion === "darItem", JSON.stringify(m));
  }

  console.log("4) admin:debug:darItem con item inexistente se rechaza...");
  {
    const p = esperarMensaje(room, "admin:error");
    room.send("admin:debug:darItem", { itemId: "esto_no_existe_seguro", cantidad: 1 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("item inexistente rechazado", !!m?.motivo, JSON.stringify(m));
  }

  // --- ajustarFarycoins (pedido 2026-09-02) ---
  console.log("5b) admin:debug:ajustarFarycoins da dinero a la propia cuenta...");
  let saldoTrasDar = null;
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:ajustarFarycoins", { cantidad: 500 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("ajustarFarycoins (dar) responde ok con saldo", m?.accion === "ajustarFarycoins" && typeof m?.saldo === "number", JSON.stringify(m));
    saldoTrasDar = m?.saldo ?? null;
  }

  console.log("5c) admin:debug:ajustarFarycoins quita dinero (cantidad negativa)...");
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:ajustarFarycoins", { cantidad: -200 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("ajustarFarycoins (quitar) descuenta del saldo real", m?.saldo === (saldoTrasDar ?? 0) - 200, JSON.stringify({ m, saldoTrasDar }));
  }

  console.log("5d) admin:debug:ajustarFarycoins nunca deja el saldo en negativo...");
  {
    const p = esperarMensaje(room, "admin:error");
    room.send("admin:debug:ajustarFarycoins", { cantidad: -999999 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("quitar más de lo que hay se rechaza limpio (nunca negativo)", !!m?.motivo, JSON.stringify(m));
  }

  // --- limpiarInventario ---
  console.log("5) admin:debug:limpiarInventario...");
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:limpiarInventario", {});
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("limpiarInventario responde ok", m?.accion === "limpiarInventario", JSON.stringify(m));
  }

  // --- godMode ---
  console.log("6) admin:debug:godMode activo=true...");
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:godMode", { activo: true });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("godMode responde ok", m?.accion === "godMode", JSON.stringify(m));
  }

  // --- maxOficio (sin oficio en el slot: debe fallar limpio, no reventar) ---
  console.log("7) admin:debug:maxOficio en slot sin oficio elegido...");
  {
    const p = Promise.race([esperarMensaje(room, "admin:debug:ok"), esperarMensaje(room, "admin:error")]);
    room.send("admin:debug:maxOficio", { slot: 1 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("maxOficio sin oficio no revienta el server (ok o error controlado)", !m?.error, JSON.stringify(m));
  }

  // --- teleport ---
  console.log("8) admin:debug:teleport a la Zona 5 (236,280)...");
  {
    const p = esperarMensaje(room, "admin:debug:ok");
    room.send("admin:debug:teleport", { x: 236, y: 280 });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("teleport responde ok", m?.accion === "teleport", JSON.stringify(m));
  }

  // --- resetearNodo (id ficticio, no debe reventar) ---
  console.log("9) admin:debug:resetearNodo con id ficticio...");
  {
    const p = Promise.race([esperarMensaje(room, "admin:debug:ok"), esperarMensaje(room, "admin:error")]);
    room.send("admin:debug:resetearNodo", { nodoId: "999,999" });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("resetearNodo no revienta el server (ok o error controlado)", !m?.error, JSON.stringify(m));
  }

  // --- gating: un jugador SIN admin no puede usar ningún admin:debug:* ---
  console.log("10) un jugador normal (sin JARL_NOMBRES) no puede usar admin:debug:*...");
  {
    const clienteNormal = new Client(`ws://localhost:${PUERTO}`);
    const roomNormal = await clienteNormal.joinOrCreate("hub", { name: NOMBRE_NORMAL });
    await esperar(300);
    const p = esperarMensaje(roomNormal, "admin:error");
    roomNormal.send("admin:debug:godMode", { activo: true });
    const m = await p.catch((e) => ({ error: e.message }));
    comprobar("jugador normal rechazado", !!m?.motivo, JSON.stringify(m));

    const pCoins = esperarMensaje(roomNormal, "admin:error");
    roomNormal.send("admin:debug:ajustarFarycoins", { cantidad: 1000 });
    const mCoins = await pCoins.catch((e) => ({ error: e.message }));
    comprobar("jugador normal no puede darse Farycoins de prueba", !!mCoins?.motivo, JSON.stringify(mCoins));

    // --- cofres de mundo: SIN gate de jarl, cualquiera puede abrir/tomar ---
    console.log("11) jugador normal abre un cofre de mundo (contenedorTest:abrir)...");
    const pEstado = esperarMensaje(roomNormal, "contenedorTest:estado");
    roomNormal.send("contenedorTest:abrir", { id: "herramientas" });
    const estado = await pEstado.catch((e) => ({ error: e.message }));
    comprobar("cofre 'herramientas' responde con items", Array.isArray(estado?.items) && estado.items.length > 0, JSON.stringify(estado));

    console.log("12) jugador normal toma un item del cofre (stock infinito, no se agota)...");
    if (estado?.items?.length) {
      const itemId = estado.items[0].itemId;
      const pTomado = esperarMensaje(roomNormal, "contenedorTest:tomado");
      roomNormal.send("contenedorTest:tomar", { id: "herramientas", itemId, cantidad: 2 });
      const tomado = await pTomado.catch((e) => ({ error: e.message }));
      comprobar("tomar del cofre responde tomado", tomado?.itemId === itemId, JSON.stringify(tomado));

      // segunda vez, cantidad pequeña de un item DISTINTO (no repetir el mismo,
      // que ya puede haber llenado el hueco de stack): si el cofre fuera
      // finito, esta segunda petición fallaría por "stock agotado" — no debe,
      // solo puede fallar por hueco de inventario (límite normal del jugador,
      // no del cofre).
      const itemId2 = estado.items[1]?.itemId ?? itemId;
      const pTomado2 = esperarMensaje(roomNormal, "contenedorTest:tomado");
      roomNormal.send("contenedorTest:tomar", { id: "herramientas", itemId: itemId2, cantidad: 1 });
      const tomado2 = await pTomado2.catch((e) => ({ error: e.message }));
      comprobar("segunda vez (item distinto) sigue sin agotar el cofre", tomado2?.itemId === itemId2, JSON.stringify(tomado2));
    } else {
      comprobar("cofre tenía items para probar tomar()", false);
    }

    console.log("13) cofre con id inexistente se rechaza sin reventar...");
    const pErrorCofre = esperarMensaje(roomNormal, "contenedorTest:error");
    roomNormal.send("contenedorTest:abrir", { id: "esto_no_existe" });
    const errCofre = await pErrorCofre.catch((e) => ({ error: e.message }));
    comprobar("cofre inexistente rechazado limpio", !!errCofre?.motivo, JSON.stringify(errCofre));
  }

  console.log(`\n${malos === 0 ? "✅ TODO OK" : "❌ HAY FALLOS"}: ${ok} comprobaciones OK, ${malos} FALLARON.`);
  if (malos > 0) fallo = new Error(`${malos} comprobaciones fallaron`);
} catch (e) {
  fallo = e;
  console.error(e);
} finally {
  matarTodo();
  try { unlinkSync(rutaBd); } catch {}
  try { unlinkSync(rutaBd + "-shm"); } catch {}
  try { unlinkSync(rutaBd + "-wal"); } catch {}
}

if (fallo) { console.error("FALLO:", fallo.message); process.exit(1); }
