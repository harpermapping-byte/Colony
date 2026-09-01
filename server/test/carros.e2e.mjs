// E2E de carros y arneses de tiro (docs/GDD_Carros.md §14 Fase 1, pedido
// 2026-09-03) contra el servidor REAL — mismo patrón que barcos.e2e.mjs/
// monturas.e2e.mjs: siembra la BD sqlite temporal con un buey YA
// domesticado "siguiendo" (la domesticación en sí ya está cubierta por
// otros tests) y usa admin:debug:darItem (JARL_NOMBRES) para saltarse el
// crafteo y ejercitar el flujo COMPLETO de verdad: ponerArnes -> colocar ->
// enganchar -> montar (conductor, velocidad de conjunto) -> desmontar (se
// para en el sitio) -> desenganchar (vuelve a separar).
//   node server/test/carros.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "carros_e2e.sqlite");
const PUERTO = 2602;
const NOMBRE = "E2E-Carro";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador + buey domesticado 'siguiendo', SIN arnés todavía)...");
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
    CREATE TABLE IF NOT EXISTS carros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jugador_id INTEGER NOT NULL,
      tipo_id TEXT NOT NULL,
      mapa_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      creado_en TEXT NOT NULL
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
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (1, 'buey', 'siguiendo', NULL, ?, 0, 0, 0)").run(new Date().toISOString());
  bd.close();
}

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

function esperarMensaje(room, tipo, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando mensaje "${tipo}"`)), ms);
    room.onMessage(tipo, (m) => { clearTimeout(t); resolve(m); });
  });
}

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre esa BD sembrada (JARL_NOMBRES para admin:debug:darItem)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) join — el buey sembrado debe aparecer YA en state.mascotas, sin arnés...");
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  let mascotas = [...room.state.mascotas.values()];
  if (mascotas.length !== 1 || mascotas[0].especieId !== "buey" || mascotas[0].arnes !== false) {
    throw new Error(`FALLO: no apareció el buey sin arnés, llegó ${JSON.stringify(mascotas.map((m) => ({ especieId: m.especieId, arnes: m.arnes })))}`);
  }
  console.log("   OK: el buey sembrado aparece siguiendo, sin arnés");

  console.log("3bis) velocidad A PIE de referencia — sesión SEPARADA (mismo punto de spawn exacto)...");
  const clientePie = new Client(`ws://localhost:${PUERTO}`);
  const roomPie = await clientePie.joinOrCreate("hub", { name: "E2E-Carro-Referencia" });
  await new Promise((r) => setTimeout(r, 400));
  const jugadorAPie = roomPie.state.players.get(roomPie.sessionId);
  const xPie0 = jugadorAPie.x, yPie0 = jugadorAPie.y;
  roomPie.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  roomPie.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const distanciaAPie = Math.hypot(jugadorAPie.x - xPie0, jugadorAPie.y - yPie0);
  await roomPie.leave();
  console.log(`   referencia: ${distanciaAPie.toFixed(2)} casillas/seg a pie desde el mismo punto de spawn`);

  console.log("4) admin:debug:darItem arnes_cuero + mascota:ponerArnes (auto-apuntado)...");
  room.send("admin:debug:darItem", { itemId: "arnes_cuero", cantidad: 1 });
  await esperarMensaje(room, "admin:debug:ok");
  const erroresMascota = [];
  room.onMessage("mascota:error", (m) => erroresMascota.push(m));
  room.send("mascota:ponerArnes", {});
  await new Promise((r) => setTimeout(r, 400));
  if (erroresMascota.length > 0) throw new Error(`FALLO: mascota:ponerArnes rechazado, ${JSON.stringify(erroresMascota)}`);
  mascotas = [...room.state.mascotas.values()];
  if (mascotas[0]?.arnes !== true || mascotas[0]?.arnesPesoMaximo !== 150) {
    throw new Error(`FALLO: el buey no quedó con arnes:true/arnesPesoMaximo:150, llegó ${JSON.stringify({ arnes: mascotas[0]?.arnes, arnesPesoMaximo: mascotas[0]?.arnesPesoMaximo })}`);
  }
  console.log("   OK: mascota:ponerArnes consumió el ítem y marcó arnes:true/arnesPesoMaximo:150");

  console.log("5) admin:debug:darItem carreta_dos_plazas + carro:colocar (auto-apuntado)...");
  room.send("admin:debug:darItem", { itemId: "carreta_dos_plazas", cantidad: 1 });
  await esperarMensaje(room, "admin:debug:ok");
  const erroresCarro = [];
  room.onMessage("carro:error", (m) => erroresCarro.push(m));
  room.send("carro:colocar", {});
  const colocado = await esperarMensaje(room, "carro:colocado");
  if (!colocado?.carroId) throw new Error("FALLO: carro:colocado sin carroId");
  await new Promise((r) => setTimeout(r, 300)); // el mensaje de respuesta puede llegar antes que el siguiente patch de Colyseus state
  if (room.state.carros.size !== 1 || [...room.state.carros.values()][0].tipoId !== "carreta_dos_plazas") {
    throw new Error(`FALLO: no apareció la carreta en state.carros, llegó ${JSON.stringify([...room.state.carros.values()])}`);
  }
  console.log(`   OK: carro:colocado (carroId=${colocado.carroId}), visible en state.carros`);

  console.log("6) carro:enganchar (auto-apuntado mascota+carro) — funde en ConjuntoTiroSchema...");
  room.send("carro:enganchar", {});
  const enganchado = await esperarMensaje(room, "carro:enganchado");
  if (!enganchado?.conjuntoId) throw new Error("FALLO: carro:enganchado sin conjuntoId");
  await new Promise((r) => setTimeout(r, 300));
  if (room.state.mascotas.size !== 0) throw new Error("FALLO: la mascota debería haber desaparecido de state.mascotas al engancharla");
  if (room.state.carros.size !== 0) throw new Error("FALLO: el carro debería haber desaparecido de state.carros al engancharlo");
  if (room.state.conjuntosTiro.size !== 1) throw new Error("FALLO: debería haber exactamente 1 conjunto de tiro");
  const conjuntoEsquema = room.state.conjuntosTiro.get(String(enganchado.conjuntoId));
  if (conjuntoEsquema.especieAnimalId !== "buey" || conjuntoEsquema.carroTipoId !== "carreta_dos_plazas") {
    throw new Error(`FALLO: conjunto fusionado con datos incorrectos: ${JSON.stringify({ especieAnimalId: conjuntoEsquema.especieAnimalId, carroTipoId: conjuntoEsquema.carroTipoId })}`);
  }
  console.log(`   OK: conjunto ${enganchado.conjuntoId} fusionado (buey + carreta_dos_plazas), mascota y carro fuera de sus Maps de origen`);

  console.log("7) conjunto:montar (auto-apuntado) — el jugador pasa a ser el conductor...");
  const erroresConjunto = [];
  room.onMessage("carro:error", (m) => erroresConjunto.push(m));
  room.send("conjunto:montar", {});
  await new Promise((r) => setTimeout(r, 400));
  if (erroresConjunto.length > 0) throw new Error(`FALLO: conjunto:montar rechazado, ${JSON.stringify(erroresConjunto)}`);
  let jugador = room.state.players.get(room.sessionId);
  if (jugador.conjuntoId !== enganchado.conjuntoId || jugador.conjuntoConductor !== true) {
    throw new Error(`FALLO: no se fusionó como conductor (conjuntoId=${jugador.conjuntoId}, conjuntoConductor=${jugador.conjuntoConductor})`);
  }
  if (conjuntoEsquema.conductorSessionId !== room.sessionId) throw new Error("FALLO: conductorSessionId del Schema no se rellenó");
  console.log(`   OK: conductor del conjunto ${jugador.conjuntoId}`);

  console.log("8) conduciendo, se mueve más rápido que a pie (velocidad de conjunto, docs/GDD_Carros.md §6) — MISMA duración que la referencia a pie para que la comparación sea justa...");
  const x0 = jugador.x, y0 = jugador.y;
  room.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  room.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const distanciaConjunto = Math.hypot(jugador.x - x0, jugador.y - y0);
  if (distanciaConjunto < distanciaAPie * 1.05) {
    throw new Error(`FALLO: conduciendo (${distanciaConjunto.toFixed(2)}) no fue más rápido que a pie (${distanciaAPie.toFixed(2)}) — ¿rama de velocidad de conjunto rota?`);
  }
  // velocidadMontura(buey)=5.5, FACTOR_CARRO_NORMAL=0.75 -> ~4.125 casillas/seg
  // sin terreno, claramente por debajo de ir montado a pelo (5.5) — la
  // jerarquía completa (andar < conjunto < montura sola) ya la prueba
  // catalogoMonturas.test.ts+esta comparación relativa a pie.
  console.log(`   OK: recorrió ${distanciaConjunto.toFixed(2)} casillas conduciendo vs ${distanciaAPie.toFixed(2)} a pie desde el mismo punto`);

  console.log("9) conjunto:desmontar — se para en el sitio, nadie lleva las riendas...");
  room.send("conjunto:desmontar");
  await new Promise((r) => setTimeout(r, 400));
  jugador = room.state.players.get(room.sessionId);
  if (jugador.conjuntoId !== 0 || jugador.conjuntoConductor !== false) throw new Error("FALLO: Player.conjuntoId/conjuntoConductor no se limpiaron al desmontar");
  if (conjuntoEsquema.conductorSessionId !== "") throw new Error("FALLO: conductorSessionId del Schema debería quedar vacío tras desmontar");
  if (room.state.conjuntosTiro.size !== 1) throw new Error("FALLO: el conjunto NO debería desaparecer al desmontar (sigue aparcado, solo sin conductor)");
  const xParado = conjuntoEsquema.x, yParado = conjuntoEsquema.y;
  await new Promise((r) => setTimeout(r, 300));
  if (Math.hypot(conjuntoEsquema.x - xParado, conjuntoEsquema.y - yParado) > 0.01) throw new Error("FALLO: el conjunto se siguió moviendo sin conductor");
  console.log("   OK: sin conductor, el conjunto queda quieto y visible");

  console.log("10) carro:desenganchar — separa de vuelta (nadie a bordo)...");
  room.send("carro:desenganchar", { conjuntoId: enganchado.conjuntoId });
  const desenganchado = await esperarMensaje(room, "carro:desenganchado");
  await new Promise((r) => setTimeout(r, 300));
  if (room.state.conjuntosTiro.size !== 0) throw new Error("FALLO: el conjunto debería haber desaparecido al desenganchar");
  if (room.state.carros.size !== 1 || [...room.state.carros.values()][0].tipoId !== "carreta_dos_plazas") {
    throw new Error(`FALLO: la carreta no reapareció aparcada, llegó ${JSON.stringify([...room.state.carros.values()])}`);
  }
  mascotas = [...room.state.mascotas.values()];
  if (mascotas.length !== 1 || mascotas[0].especieId !== "buey" || mascotas[0].arnes !== true) {
    throw new Error(`FALLO: el buey no reapareció siguiendo con arnes:true, llegó ${JSON.stringify(mascotas.map((m) => ({ especieId: m.especieId, arnes: m.arnes })))}`);
  }
  console.log(`   OK: carro:desenganchado (carroId=${desenganchado.carroId}) — carreta aparcada de nuevo, buey siguiendo con su arnés intacto`);

  await room.leave();
  console.log("\n=== E2E carros: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E carros: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
