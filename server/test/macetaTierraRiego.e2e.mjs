// docs/GDD_Agricultura.md §9 (2026-09-11, pedido streamer: "las macetas se
// tienen que llenar con tierra (la pala en el suelo click, sacar tierra)...
// necesita regarse (cubo o regadera, llenar agua y click sobre planta, regar)")
// — protocolo puro con colyseus.js sobre testflat, sin navegador:
//   1) una maceta vacía NO se puede sembrar ("falta tierra");
//   2) cavar exige la pala EQUIPADA, da 1 tierra por casilla y la misma
//      casilla no se puede volver a cavar hasta pasados unos días;
//   3) meter tierra la llena unidad a unidad (y no admite de más);
//   4) regar gasta 500ml de un recipiente con agua y sin agua se rechaza;
//   5) llenar el recipiente lejos del agua se rechaza;
//   6) la jardinera nueva exige su ítem crafteado y pide 2 de tierra.
// Uso: node test/macetaTierraRiego.e2e.mjs   (desde server/)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "macetaTierraRiego_e2e.sqlite");
const rutaTestflat = join(raiz, "assets", "mapas", "testflat");
const PUERTO = 2631;
const NOMBRE = "E2E-Maceta";
// Fuera de la Test Zone Norte que el servidor SIEMBRA (x:28-34 y:12-18) y dentro de tf_0001 — mismas casillas que mueblesCarpintero.e2e.mjs
const REUNION = { x: 36.5, y: 20.5 };
const MACETA_XY = { x: 36, y: 19 };
const JARDINERA_XY = { x: 35, y: 21 };
const CASILLA_CAVAR = { x: 37.5, y: 21.5 };

for (const f of [rutaBd, rutaBd + "-wal", rutaBd + "-shm"]) { try { unlinkSync(f); } catch {} }

// El cubo ya lleva EXACTAMENTE un riego de agua (500ml): el primer riego lo
// vacía y el segundo tiene que fallar por "sin agua". No hay ninguna casilla
// de agua en testflat, así que el llenado real (recipiente:llenar) solo se
// puede comprobar por su rechazo — la mecánica de llenar ya existía y tiene
// su propio criterio (junto al agua), aquí solo importa que regar la consuma.
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
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en, farycoins) VALUES (1, ?, ?, 0)").run(NOMBRE, new Date().toISOString());
  const items = JSON.stringify([
    { id: 1, itemId: "cubo_madera", cantidad: 1, x: 0, y: 0, rot: 0, liquido: { tipo: "agua", volumenMl: 500 } },
  ]);
  bd.prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (1, 'cuerpo', 8, 6, 2, ?)").run(items);
  bd.close();
}

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => { const t = String(d); if (/error|Error/.test(t)) process.stdout.write("[srv] " + t); });
  p.stderr.on("data", (d) => process.stdout.write("[srv] " + String(d)));
  procesos.push(p);
  return p;
}
function matarTodo() { for (const p of procesos) { try { process.kill(-p.pid, "SIGTERM"); } catch {} } }
async function esperarPuerto(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout esperando " + url);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarHasta(fn, ms = 4000, paso = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await esperar(paso); }
  return fn();
}
function siguiente(room, tipos, ms = 3000) {
  return new Promise((resolve) => {
    const offs = tipos.map((tipo) => room.onMessage(tipo, (m) => { offs.forEach((o) => o()); resolve({ tipo, m }); }));
    setTimeout(() => { offs.forEach((o) => o()); resolve({ tipo: "timeout" }); }, ms);
  });
}
let pasadas = 0, fallidas = 0;
function comprobar(nombre, ok, detalle = "") {
  if (ok) { pasadas++; console.log(`  ✔ ${nombre}`); } else { fallidas++; console.log(`  ✘ ${nombre}${detalle ? " — " + detalle : ""}`); }
}
const itemDe = (room, itemId) => [...room.state.players.get(room.sessionId).inventario.cuerpo.items].find((it) => it.itemId === itemId);
const cantidadDe = (room, itemId) => [...room.state.players.get(room.sessionId).inventario.cuerpo.items].filter((it) => it.itemId === itemId).reduce((s, it) => s + it.cantidad, 0);
/** Manda un mensaje y espera la PRIMERA respuesta de los tipos dados. */
async function pedir(room, tipo, msg, respuestas, ms = 3000) {
  const p = siguiente(room, respuestas, ms);
  room.send(tipo, msg);
  return p;
}

let fallo = null;
try {
  console.log("1) servidor real sobre testflat, día 60 (mes 3: semilla_trigo se siembra) — el jugador es jarl y ya lleva un cubo con 500ml de agua...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestflat, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRE, DIA_FORZADO: "60" });
  await esperarPuerto(`http://localhost:${PUERTO}/`);
  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const A = await cliente.joinOrCreate("hub", { name: NOMBRE });
  await esperar(500);
  A.send("admin:debug:teleport", REUNION);
  const cerca = await esperarHasta(() => { const yo = A.state.players.get(A.sessionId); return yo && Math.hypot(yo.x - REUNION.x, yo.y - REUNION.y) < 1.5; }, 6000, 100);
  if (!cerca) throw new Error("el jugador no llegó al punto de reunión");
  comprobar("el cubo sembrado en BD llega replicado con sus 500ml de agua", itemDe(A, "cubo_madera")?.liquidoTipo === "agua" && itemDe(A, "cubo_madera")?.liquidoVolumenMl === 500, JSON.stringify(itemDe(A, "cubo_madera")));

  console.log("2) maceta vacía: se coloca gratis, pero NO se puede sembrar sin tierra...");
  const rMaceta = await pedir(A, "construir", { objeto: "maceta_pequena", categoria: "exterior", x: MACETA_XY.x, y: MACETA_XY.y, rot: 0, variante: 0 }, ["construccion:nueva", "construir:error"]);
  comprobar("la maceta de barro se coloca (sigue sin exigir ítem)", rMaceta.tipo === "construccion:nueva" && rMaceta.m.objeto === "maceta_pequena", JSON.stringify(rMaceta));
  const macetaId = rMaceta.m?.id;
  const estado0 = await pedir(A, "cultivo:consultar", { construccionId: macetaId }, ["cultivo:estado"]);
  comprobar("cultivo:estado informa tierra 0/1 en la maceta recién colocada", estado0.tipo === "cultivo:estado" && estado0.m.tierra === 0 && estado0.m.tierraNecesaria === 1, JSON.stringify(estado0.m));
  A.send("admin:debug:darItem", { itemId: "semilla_trigo", cantidad: 1 });
  await esperarHasta(() => itemDe(A, "semilla_trigo"), 4000);
  const semilla = itemDe(A, "semilla_trigo");
  const rSinTierra = await pedir(A, "cultivo:plantar", { construccionId: macetaId, instanciaId: semilla.id }, ["cultivo:error", "cultivo:estado"]);
  comprobar("plantar en la maceta vacía se rechaza con 'falta tierra'", rSinTierra.tipo === "cultivo:error" && /falta tierra/.test(rSinTierra.m?.motivo ?? ""), JSON.stringify(rSinTierra));

  console.log("3) cavar tierra: sin pala se rechaza; con la pala EQUIPADA da 1 tierra por casilla; la misma casilla no se repite...");
  const rSinPala = await pedir(A, "suelo:cavar", CASILLA_CAVAR, ["suelo:error", "suelo:cavado"]);
  comprobar("cavar sin pala se rechaza", rSinPala.tipo === "suelo:error" && /pala/.test(rSinPala.m?.motivo ?? ""), JSON.stringify(rSinPala));
  A.send("admin:debug:darItem", { itemId: "pala", cantidad: 1 });
  await esperarHasta(() => itemDe(A, "pala"), 4000);
  const rSinEquipar = await pedir(A, "suelo:cavar", CASILLA_CAVAR, ["suelo:error", "suelo:cavado"]);
  comprobar("con la pala en la mochila pero sin equipar también se rechaza", rSinEquipar.tipo === "suelo:error" && /pala/.test(rSinEquipar.m?.motivo ?? ""), JSON.stringify(rSinEquipar));
  A.send("equipo:equipar", { instanciaId: itemDe(A, "pala").id, slot: "manoPrincipal" });
  const equipada = await esperarHasta(() => A.state.players.get(A.sessionId).inventario.equipo.get("manoPrincipal") === "pala", 4000);
  comprobar("la pala se equipa en la mano principal", !!equipada);
  const rCavar = await pedir(A, "suelo:cavar", CASILLA_CAVAR, ["suelo:error", "suelo:cavado"]);
  comprobar("cavar con la pala equipada responde suelo:cavado", rCavar.tipo === "suelo:cavado", JSON.stringify(rCavar));
  const tierra1 = await esperarHasta(() => cantidadDe(A, "tierra") === 1, 4000);
  comprobar("aparece 1 de tierra en la mochila", !!tierra1, `tierra=${cantidadDe(A, "tierra")}`);
  const rRepetir = await pedir(A, "suelo:cavar", CASILLA_CAVAR, ["suelo:error", "suelo:cavado"]);
  comprobar("la misma casilla no vuelve a dar tierra (se asienta unos días)", rRepetir.tipo === "suelo:error" && /cavada/.test(rRepetir.m?.motivo ?? ""), JSON.stringify(rRepetir));
  const rBajoMaceta = await pedir(A, "suelo:cavar", { x: MACETA_XY.x + 0.5, y: MACETA_XY.y + 0.5 }, ["suelo:error", "suelo:cavado"]);
  comprobar("no se cava debajo de una construcción", rBajoMaceta.tipo === "suelo:error" && /construcción/.test(rBajoMaceta.m?.motivo ?? ""), JSON.stringify(rBajoMaceta));
  // (37.5,20.5): a 1 casilla del jugador — (38.5,21.5) caería a 2.24 > RADIO_INTERACCION y el rechazo sería por distancia, no por casilla
  const rOtra = await pedir(A, "suelo:cavar", { x: CASILLA_CAVAR.x, y: CASILLA_CAVAR.y - 1 }, ["suelo:error", "suelo:cavado"]);
  comprobar("la casilla de al lado sí da otra palada", rOtra.tipo === "suelo:cavado" && !!(await esperarHasta(() => cantidadDe(A, "tierra") === 2, 4000)), `tierra=${cantidadDe(A, "tierra")}`);

  console.log("4) meter tierra llena la maceta unidad a unidad, y con ella ya se puede sembrar...");
  const rMeter = await pedir(A, "cultivo:meterTierra", { construccionId: macetaId }, ["cultivo:estado", "cultivo:error"]);
  comprobar("meterTierra → cultivo:estado con tierra 1/1 y consume 1 tierra", rMeter.tipo === "cultivo:estado" && rMeter.m.tierra === 1 && !!(await esperarHasta(() => cantidadDe(A, "tierra") === 1, 4000)), JSON.stringify(rMeter));
  const rDeMas = await pedir(A, "cultivo:meterTierra", { construccionId: macetaId }, ["cultivo:estado", "cultivo:error"]);
  comprobar("una maceta llena no admite más tierra", rDeMas.tipo === "cultivo:error" && /llena/.test(rDeMas.m?.motivo ?? ""), JSON.stringify(rDeMas));
  const rPlantar = await pedir(A, "cultivo:plantar", { construccionId: macetaId, instanciaId: semilla.id }, ["cultivo:error", "cultivo:estado"]);
  comprobar("ahora sí se siembra el trigo en la maceta", rPlantar.tipo === "cultivo:estado" && rPlantar.m.semillaId === "semilla_trigo" && rPlantar.m.tierra === 1, JSON.stringify(rPlantar));

  console.log("5) regar gasta 500ml del cubo; sin agua se rechaza; llenar lejos del agua se rechaza...");
  const rRegar = await pedir(A, "cultivo:regar", { construccionId: macetaId }, ["cultivo:estado", "cultivo:error"]);
  comprobar("regar con el cubo lleno responde cultivo:estado con agua 100", rRegar.tipo === "cultivo:estado" && rRegar.m.agua >= 99, JSON.stringify(rRegar));
  const vacio = await esperarHasta(() => (itemDe(A, "cubo_madera")?.liquidoVolumenMl ?? -1) === 0 || !itemDe(A, "cubo_madera")?.liquidoTipo, 4000);
  comprobar("el cubo queda vacío (500ml − 500ml del riego)", !!vacio, JSON.stringify(itemDe(A, "cubo_madera")));
  const rSinAgua = await pedir(A, "cultivo:regar", { construccionId: macetaId }, ["cultivo:estado", "cultivo:error"]);
  comprobar("regar sin agua se rechaza pidiendo cubo o regadera con agua", rSinAgua.tipo === "cultivo:error" && /cubo o una regadera/.test(rSinAgua.m?.motivo ?? ""), JSON.stringify(rSinAgua));
  const rLlenar = await pedir(A, "recipiente:llenar", { instanciaId: itemDe(A, "cubo_madera").id }, ["recipiente:llenado", "recipiente:error"]);
  comprobar("llenar el cubo sin agua cerca se rechaza (hay que ir a un río/lago)", rLlenar.tipo === "recipiente:error" && /agua/.test(rLlenar.m?.motivo ?? ""), JSON.stringify(rLlenar));

  console.log("6) la jardinera nueva exige su ítem (carpintero) y pide 2 de tierra...");
  const rSinItem = await pedir(A, "construir", { objeto: "jardinera_madera", categoria: "exterior", x: JARDINERA_XY.x, y: JARDINERA_XY.y, rot: 0, variante: 0 }, ["construccion:nueva", "construir:error"]);
  comprobar("sin el ítem crafteado la jardinera no se coloca", rSinItem.tipo === "construir:error" && /jardinera_madera/.test(rSinItem.m?.motivo ?? ""), JSON.stringify(rSinItem));
  A.send("admin:debug:darItem", { itemId: "jardinera_madera", cantidad: 1 });
  await esperarHasta(() => itemDe(A, "jardinera_madera"), 4000);
  const rJardinera = await pedir(A, "construir", { objeto: "jardinera_madera", categoria: "exterior", x: JARDINERA_XY.x, y: JARDINERA_XY.y, rot: 0, variante: 0 }, ["construccion:nueva", "construir:error"]);
  comprobar("con el ítem se coloca y lo consume", rJardinera.tipo === "construccion:nueva" && !!(await esperarHasta(() => !itemDe(A, "jardinera_madera"), 4000)), JSON.stringify(rJardinera));
  const estadoJ = await pedir(A, "cultivo:consultar", { construccionId: rJardinera.m?.id }, ["cultivo:estado"]);
  comprobar("la jardinera pide 2 de tierra", estadoJ.tipo === "cultivo:estado" && estadoJ.m.tierraNecesaria === 2 && estadoJ.m.tierra === 0, JSON.stringify(estadoJ.m));
  const rMeterJ = await pedir(A, "cultivo:meterTierra", { construccionId: rJardinera.m?.id }, ["cultivo:estado", "cultivo:error"]);
  const rPlantarJ = await pedir(A, "cultivo:plantar", { construccionId: rJardinera.m?.id, instanciaId: 999999 }, ["cultivo:error", "cultivo:estado"]);
  comprobar("con 1/2 de tierra la jardinera sigue pidiendo 1 más antes de plantar", rMeterJ.m?.tierra === 1 && rPlantarJ.tipo === "cultivo:error" && /mete 1 más/.test(rPlantarJ.m?.motivo ?? ""), JSON.stringify(rPlantarJ));

  A.leave();
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd, rutaBd + "-wal", rutaBd + "-shm"]) { try { unlinkSync(f); } catch {} }
}
if (fallo) { console.error("EXCEPCIÓN:", fallo); process.exit(1); }
console.log(`\n${pasadas} comprobaciones en verde, ${fallidas} fallidas`);
process.exit(fallidas === 0 ? 0 : 1);
