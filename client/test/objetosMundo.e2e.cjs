"use strict";

// E2E de objetos sueltos en el mundo (`state.objetosMundo`, docs/GDD_Ganaderia.md
// §12, pedido 2026-09-01: "recolectable tanto del suelo como de nidos...
// click sobre el huevo, recoger huevo") — mismo patrón raw-colyseus.js SIN
// navegador que combate.e2e.mjs/vitalesPersistencia.e2e.mjs (aquí no hace
// falta Playwright: lo que hay que probar es el MECANISMO servidor
// soltar->objetosMundo->coger, el mismo dato que consume el render nuevo
// del cliente, `client/src/mundo/renderObjetosMundo.ts` — el render en sí
// es una malla placeholder `colorDebug`, sin lógica propia que pueda
// desviarse del dato, así que no hace falta un navegador real para
// verificar que el DATO llega bien formado).
//
// Reproducir con una gallina real (domesticar+alimentar+esperar días de
// mundo) sería una pasada de e2e aparte enorme para algo que ya prueba
// server/test/*ganaderia*: aquí se prueba el objeto SUELTO en general con
// "soltar" (mismo ObjetoMundoSchema exacto que usan los huevos,
// RoomExteriorBase.ts::resolverReproduccionAnimalesPropiedad), que es lo
// que de verdad cambia en esta pasada (antes NADA de esto se renderizaba
// ni tenía ruta de clic).
//   node client/test/objetosMundo.e2e.cjs

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");
const { Client } = require("colyseus.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const PUERTO_WS = 2600;
const BD_RUTA = path.join(os.tmpdir(), "colony_objetos_mundo_e2e.sqlite");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarCondicion(fn, timeoutMs, intervaloMs = 100) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const v = fn();
    if (v) return v;
    await esperar(intervaloMs);
  }
  return null;
}

async function main() {
  let fallos = 0;
  const comprobar = (ok, mensaje) => {
    console.log(`${ok ? "ok" : "FALLO"} - ${mensaje}`);
    if (!ok) fallos++;
  };

  fs.rmSync(BD_RUTA, { force: true });
  console.log("1) sembrando BD sqlite temporal — Jarl con un huevo ya en el cuerpo...");
  {
    const bd = new DatabaseSync(BD_RUTA);
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
    `);
    bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, 'Jarl', ?)").run(new Date().toISOString());
    const items = JSON.stringify([{ id: 1, itemId: "huevo", cantidad: 3, x: 0, y: 0, rot: 0 }]);
    bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);
    bd.close();
  }

  let servidor;
  const matar = () => {
    try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
    try { servidor.kill("SIGKILL"); } catch {}
  };
  try {
    servidor = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: path.join(RAIZ, "server"),
      env: { ...process.env, PORT: String(PUERTO_WS), JARL_NOMBRES: "Jarl", BD_RUTA },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    servidor.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
    servidor.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
    await esperar(3000);

    const client = new Client(`ws://localhost:${PUERTO_WS}`);
    const room = await client.joinOrCreate("hub", { name: "Jarl" });
    await esperarCondicion(() => room.state?.players?.get(room.sessionId) && room.state.objetosMundo, 5000, 100);
    const propio = room.state.players.get(room.sessionId);
    comprobar(!!propio, `jugador conectado en (${propio?.x}, ${propio?.y})`);

    const inicial = room.state.objetosMundo.size;
    console.log("2) soltando 1 huevo (instanciaId=1, mismo ObjetoMundoSchema que usan los huevos de granja)...");
    room.send("soltar", { instanciaId: 1, cantidad: 1 });

    const idSoltado = await esperarCondicion(() => {
      for (const [id, o] of room.state.objetosMundo.entries()) if (o.itemId === "huevo") return id;
      return null;
    }, 3000, 100);
    comprobar(!!idSoltado, `objetosMundo ganó una entrada itemId="huevo" (id=${idSoltado})`);
    if (idSoltado) {
      const o = room.state.objetosMundo.get(idSoltado);
      comprobar(o.cantidad === 1, `cantidad correcta (${o.cantidad})`);
      comprobar(
        Math.hypot(o.x - propio.x, o.y - propio.y) < 2,
        `posición razonable junto al jugador (objeto=${o.x},${o.y} jugador=${propio.x},${propio.y})`,
      );
    }
    comprobar(room.state.objetosMundo.size === inicial + 1, "exactamente una entrada nueva (no duplicada)");

    console.log("3) recogiéndolo con \"coger\" (el MISMO mensaje que manda la opción \"Recoger huevo\" del menú de clic)...");
    let errorCoger = null;
    room.onMessage("coger:error", (m) => { errorCoger = m; });
    room.send("coger", {});
    const desaparecio = await esperarCondicion(() => !room.state.objetosMundo.has(idSoltado), 3000, 100);
    comprobar(!!desaparecio, `el objeto desaparece de objetosMundo tras "coger" (error=${JSON.stringify(errorCoger)})`);

    room.leave();
  } catch (err) {
    console.error(err);
    fallos++;
  } finally {
    matar();
    fs.rmSync(BD_RUTA, { force: true });
  }

  console.log(fallos === 0 ? "\n✅ objetosMundo.e2e: todo OK" : `\n❌ objetosMundo.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
