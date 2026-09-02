// E2E de aperos de labranza montados (docs/GDD_Carros.md §9.3, Fase 3b,
// pedido 2026-09-03) contra el servidor REAL, sobre assets/mapas/testflat/
// (parcela real "tf_0001", mismo mapa que cultivoCasilla.e2e.mjs).
// DIA_FORZADO=60 fija mes=3 (semilla_trigo se siembra en [3,4,5]) para que
// la prueba sea determinista, igual que en cultivoCasilla.e2e.mjs.
//   1. arado_madera enganchado al buey + apero:comenzarLabrar: labra la
//      casilla de partida DE INMEDIATO (sin esperar a moverse) y sigue
//      labrando cada casilla nueva mientras el conjunto avanza.
//   2. apero:detener corta el modo automático.
//   3. cultivadora_semillas con semillas cargadas (carro:meterCarga) +
//      apero:comenzarCultivar: siembra las casillas YA labradas en un
//      radio de 2, consumiendo las semillas cargadas.
//   node server/test/apero.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "apero_e2e.sqlite");
const PUERTO = 2606;
const NOMBRE = "E2E-Apero";
const DIA = 60; // diaDelAnio=60 -> mes=3 (diasPorMes=30), coincide con semilla_trigo [3,4,5]

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador dueño de tf_0001 + buey arnesado 'siguiendo')...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS propiedades (
      id TEXT PRIMARY KEY, tipo TEXT NOT NULL, asentamiento TEXT NOT NULL, dueno INTEGER, asignada_en TEXT,
      modo_tenencia TEXT, precio_farycoins INTEGER, periodo_horas INTEGER, expira_en TEXT,
      impuesto_activo INTEGER NOT NULL DEFAULT 0, impuesto_farycoins INTEGER, impuesto_periodo_horas INTEGER, impuesto_ultimo_cobro TEXT
    );
    CREATE TABLE IF NOT EXISTS casillas_cultivo (
      mapa_id TEXT NOT NULL, idx_casilla INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      dueno_id INTEGER NOT NULL, estado TEXT NOT NULL, semilla_id TEXT, dia_plantado INTEGER,
      PRIMARY KEY (mapa_id, idx_casilla)
    );
    CREATE TABLE IF NOT EXISTS mascotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, especie_id TEXT NOT NULL,
      ubicacion TEXT NOT NULL DEFAULT 'siguiendo', propiedad_id TEXT, creado_en TEXT NOT NULL,
      montura INTEGER NOT NULL DEFAULT 0, arnes INTEGER NOT NULL DEFAULT 0, arnes_peso_maximo REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS carros (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, tipo_id TEXT NOT NULL, mapa_id TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, creado_en TEXT NOT NULL, contenido TEXT
    );
    CREATE TABLE IF NOT EXISTS conjuntos_tiro (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jugador_id INTEGER NOT NULL, mascota_id INTEGER NOT NULL,
      especie_animal_id TEXT NOT NULL, carro_tipo_id TEXT NOT NULL, mapa_id TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, creado_en TEXT NOT NULL, contenido TEXT
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno) VALUES ('tf_0001', 'parcela', 'testflat', 1)").run();
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (1, 'buey', 'siguiendo', NULL, ?, 0, 1, 400)").run(new Date().toISOString());
  bd.close();
}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  p.stderr.on("data", (d) => process.stdout.write(`[srv:err] ${d}`));
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
const darItem = async (room, itemId, cantidad = 1) => {
  room.send("admin:debug:darItem", { itemId, cantidad });
  await esperarMensaje(room, "admin:debug:ok");
};

const rutaTestflat = join(raiz, "assets", "mapas", "testflat");

let fallo = null;
try {
  console.log("2) arrancando servidor real (DIA_FORZADO=60 -> mes=3, JARL_NOMBRES para darItem/teleport)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestflat, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE, DIA_FORZADO: String(DIA) });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));

  const labradas = [];
  room.onMessage("cultivoCasilla:labrada", (m) => labradas.push(m));
  const plantadas = [];
  room.onMessage("cultivoCasilla:plantada", (m) => plantadas.push(m));
  const erroresApero = [];
  room.onMessage("apero:error", (m) => erroresApero.push(m));
  const erroresCarro = [];
  room.onMessage("carro:error", (m) => erroresCarro.push(m));

  console.log("3) teletransportarse a (26.5,10.5) — dentro de tf_0001, libre de muebles...");
  room.send("admin:debug:teleport", { x: 26.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));

  console.log("4) arado_madera: colocar + enganchar (buey) + montar...");
  await darItem(room, "arado_madera");
  room.send("carro:colocar", { itemId: "arado_madera" });
  await esperarMensaje(room, "carro:colocado");
  room.send("carro:enganchar", {});
  const enganchadoArado = await esperarMensaje(room, "carro:enganchado");
  room.send("conjunto:montar", {});
  await new Promise((r) => setTimeout(r, 300));
  let jugador = room.state.players.get(room.sessionId);
  if (!jugador.conjuntoConductor) throw new Error("FALLO: no se fusionó como conductor del arado");
  console.log(`   OK: conjunto ${enganchadoArado.conjuntoId} (buey + arado_madera) enganchado y montado`);

  console.log("5) apero:comenzarLabrar — labra la casilla de partida DE INMEDIATO, sin moverse...");
  room.send("apero:comenzarLabrar", { conjuntoId: enganchadoArado.conjuntoId });
  await esperarMensaje(room, "apero:comenzado");
  await new Promise((r) => setTimeout(r, 400));
  if (erroresApero.length > 0) throw new Error(`FALLO: apero:comenzarLabrar rechazado, ${JSON.stringify(erroresApero)}`);
  if (labradas.length < 1) throw new Error("FALLO: no se labró la casilla de partida sin moverse");
  console.log(`   OK: ${labradas.length} casilla(s) labrada(s) de inmediato al activar el arado`);

  console.log("6) avanzando hacia el este con el arado activo — debe labrar cada casilla nueva...");
  room.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 4000));
  room.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 300));
  if (labradas.length < 2) throw new Error(`FALLO: esperaba labrar más de 1 casilla al desplazarse, llegaron ${labradas.length}: ${JSON.stringify(labradas)}`);
  const xs = labradas.map((l) => l.x);
  if (new Set(xs).size !== labradas.length) throw new Error(`FALLO: hay casillas labradas repetidas (no debería reprocesar la misma), llegó ${JSON.stringify(labradas)}`);
  console.log(`   OK: ${labradas.length} casillas labradas en el camino (x=${xs.join(",")}), todas distintas`);

  console.log("7) apero:detener...");
  room.send("apero:detener", { conjuntoId: enganchadoArado.conjuntoId });
  await esperarMensaje(room, "apero:detenido");
  console.log("   OK: apero:detenido");

  console.log("8) desmontar + desenganchar el arado (el buey vuelve a 'siguiendo')...");
  room.send("conjunto:desmontar");
  await new Promise((r) => setTimeout(r, 300));
  room.send("carro:desenganchar", { conjuntoId: enganchadoArado.conjuntoId });
  await esperarMensaje(room, "carro:desenganchado");
  console.log("   OK: arado desenganchado");

  const centroX = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  console.log(`9) cultivadora_semillas: colocar cerca del centro de la franja labrada (x=${centroX}) + enganchar + cargar semillas...`);
  room.send("admin:debug:teleport", { x: centroX + 0.5, y: 10.5 });
  await new Promise((r) => setTimeout(r, 300));
  await darItem(room, "cultivadora_semillas");
  room.send("carro:colocar", { itemId: "cultivadora_semillas" });
  const colocadaCultivadora = await esperarMensaje(room, "carro:colocado");
  room.send("carro:enganchar", { carroId: colocadaCultivadora.carroId });
  const enganchadaCultivadora = await esperarMensaje(room, "carro:enganchado");

  await darItem(room, "semilla_trigo", 5);
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const itSemilla = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "semilla_trigo");
  if (!itSemilla) throw new Error("FALLO: no se encontró semilla_trigo en el inventario tras darItem");
  room.send("carro:meterCarga", { id: enganchadaCultivadora.conjuntoId, tipo: "conjunto", instanciaId: itSemilla.id });
  const cargaCultivadora = await esperarMensaje(room, "carro:estadoCarga");
  if (cargaCultivadora.items.length !== 1 || cargaCultivadora.items[0].cantidad !== 5) {
    throw new Error(`FALLO: la cultivadora no cargó las 5 semillas, llegó ${JSON.stringify(cargaCultivadora.items)}`);
  }
  console.log("   OK: 5x semilla_trigo cargadas en el semillero de la cultivadora (carro:meterCarga)");

  console.log("10) montar + apero:comenzarCultivar — siembra las casillas YA labradas en radio 2...");
  room.send("conjunto:montar", {});
  await new Promise((r) => setTimeout(r, 300));
  room.send("apero:comenzarCultivar", { conjuntoId: enganchadaCultivadora.conjuntoId });
  await esperarMensaje(room, "apero:comenzado");
  await new Promise((r) => setTimeout(r, 500));
  if (erroresApero.length > 0) throw new Error(`FALLO: apero:comenzarCultivar rechazado, ${JSON.stringify(erroresApero)}`);
  if (plantadas.length < 1) throw new Error(`FALLO: la cultivadora no sembró ninguna casilla, labradas=${JSON.stringify(labradas)}`);
  if (plantadas.some((p) => p.semillaId !== "semilla_trigo")) throw new Error(`FALLO: sembró con una semilla incorrecta, llegó ${JSON.stringify(plantadas)}`);
  console.log(`   OK: ${plantadas.length} casilla(s) sembrada(s) automáticamente por la cultivadora (x=${plantadas.map((p) => p.x).join(",")})`);

  console.log("11) intentar plantar OTRA VEZ una casilla ya sembrada por la cultivadora se rechaza (ya_sembrada)...");
  const erroresCultivo = [];
  room.onMessage("cultivoCasilla:error", (m) => erroresCultivo.push(m));
  const primeraSembrada = plantadas[0];
  await darItem(room, "semilla_trigo", 1);
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const itSemilla2 = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "semilla_trigo");
  room.send("cultivoCasilla:plantar", { x: primeraSembrada.x + 0.5, y: primeraSembrada.y + 0.5, instanciaIdSemilla: itSemilla2.id });
  await new Promise((r) => setTimeout(r, 300));
  if (!erroresCultivo.some((e) => e.motivo === "ya_sembrada")) throw new Error(`FALLO: esperaba ya_sembrada, llegó ${JSON.stringify(erroresCultivo)}`);
  console.log("   OK: la casilla sembrada por la cultivadora es real (persistida), no solo un evento cosmético");

  room.send("apero:detener", { conjuntoId: enganchadaCultivadora.conjuntoId });
  await esperarMensaje(room, "apero:detenido");

  await room.leave();
  console.log("\n=== E2E aperos de labranza: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E aperos de labranza: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
