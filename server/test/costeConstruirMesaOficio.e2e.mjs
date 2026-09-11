// E2E del coste de materiales para CONSTRUIR una mesa de oficio
// (docs/GDD_Construccion.md §3, pedido streamer 2026-09-10: "que se puedan
// construir... nivel 1 fácil, las siguientes se van complicando") — cierra
// el hueco anunciado desde el diseño original ("receta se rellenará al
// definir la economía") y nunca implementado hasta ahora: construir
// cualquier mesa era gratis salvo nivel de oficio.
//
// Protocolo Colyseus REAL (colyseus.js directo, sin navegador — mismo
// criterio que concurrencia.e2e.mjs) contra el mapa "testflat" (tiene una
// parcela real, tf_0001, a diferencia de "principal"/Vetrheim cuyo
// parcelas.json quedó vacío tras el rehorneo). El jugador se conecta como
// JARL (JARL_NOMBRES) para poder construir en la parcela sin dueño y usar
// admin:debug:darItem, igual que megaEstresTodasLasMecanicas.e2e.mjs.
//
// Confirma:
//   1) construir yunque_tocon SIN piedra_comun/madera_blanda se rechaza
//      ("te falta piedra_comun"), la construcción NO llega a existir.
//   2) con los materiales exactos en el inventario, construir tiene éxito
//      y los descuenta de verdad (no solo del lado servidor: se relee el
//      inventario tras el mensaje).
//   3) el sobrante de un material (pedido con más del necesario) se queda
//      con el resto, no se vacía todo el stack.
//
//   node server/test/costeConstruirMesaOficio.e2e.mjs
import { spawn } from "node:child_process";
import { join } from "node:path";
import * as fs from "node:fs";
import { Client } from "colyseus.js";

const RAIZ = "/home/user/Colony";
const dirServidor = join(RAIZ, "server");
const PUERTO_WS = 2651;
const RUTA_MAPA = join(RAIZ, "assets", "mapas", "testflat");
const BD_RUTA = "/tmp/colony_coste_construir_e2e.sqlite";
const NOMBRE = "E2E-Constructor";
try { fs.unlinkSync(BD_RUTA); } catch {}

function lanzar(cmd, args, cwd, extraEnv) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS), RUTA_MAPA, BD_RUTA, JARL_NOMBRES: NOMBRE,
});
const matar = () => {
  try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
  try { servidor.kill("SIGKILL"); } catch {}
};
process.on("exit", matar);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

function unaVez(room, tipo) {
  return new Promise((resolve) => {
    const off = room.onMessage(tipo, (m) => { off(); resolve(m); });
  });
}

(async () => {
  try {
    await esperar(3500);
    const client = new Client(`ws://localhost:${PUERTO_WS}`);
    const room = await client.joinOrCreate("hub", { name: NOMBRE });
    await esperar(800); // sincroniza el primer patch de Schema

    // Candidatos dentro de tf_0001 (runs: y 10-21, x 26-37) — probamos varias
    // hasta que una casilla libre acepte, mismo patrón que
    // megaEstresTodasLasMecanicas.e2e.mjs (evita chocar con los 19 muebles
    // ya sembrados por semillaTestZone.ts).
    const candidatos = [];
    for (let y = 10; y <= 21; y++) for (let x = 26; x <= 37; x++) candidatos.push({ x, y });

    async function intentarConstruir() {
      for (const c of candidatos) {
        const espera = Promise.race([unaVez(room, "construccion:nueva"), unaVez(room, "construir:error")]);
        room.send("construir", { objeto: "yunque_tocon", categoria: "mueble", x: c.x, y: c.y, rot: 0, variante: 0 });
        const m = await espera;
        if (m.id !== undefined) return { ok: true, id: m.id, x: c.x, y: c.y };
        if (m.motivo && m.motivo !== "casilla ocupada" && !m.motivo.includes("colisión") && !m.motivo.includes("ocupad")) {
          return { ok: false, motivo: m.motivo };
        }
        // casilla ocupada de verdad (mueble ya sembrado ahí) → prueba la siguiente
      }
      return { ok: false, motivo: "sin candidato libre" };
    }

    console.log("1) construir yunque_tocon SIN materiales — debe rechazarse por insumos...");
    const sinMateriales = await intentarConstruir();
    comprobar(
      "rechazado por falta de materiales (no por casilla/nivel)",
      !sinMateriales.ok && /piedra_comun|madera_blanda/.test(sinMateriales.motivo || ""),
      JSON.stringify(sinMateriales),
    );

    console.log("2) dando piedra_comun×6 + madera_blanda×5 (1 de sobra en cada uno) y reintentando...");
    room.send("admin:debug:darItem", { itemId: "piedra_comun", cantidad: 6 });
    await esperar(300);
    room.send("admin:debug:darItem", { itemId: "madera_blanda", cantidad: 5 });
    await esperar(300);

    const inventarioAntes = () => [...room.state.players.get(room.sessionId).inventario.cuerpo.items].map((it) => ({ itemId: it.itemId, cantidad: it.cantidad }));
    const antes = inventarioAntes();
    console.log("  inventario antes:", JSON.stringify(antes));

    const conMateriales = await intentarConstruir();
    comprobar("construir yunque_tocon con los materiales reales tiene éxito", conMateriales.ok, JSON.stringify(conMateriales));

    await esperar(500);
    const despues = inventarioAntes();
    console.log("  inventario después:", JSON.stringify(despues));
    const piedra = despues.find((i) => i.itemId === "piedra_comun");
    const madera = despues.find((i) => i.itemId === "madera_blanda");
    comprobar("se descontaron 4 piedra_comun de verdad (6→2, sobra 2)", !!piedra && piedra.cantidad === 2, JSON.stringify(piedra));
    comprobar("se descontaron 2 madera_blanda de verdad (5→3, sobra 3)", !!madera && madera.cantidad === 3, JSON.stringify(madera));

    console.log(fallos === 0 ? "\n✅ costeConstruirMesaOficio.e2e: todo OK" : `\n❌ ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } catch (err) {
    console.error("costeConstruirMesaOficio.e2e reventó:", err);
    process.exitCode = 1;
  } finally {
    matar();
  }
})();
