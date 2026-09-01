// E2E de la carga de carros (docs/GDD_Carros.md §8, Fase 2, pedido
// 2026-09-03) contra el servidor REAL — mismo patrón que carros.e2e.mjs:
// admin:debug:darItem (JARL_NOMBRES) para saltarse el crafteo, ejercita las
// 4 categorías de carga sobre carros APARCADOS (funciona igual enganchados,
// entidadCarroCercana resuelve ambos) más UN ciclo enganchar/desenganchar
// para probar que la carga es del CARRO, no del animal (sobrevive intacta).
//   node server/test/carrosCarga.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "carrosCarga_e2e.sqlite");
const PUERTO = 2603;
const NOMBRE = "E2E-CarroCarga";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador + buey con arnés + gato 'siguiendo')...");
{
  const bd = new DatabaseSync(rutaBd);
  bd.exec(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, creado_en TEXT NOT NULL,
      farycoins INTEGER NOT NULL DEFAULT 0, vida INTEGER NOT NULL DEFAULT 100, vida_max INTEGER NOT NULL DEFAULT 100
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
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (1, 'buey', 'siguiendo', NULL, ?, 0, 1, 400)").run(new Date().toISOString());
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo) VALUES (1, 'gato', 'siguiendo', NULL, ?, 0, 0, 0)").run(new Date().toISOString());
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
const darItem = async (room, itemId, cantidad = 1) => {
  room.send("admin:debug:darItem", { itemId, cantidad });
  await esperarMensaje(room, "admin:debug:ok");
};

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real (JARL_NOMBRES para admin:debug:darItem)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  const erroresCarro = [];
  room.onMessage("carro:error", (m) => erroresCarro.push(m));

  // --- 8.2 Materiales (rejilla) ---
  console.log("3) carro_materiales_pequeno: colocar + meterCarga + sacarCarga...");
  await darItem(room, "carro_materiales_pequeno");
  room.send("carro:colocar", { itemId: "carro_materiales_pequeno" });
  const colocadoMat = await esperarMensaje(room, "carro:colocado");
  room.send("carro:consultarCarga", { id: colocadoMat.carroId, tipo: "carro" });
  const vacio = await esperarMensaje(room, "carro:estadoCarga");
  if (vacio.ancho !== 10 || vacio.alto !== 6 || vacio.items.length !== 0) {
    throw new Error(`FALLO: capacidad inicial incorrecta, llegó ${JSON.stringify(vacio)}`);
  }
  console.log("   OK: rejilla vacía 10x6 (capacidadContenedor del catálogo)");

  await darItem(room, "madera_blanda", 5);
  // Localizamos la instancia recién dada en el inventario del jugador.
  await new Promise((r) => setTimeout(r, 300));
  let jugador = room.state.players.get(room.sessionId);
  let itMadera = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "madera_blanda");
  if (!itMadera) throw new Error("FALLO: no se encontró madera_blanda en el inventario tras darItem");
  room.send("carro:meterCarga", { id: colocadoMat.carroId, tipo: "carro", instanciaId: itMadera.id });
  const conCarga = await esperarMensaje(room, "carro:estadoCarga");
  if (conCarga.items.length !== 1 || conCarga.items[0].itemId !== "madera_blanda") {
    throw new Error(`FALLO: la madera no quedó en la rejilla del carro, llegó ${JSON.stringify(conCarga.items)}`);
  }
  console.log("   OK: carro:meterCarga movió la madera del cuerpo del jugador a la rejilla del carro");

  room.send("carro:sacarCarga", { id: colocadoMat.carroId, tipo: "carro", instanciaId: conCarga.items[0].id });
  const trasSacar = await esperarMensaje(room, "carro:estadoCarga");
  if (trasSacar.items.length !== 0) throw new Error("FALLO: la rejilla debería quedar vacía tras sacarCarga");
  console.log("   OK: carro:sacarCarga la devolvió al inventario del jugador");

  // --- 8.3 Muebles (capacidad, no rejilla) ---
  console.log("4) carro_muebles_pequeno: colocar + meterMueble + sacarMueble (silla, tamanoTransporte=1)...");
  await darItem(room, "carro_muebles_pequeno");
  room.send("carro:colocar", { itemId: "carro_muebles_pequeno" });
  const colocadoMuebles = await esperarMensaje(room, "carro:colocado");
  await darItem(room, "silla", 1);
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const itSilla = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "silla");
  if (!itSilla) throw new Error("FALLO: no se encontró silla en el inventario tras darItem");
  room.send("carro:meterMueble", { id: colocadoMuebles.carroId, tipo: "carro", instanciaId: itSilla.id });
  const conMueble = await esperarMensaje(room, "carro:estadoMuebles");
  if (conMueble.capacidadMax !== 20 || conMueble.muebles.length !== 1 || conMueble.muebles[0].tamano !== 1) {
    throw new Error(`FALLO: la silla no quedó bien registrada en el carro, llegó ${JSON.stringify(conMueble)}`);
  }
  console.log("   OK: carro:meterMueble consumió la silla del inventario y la registró (tamano=1, capacidadMax=20)");

  room.send("carro:sacarMueble", { id: colocadoMuebles.carroId, tipo: "carro", instanciaId: conMueble.muebles[0].instanciaId });
  const trasSacarMueble = await esperarMensaje(room, "carro:estadoMuebles");
  if (trasSacarMueble.muebles.length !== 0) throw new Error("FALLO: el carro de muebles debería quedar vacío tras sacarMueble");
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  if (![...jugador.inventario.cuerpo.items.values()].some((i) => i.itemId === "silla")) {
    throw new Error("FALLO: la silla no volvió al inventario del jugador tras sacarMueble");
  }
  console.log("   OK: carro:sacarMueble devolvió la silla al inventario");

  // --- 8.4 Animales (jaula) ---
  console.log("5) carro_jaula: colocar + meterAnimal(gato) + sacarAnimal...");
  await darItem(room, "carro_jaula");
  room.send("carro:colocar", { itemId: "carro_jaula" });
  const colocadoJaula = await esperarMensaje(room, "carro:colocado");
  await new Promise((r) => setTimeout(r, 300));
  const gatoEntry = [...room.state.mascotas.entries()].find(([, m]) => m.especieId === "gato");
  if (!gatoEntry) throw new Error("FALLO: el gato sembrado no apareció siguiendo");
  const gatoId = Number(gatoEntry[0]);
  // mascotaId EXPLÍCITO (no auto-apuntado): el buey con arnés también está "siguiendo" a esta altura del test, no queremos enjaularlo por error.
  room.send("carro:meterAnimal", { id: colocadoJaula.carroId, tipo: "carro", mascotaId: gatoId });
  const conJaula = await esperarMensaje(room, "carro:estadoJaula");
  if (conJaula.jaula.length !== 1) throw new Error(`FALLO: la jaula debería tener 1 animal, llegó ${JSON.stringify(conJaula)}`);
  await new Promise((r) => setTimeout(r, 300));
  if ([...room.state.mascotas.values()].some((m) => m.especieId === "gato")) {
    throw new Error("FALLO: el gato debería haber desaparecido de state.mascotas al enjaularlo");
  }
  console.log("   OK: carro:meterAnimal sacó al gato de state.mascotas y lo metió en la jaula");

  room.send("carro:sacarAnimal", { id: colocadoJaula.carroId, tipo: "carro", mascotaId: conJaula.jaula[0] });
  const trasSacarAnimal = await esperarMensaje(room, "carro:estadoJaula");
  if (trasSacarAnimal.jaula.length !== 0) throw new Error("FALLO: la jaula debería quedar vacía tras sacarAnimal");
  await new Promise((r) => setTimeout(r, 300));
  if (![...room.state.mascotas.values()].some((m) => m.especieId === "gato")) {
    throw new Error("FALLO: el gato no reapareció siguiendo tras sacarAnimal");
  }
  console.log("   OK: carro:sacarAnimal devolvió al gato a 'siguiendo'");

  // --- 8.5 Líquidos (cisterna) ---
  console.log("6) cisterna_pequena: colocar junto al spawn (agua a 1 casilla) + conectarManguera + verterLiquido...");
  await darItem(room, "cisterna_pequena");
  room.send("carro:colocar", { itemId: "cisterna_pequena" });
  const colocadaCisterna = await esperarMensaje(room, "carro:colocado");

  await darItem(room, "cubo_madera", 1);
  await new Promise((r) => setTimeout(r, 300));
  jugador = room.state.players.get(room.sessionId);
  const itCubo = [...jugador.inventario.cuerpo.items.values()].find((i) => i.itemId === "cubo_madera");
  if (!itCubo) throw new Error("FALLO: no se encontró cubo_madera en el inventario tras darItem");

  room.send("carro:verterLiquido", { id: colocadaCisterna.carroId, tipo: "carro", instanciaIdDestino: itCubo.id });
  await new Promise((r) => setTimeout(r, 400));
  if (!erroresCarro.some((e) => e.motivo === "cisterna_vacia")) {
    throw new Error(`FALLO: verterLiquido sobre una cisterna recién colocada (vacía) debería rechazarse con cisterna_vacia, errores: ${JSON.stringify(erroresCarro)}`);
  }
  console.log("   OK: verterLiquido rechaza una cisterna vacía (todavía sin conectarManguera)");

  room.send("carro:conectarManguera", { id: colocadaCisterna.carroId, tipo: "carro" });
  const manguera = await esperarMensaje(room, "carro:manguera");
  if (!manguera.conectada || manguera.liquido?.tipo !== "agua" || manguera.liquido?.volumenMl !== 20000) {
    throw new Error(`FALLO: conectarManguera no llenó la cisterna a su tope, llegó ${JSON.stringify(manguera)}`);
  }
  console.log("   OK: carro:conectarManguera llenó la cisterna entera (20000 ml) desde el agua junto al spawn");

  room.send("carro:verterLiquido", { id: colocadaCisterna.carroId, tipo: "carro", instanciaIdDestino: itCubo.id });
  const vertido = await esperarMensaje(room, "carro:vertido");
  if (vertido.volumenMl !== 2000) throw new Error(`FALLO: debería verter exactamente el tope del cubo (2000ml), llegó ${vertido.volumenMl}`);
  console.log(`   OK: carro:verterLiquido transfirió ${vertido.volumenMl}ml al cubo, cisterna con ${vertido.liquido.volumenMl}ml restantes`);

  room.send("carro:desconectarManguera", { id: colocadaCisterna.carroId, tipo: "carro" });
  const desconectada = await esperarMensaje(room, "carro:manguera");
  if (desconectada.conectada) throw new Error("FALLO: desconectarManguera debería reportar conectada:false");
  console.log("   OK: carro:desconectarManguera confirma la desconexión (sin efecto de datos, pedido literal)");

  // --- La carga es del CARRO, no del animal: sobrevive a enganchar/desenganchar SIN mutarla ---
  console.log("7) enganchar la cisterna (con 18000ml dentro) al buey ya arnesado (seed) y desenganchar — el volumen exacto debe sobrevivir intacto...");
  room.send("carro:enganchar", { carroId: colocadaCisterna.carroId });
  const enganchada = await esperarMensaje(room, "carro:enganchado");
  room.send("carro:consultarLiquido", { id: enganchada.conjuntoId, tipo: "conjunto" });
  const liquidoEnganchado = await esperarMensaje(room, "carro:estadoLiquido");
  if (liquidoEnganchado.liquido?.volumenMl !== 18000 || liquidoEnganchado.liquido?.tipo !== "agua") {
    throw new Error(`FALLO: al enganchar se perdió/alteró el volumen exacto (18000ml esperados), llegó ${JSON.stringify(liquidoEnganchado)}`);
  }
  console.log("   OK: enganchar preserva el volumen EXACTO (18000ml) sin rellenar de más — carro:consultarLiquido no muta nada");

  room.send("carro:desenganchar", { conjuntoId: enganchada.conjuntoId });
  const desenganchada = await esperarMensaje(room, "carro:desenganchado");
  room.send("carro:consultarLiquido", { id: desenganchada.carroId, tipo: "carro" });
  const liquidoAparcado = await esperarMensaje(room, "carro:estadoLiquido");
  if (liquidoAparcado.liquido?.volumenMl !== 18000 || liquidoAparcado.liquido?.tipo !== "agua") {
    throw new Error(`FALLO: al desenganchar se perdió/alteró el volumen exacto, llegó ${JSON.stringify(liquidoAparcado)}`);
  }
  console.log("   OK: tras desenganchar, sigue con los mismos 18000ml aparcada — la carga (categoría + volumen) es del carro, no del animal");

  await room.leave();
  console.log("\n=== E2E carga de carros: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E carga de carros: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
