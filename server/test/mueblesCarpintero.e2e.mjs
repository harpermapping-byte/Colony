// E2E del mobiliario del carpintero (docs/GDD_Construccion.md §9, pedido
// streamer 2026-09-11: "estanterías de poción que se vean las pociones al
// colocarla, inventarios más limitados pero visuales... sofás de 1 o 2
// plazas... camas de tiers... si hago caja tiene inventario") contra el
// servidor REAL — protocolo Colyseus puro (colyseus.js, sin navegador, mismo
// criterio que herreria.e2e.mjs), tres jugadores a la vez sobre testflat
// (parcela real tf_0001, BD sqlite fresca). Confirma:
//   1) colocar una estantería de pociones exige tener el ÍTEM craftado y lo
//      consume; el broadcast construccion:nueva ya lleva `expuestos: []`.
//   2) su rejilla es la EXACTA del catálogo (6x1), meter una poción funciona
//      y TODOS los clientes reciben construccion:expuestos con el itemId;
//      meter una espada se rechaza con "solo guarda pociones y elixires".
//   3) un sofá de 2 plazas sienta a dos (clic y tecla F mezclados) y
//      rechaza al tercero por cualquiera de los dos mecanismos.
//   4) una cama individual rechaza a un segundo durmiente; al completar el
//      sueño, dormir:completado trae el factorDescanso de esa cama (1.25).
//   5) un cliente que entra DESPUÉS recibe en construcciones:lista la
//      estantería con sus expuestos persistidos.
//   node server/test/mueblesCarpintero.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unlinkSync } from "node:fs";

const dirServidor = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const raiz = join(dirServidor, "..");
const rutaBd = join(dirServidor, "test", "mueblesCarpintero_e2e.sqlite");
const rutaTestflat = join(raiz, "assets", "mapas", "testflat");
const PUERTO = 2617;
const NOMBRES = ["E2E-Carpintero", "E2E-Amigo", "E2E-Tercero", "E2E-Tardio"];
// Dentro de tf_0001 (runs y=10..21, x=26..37 en assets/mapas/testflat/parcelas.json),
// OJO: el servidor SIEMBRA la Test Zone Norte (server/src/mundo/semillaTestZone.ts,
// x:28-34 y:12-18, construcciones reales que endurecen la rejilla) incluso
// con BD fresca — estas casillas quedan fuera de esa franja. Todo a menos de RADIO_INTERACCION
// (2.2, medido desde la esquina x,y de la construcción) del punto de reunión.
const REUNION = { x: 36.5, y: 20.5 };
const ESTANTERIA_XY = { x: 36, y: 19 }; // [1,1] → dist 1.58
const SOFA_XY = { x: 35, y: 21 };       // [2,1] → dist 1.58
const CAMA_XY = { x: 37, y: 19 };       // [1,2] → dist 1.58

for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }

const procesos = [];
function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => { const s = String(d); if (/error|Error/.test(s)) process.stdout.write(`[srv] ${s}`); });
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
async function esperarHasta(fn, ms = 4000, paso = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await esperar(paso); }
  return fn();
}
/** Promesa que resuelve con el PRIMER mensaje de cualquiera de los tipos (o {tipo:"timeout"}). */
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

let fallo = null;
try {
  console.log("1) arrancando servidor real sobre testflat (todos jarl para poder teletransportarse y construir en tf_0001)...");
  lanzar("npx", ["tsx", "src/index.ts"], dirServidor, { PORT: String(PUERTO), RUTA_MAPA: rutaTestflat, BD_RUTA: rutaBd, JARL_NOMBRES: NOMBRES.join(",") });
  await esperarPuerto(`http://localhost:${PUERTO}/`);

  const { Client } = await import(join(raiz, "node_modules/colyseus.js/build/esm/index.mjs"));
  const cliente = new Client(`ws://localhost:${PUERTO}`);
  const [A, B, C] = await Promise.all(NOMBRES.slice(0, 3).map((name) => cliente.joinOrCreate("hub", { name })));
  await esperar(500);
  for (const room of [A, B, C]) room.send("admin:debug:teleport", REUNION);
  for (const room of [A, B, C]) {
    const cerca = await esperarHasta(() => { const yo = room.state.players.get(room.sessionId); return yo && Math.hypot(yo.x - REUNION.x, yo.y - REUNION.y) < 1.5; }, 6000, 100);
    if (!cerca) throw new Error("un jugador no llegó al punto de reunión");
  }

  console.log("2) estantería de pociones: sin ítem se rechaza; con ítem se coloca, lo consume y construccion:nueva lleva expuestos=[]");
  {
    const sinItem = siguiente(A, ["construir:error", "construccion:nueva"]);
    A.send("construir", { objeto: "estanteria_pociones_pino", categoria: "mueble", x: ESTANTERIA_XY.x, y: ESTANTERIA_XY.y, rot: 0, variante: 0 });
    const r = await sinItem;
    comprobar("sin el ítem craftado no se puede colocar (requiereItemColocar)", r.tipo === "construir:error" && /necesitas estanteria_pociones_pino/.test(r.m?.motivo ?? ""), JSON.stringify(r));
  }
  for (const [itemId, cantidad] of [["estanteria_pociones_pino", 1], ["sofa_lino_doble", 1], ["cama_roble_individual", 1], ["pocion_alquimica_clara", 2], ["espada_corta", 1]]) {
    A.send("admin:debug:darItem", { itemId, cantidad });
  }
  const tieneTodo = await esperarHasta(() => ["estanteria_pociones_pino", "sofa_lino_doble", "cama_roble_individual", "pocion_alquimica_clara", "espada_corta"].every((id) => itemDe(A, id)), 4000);
  comprobar("admin:debug:darItem entrega los 3 muebles + poción + espada", !!tieneTodo);

  let estanteria;
  {
    const enB = siguiente(B, ["construccion:nueva"]);
    const enA = siguiente(A, ["construccion:nueva", "construir:error"]);
    A.send("construir", { objeto: "estanteria_pociones_pino", categoria: "mueble", x: ESTANTERIA_XY.x, y: ESTANTERIA_XY.y, rot: 0, variante: 0 });
    const [ra, rb] = await Promise.all([enA, enB]);
    comprobar("se coloca con el ítem en el inventario", ra.tipo === "construccion:nueva" && ra.m.objeto === "estanteria_pociones_pino", JSON.stringify(ra));
    comprobar("construccion:nueva lleva expuestos=[] (es expositor) y llega a TODOS los clientes", Array.isArray(ra.m.expuestos) && ra.m.expuestos.length === 0 && rb.tipo === "construccion:nueva" && Array.isArray(rb.m.expuestos), JSON.stringify(rb));
    estanteria = ra.m;
    const consumido = await esperarHasta(() => !itemDe(A, "estanteria_pociones_pino"), 2000);
    comprobar("el ítem portador se consume al colocar", !!consumido);
  }

  console.log("3) rejilla exacta 6x1, meter poción → expuestos difundidos, meter espada → rechazo por filtro");
  {
    const estado = siguiente(A, ["cofre:estado", "cofre:error"]);
    A.send("cofre:consultar", { construccionId: estanteria.id });
    const r = await estado;
    comprobar("cofre:consultar abre la estantería con la rejilla EXACTA del catálogo (6x1, rejillaCofre)", r.tipo === "cofre:estado" && r.m.ancho === 6 && r.m.alto === 1, JSON.stringify(r));
  }
  {
    const pocion = itemDe(A, "pocion_alquimica_clara");
    const enA = siguiente(A, ["cofre:estado", "cofre:error"]);
    const enB = siguiente(B, ["construccion:expuestos"]);
    const enC = siguiente(C, ["construccion:expuestos"]);
    A.send("cofre:meterItem", { construccionId: estanteria.id, instanciaId: pocion.id });
    const [ra, rb, rc] = await Promise.all([enA, enB, enC]);
    comprobar("la poción entra en la estantería", ra.tipo === "cofre:estado" && ra.m.items.length === 1 && ra.m.items[0].itemId === "pocion_alquimica_clara", JSON.stringify(ra));
    comprobar("construccion:expuestos llega a los OTROS clientes con la poción visible", rb.tipo === "construccion:expuestos" && rb.m.id === estanteria.id && rb.m.expuestos?.[0] === "pocion_alquimica_clara" && rc.tipo === "construccion:expuestos", JSON.stringify(rb));
  }
  {
    const espada = itemDe(A, "espada_corta");
    const enA = siguiente(A, ["cofre:estado", "cofre:error"]);
    A.send("cofre:meterItem", { construccionId: estanteria.id, instanciaId: espada.id });
    const r = await enA;
    comprobar("una espada NO entra: 'solo guarda pociones y elixires' (aceptaItems)", r.tipo === "cofre:error" && /solo guarda pociones y elixires/.test(r.m?.motivo ?? ""), JSON.stringify(r));
    comprobar("la espada sigue en el inventario del jugador tras el rechazo", !!itemDe(A, "espada_corta"));
  }

  console.log("4) sofá de dos plazas: A (clic) + B (tecla F) caben, C es rechazado por los dos mecanismos");
  let sofa;
  {
    const enA = siguiente(A, ["construccion:nueva", "construir:error"]);
    A.send("construir", { objeto: "sofa_lino_doble", categoria: "mueble", x: SOFA_XY.x, y: SOFA_XY.y, rot: 0, variante: 0 });
    const r = await enA;
    comprobar("el sofá se coloca (no es expositor: sin campo expuestos)", r.tipo === "construccion:nueva" && r.m.objeto === "sofa_lino_doble" && r.m.expuestos === undefined, JSON.stringify(r));
    sofa = r.m;
  }
  {
    const ra = siguiente(A, ["sentar:iniciado", "sentar:error"]);
    A.send("sentar:iniciar", { construccionId: sofa.id });
    const r = await ra;
    comprobar("A se sienta por clic (sentar:iniciar)", r.tipo === "sentar:iniciado", JSON.stringify(r));
    B.send("asiento:sentarse", { construccionId: sofa.id });
    const sentadoB = await esperarHasta(() => { const p = B.state.players.get(B.sessionId); return p?.sentado && p.sentadoEnId === sofa.id; }, 3000);
    comprobar("B se sienta por tecla F (asiento:sentarse) en la segunda plaza", !!sentadoB);
    const rc = siguiente(C, ["sentar:iniciado", "sentar:error"]);
    C.send("sentar:iniciar", { construccionId: sofa.id });
    const c1 = await rc;
    comprobar("C (tercero) es rechazado por clic: 'no queda sitio en ese mueble'", c1.tipo === "sentar:error" && /no queda sitio/.test(c1.m?.motivo ?? ""), JSON.stringify(c1));
    const rc2 = siguiente(C, ["asiento:error"]);
    C.send("asiento:sentarse", { construccionId: sofa.id });
    const c2 = await rc2;
    comprobar("C también es rechazado por tecla F: 'ese asiento ya está ocupado'", c2.tipo === "asiento:error" && /ocupado/.test(c2.m?.motivo ?? ""), JSON.stringify(c2));
    let sentados = 0;
    A.state.players.forEach((p) => { if (p.sentado && p.sentadoEnId === sofa.id) sentados++; });
    comprobar("el Schema refleja exactamente 2 ocupantes en el sofá", sentados === 2, `sentados=${sentados}`);
    // B se levanta (moverse de verdad) y C ya cabe
    B.send("input", { x: 1, y: 0 });
    await esperar(200);
    B.send("input", { x: 0, y: 0 });
    const libre = await esperarHasta(() => { const p = B.state.players.get(B.sessionId); return p && !p.sentado; }, 3000);
    comprobar("B se levanta al moverse", !!libre);
    const rc3 = siguiente(C, ["sentar:iniciado", "sentar:error"]);
    C.send("sentar:iniciar", { construccionId: sofa.id });
    const c3 = await rc3;
    comprobar("con la plaza libre, C sí se sienta", c3.tipo === "sentar:iniciado", JSON.stringify(c3));
  }

  console.log("5) cama individual de roble: un solo durmiente; al completar, factorDescanso=1.25");
  let cama;
  {
    const enA = siguiente(A, ["construccion:nueva", "construir:error"]);
    A.send("construir", { objeto: "cama_roble_individual", categoria: "mueble", x: CAMA_XY.x, y: CAMA_XY.y, rot: 0, variante: 0 });
    const r = await enA;
    comprobar("la cama se coloca", r.tipo === "construccion:nueva" && r.m.objeto === "cama_roble_individual", JSON.stringify(r));
    cama = r.m;
    // A estaba sentado en el sofá: moverse lo levanta antes de tumbarse
    A.send("input", { x: 0, y: 1 }); await esperar(150); A.send("input", { x: 0, y: 0 }); await esperar(150);
    const ra = siguiente(A, ["dormir:iniciado", "dormir:error"]);
    A.send("dormir:iniciar", { construccionId: cama.id });
    const d1 = await ra;
    comprobar("A se tumba (dormir:iniciado)", d1.tipo === "dormir:iniciado", JSON.stringify(d1));
    const rb = siguiente(B, ["dormir:iniciado", "dormir:error"]);
    B.send("dormir:iniciar", { construccionId: cama.id });
    const d2 = await rb;
    comprobar("B es rechazado: 'esa cama ya está ocupada' (plazas=1)", d2.tipo === "dormir:error" && /ocupada/.test(d2.m?.motivo ?? ""), JSON.stringify(d2));
    console.log("   esperando los 20s reales de sueño...");
    await esperar(20_500);
    const rf = siguiente(A, ["dormir:completado", "dormir:error"], 4000);
    A.send("dormir:completar", {});
    const d3 = await rf;
    comprobar("dormir:completado trae factorDescanso=1.25 (calidadDescanso de la cama de roble)", d3.tipo === "dormir:completado" && Math.abs((d3.m?.factorDescanso ?? 0) - 1.25) < 1e-9, JSON.stringify(d3));
  }

  console.log("6) un cliente que entra después recibe la estantería con sus expuestos persistidos");
  {
    const D = await cliente.joinOrCreate("hub", { name: NOMBRES[3] });
    // construcciones:lista se manda en onJoin, antes de que podamos enganchar el listener — la sonda es el estado que sigue: re-pedir no existe, así que reconectamos escuchando desde el primer instante
    await D.leave();
    const lista = await new Promise(async (resolve) => {
      const D2 = await cliente.joinOrCreate("hub", { name: NOMBRES[3] });
      D2.onMessage("construcciones:lista", (l) => resolve({ l, room: D2 }));
      setTimeout(() => resolve({ l: null, room: D2 }), 4000);
    });
    const fila = lista.l?.find((c) => c.id === estanteria.id);
    comprobar("construcciones:lista incluye la estantería con expuestos=['pocion_alquimica_clara'] (persistido en BD, no solo en memoria de la sesión)", !!fila && Array.isArray(fila.expuestos) && fila.expuestos[0] === "pocion_alquimica_clara", JSON.stringify(fila));
    const filaSofa = lista.l?.find((c) => c.id === sofa.id);
    comprobar("el sofá en la lista NO lleva expuestos (no es expositor)", !!filaSofa && filaSofa.expuestos === undefined, JSON.stringify(filaSofa));
    await lista.room.leave();
  }

  await Promise.all([A.leave(), B.leave(), C.leave()]);
} catch (e) {
  fallo = e;
} finally {
  matarTodo();
  for (const f of [rutaBd]) { try { unlinkSync(f); } catch {} }
}

console.log(`\n${pasadas} comprobaciones en verde, ${fallidas} fallidas${fallo ? `, excepción: ${fallo.message}` : ""}`);
process.exit(fallo || fallidas > 0 ? 1 : 0);
