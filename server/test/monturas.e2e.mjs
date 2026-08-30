// E2E de monturas (docs/GDD_Monturas.md, pedido 2026-08-30) contra el
// servidor REAL — mismo patrón que persistenciaEquipo.e2e.mjs: siembra la
// BD sqlite temporal con una mascota YA domesticada y con silla puesta
// (montura=1) ANTES de arrancar el servidor, para ejercitar montar/
// desmontar/velocidad sin depender de un bake con fauna salvaje al alcance
// del spawn del Hub (la domesticación en sí — comida diet-aware,
// domesticar() sin cadáver — ya está cubierta a fondo por los tests puros
// de inventario.test.ts/faunaSalvajeViva.test.ts).
//   1. Al entrar, la mascota (nace "siguiendo" en la posición del dueño)
//      debe aparecer YA en state.mascotas con montura=true.
//   2. mascota:montar SIN mascotaId (auto-apuntado) debe fusionarla: sale
//      de state.mascotas, Player.monturaEspecieId/monturaMascotaId se
//      rellenan.
//   3. Montado, la velocidad de movimiento real (casillas/tick) debe ser
//      mayor que VEL_ANDAR — se mueve a velocidadMontura del catálogo.
//   4. mascota:desmontar la separa nde nuevo: reaparece en state.mascotas,
//      Player.monturaEspecieId vuelve a "".
//   node server/test/monturas.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "monturas_e2e.sqlite");
const PUERTO = 2600;
const NOMBRE = "E2E-Montura";

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

console.log("1) sembrando BD sqlite temporal (jugador + caballo domesticado con silla puesta)...");
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
      montura INTEGER NOT NULL DEFAULT 0
    );
  `);
  bd.prepare("INSERT INTO jugadores (id, nombre, creado_en) VALUES (1, ?, ?)").run(NOMBRE, new Date().toISOString());
  bd.prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura) VALUES (1, 'caballo', 'siguiendo', NULL, ?, 1)").run(new Date().toISOString());
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

const rutaDemo = join(raiz, "assets", "mapas", "demo");

let fallo = null;
try {
  console.log("2) arrancando servidor real sobre esa BD sembrada...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaDemo, BD_RUTA: rutaBd });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const client = new Client(`ws://localhost:${PUERTO}`);

  console.log("3) join — la mascota 'siguiendo' sembrada debe aparecer YA con montura=true...");
  const room = await client.joinOrCreate("hub", { name: NOMBRE });
  await new Promise((r) => setTimeout(r, 700));
  const mascotas = [...room.state.mascotas.values()];
  if (mascotas.length !== 1 || mascotas[0].especieId !== "caballo" || mascotas[0].montura !== true) {
    throw new Error(`FALLO: no apareció el caballo con montura=true, llegó ${JSON.stringify(mascotas.map((m) => ({ especieId: m.especieId, montura: m.montura })))}`);
  }
  console.log("   OK: la mascota sembrada aparece siguiendo, con la silla puesta");

  console.log("3bis) velocidad A PIE de referencia — sesión SEPARADA (mismo punto de spawn exacto, terreno controlado; la sesión montada de abajo ya se movió y cambiaría de casilla si se usara la misma) ...");
  const clientePie = new Client(`ws://localhost:${PUERTO}`);
  const roomPie = await clientePie.joinOrCreate("hub", { name: "E2E-Montura-Referencia" });
  await new Promise((r) => setTimeout(r, 400));
  const jugadorAPie = roomPie.state.players.get(roomPie.sessionId);
  const xPie0 = jugadorAPie.x, yPie0 = jugadorAPie.y;
  roomPie.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 500)); // misma duración que la ráfaga montada, para comparar en igualdad de condiciones
  roomPie.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const distanciaAPie = Math.hypot(jugadorAPie.x - xPie0, jugadorAPie.y - yPie0);
  await roomPie.leave();
  console.log(`   referencia: ${distanciaAPie.toFixed(2)} casillas/seg a pie desde el mismo punto de spawn`);

  console.log("4) mascota:montar sin mascotaId (auto-apuntado)...");
  const erroresMascota = [];
  room.onMessage("mascota:error", (m) => erroresMascota.push(m));
  room.send("mascota:montar", {});
  await new Promise((r) => setTimeout(r, 400));
  if (erroresMascota.length > 0) throw new Error(`FALLO: mascota:montar rechazado, ${JSON.stringify(erroresMascota)}`);
  const jugador = room.state.players.get(room.sessionId);
  if (jugador.monturaEspecieId !== "caballo") throw new Error(`FALLO: Player.monturaEspecieId no se rellenó (${jugador.monturaEspecieId})`);
  if (room.state.mascotas.size !== 0) throw new Error("FALLO: la mascota debería haber desaparecido de state.mascotas al montarla (fusionada en el jugador)");
  console.log("   OK: montar fusiona al jugador con la montura — Player.monturaEspecieId='caballo', mascota fuera del Schema");

  console.log("5) montado, se mueve más rápido que VEL_ANDAR (velocidadMontura del catálogo)...");
  const x0 = jugador.x, y0 = jugador.y;
  room.send("input", { x: 1, y: 0 });
  await new Promise((r) => setTimeout(r, 500)); // ráfaga corta: cuanto más se aleja, más riesgo de toparse con un obstáculo del mapa demo y falsear la comparación
  room.send("input", { x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const distancia = Math.hypot(jugador.x - x0, jugador.y - y0);
  // Comparación RELATIVA a la referencia a pie desde el MISMO punto exacto
  // (no un umbral absoluto) — así no depende del modificador de terreno de
  // esta casilla del mapa demo. velocidadMontura del caballo (8.5) casi
  // duplica VEL_ANDAR (3.75); un +15% de margen basta para detectar que el
  // multiplicador se está aplicando de verdad sin ser frágil ante jitter.
  if (distancia < distanciaAPie * 1.15) {
    throw new Error(`FALLO: montado (${distancia.toFixed(2)}) no fue notablemente más rápido que a pie (${distanciaAPie.toFixed(2)}) — no parece ir a velocidad de montura`);
  }
  console.log(`   OK: recorrió ${distancia.toFixed(2)} casillas en ~0.5s montado, vs ${distanciaAPie.toFixed(2)} a pie desde el mismo punto`);

  console.log("5bis) montura:saltar — mueve de golpe en la dirección que mira...");
  const xSalto0 = jugador.x, ySalto0 = jugador.y;
  // dx=-1 (hacia el spawn, terreno YA recorrido y confirmado transitable en
  // los pasos anteriores) — más allá en +x es terreno sin explorar por este
  // test y podría toparse con un obstáculo real del mapa demo.
  room.send("montura:saltar", { dx: -1, dy: 0 });
  await new Promise((r) => setTimeout(r, 300));
  const distanciaSalto = Math.hypot(jugador.x - xSalto0, jugador.y - ySalto0);
  if (distanciaSalto < 1) throw new Error(`FALLO: montura:saltar apenas movió al jugador (${distanciaSalto.toFixed(2)} casillas)`);
  console.log(`   OK: el salto movió ${distanciaSalto.toFixed(2)} casillas de golpe`);

  console.log("6) mascota:desmontar — separa de nuevo...");
  room.send("mascota:desmontar");
  await new Promise((r) => setTimeout(r, 400));
  if (jugador.monturaEspecieId !== "") throw new Error(`FALLO: Player.monturaEspecieId no se limpió (${jugador.monturaEspecieId})`);
  if (room.state.mascotas.size !== 1) throw new Error("FALLO: la mascota debería haber reaparecido en state.mascotas al desmontar");
  console.log("   OK: desmontar separa de nuevo — mascota visible, jugador a pie");

  await room.leave();
  console.log("\n=== E2E monturas: TODO OK ===");
} catch (err) {
  fallo = err;
  console.error("\n=== E2E monturas: FALLO ===\n", err);
} finally {
  matarTodo();
}
process.exit(fallo ? 1 : 0);
