// Tests de auth/rutasAuthJugador.ts::equiparRopaInicialSiHaceFalta (pedido
// streamer 2026-09-10: "al crear el Personaje que salga con ropa
// harapienta") — mismo patrón que rutasAdmin.test.ts (servidor HTTP real
// sobre un puerto suelto, BD SQLite en memoria vía el singleton
// obtenerBdCompartida()). Ejecutar: npm test desde server/.
process.env.BD_RUTA = ":memory:";

import { test } from "node:test";
import * as assert from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { manejarPeticionAuthJugador } from "../src/auth/rutasAuthJugador";
import { obtenerBdCompartida } from "../src/datos/bdCompartida";

function crearServidorDePrueba(): Promise<{ url: string; cerrar: () => Promise<void> }> {
  return new Promise((resolve) => {
    const servidor = createServer((req, res) => {
      if (manejarPeticionAuthJugador(req, res)) return;
      res.writeHead(404).end();
    });
    servidor.listen(0, () => {
      const { port } = servidor.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        cerrar: () => new Promise((r) => servidor.close(() => r())),
      });
    });
  });
}

function postJson(url: string, ruta: string, cuerpo: unknown) {
  return fetch(`${url}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

test("jugador genuinamente nuevo: al confirmar el creador de personaje sale vestido con camisa_harapienta/pantalon_harapiento", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const rRegistro = await postJson(url, "/auth/jugador/registro", { nombre: "harapiento_nuevo", password: "test1234" });
    assert.strictEqual(rRegistro.status, 200);
    const { token } = (await rRegistro.json()) as { token: string };

    const rPersonaje = await postJson(url, "/auth/jugador/personaje", { token, eleccion: {} });
    assert.strictEqual(rPersonaje.status, 200);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador("harapiento_nuevo");
    const { equipo, durabilidad } = await bd.cargarEquipo(jugador.id);
    assert.strictEqual(equipo.pechera, "camisa_harapienta");
    assert.strictEqual(equipo.piernas, "pantalon_harapiento");
    assert.strictEqual(durabilidad.pechera, 20);
    assert.strictEqual(durabilidad.piernas, 20);
  } finally {
    await cerrar();
  }
});

test("personaje LEGADO con equipo real (jugaba antes de que existieran las cuentas): el creador de personaje NUNCA pisa lo que ya llevaba puesto", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const bd = await obtenerBdCompartida();
    const legado = await bd.obtenerOCrearJugador("harapiento_legado");
    // Ya llevaba puesta una pechera real de antes (equipo persistido sin
    // pasar por ningún login — como cualquier jugador de antes de 2026-09-09).
    await bd.guardarEquipo(legado.id, { pechera: "camisa_seda_noble" }, { pechera: 30 });

    const rRegistro = await postJson(url, "/auth/jugador/registro", { nombre: "harapiento_legado", password: "test1234" });
    assert.strictEqual(rRegistro.status, 200);
    const { token } = (await rRegistro.json()) as { token: string };

    await postJson(url, "/auth/jugador/personaje", { token, eleccion: {} });

    const { equipo, durabilidad } = await bd.cargarEquipo(legado.id);
    // La pechera real NUNCA se sustituye por harapos.
    assert.strictEqual(equipo.pechera, "camisa_seda_noble");
    assert.strictEqual(durabilidad.pechera, 30);
    // Piernas SÍ estaba vacío de verdad — ese hueco sí se rellena con el pantalón de arranque.
    assert.strictEqual(equipo.piernas, "pantalon_harapiento");
  } finally {
    await cerrar();
  }
});

test("llamar dos veces al creador de personaje (idempotente): la segunda vez no cambia nada", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const rRegistro = await postJson(url, "/auth/jugador/registro", { nombre: "harapiento_doble", password: "test1234" });
    const { token } = (await rRegistro.json()) as { token: string };
    await postJson(url, "/auth/jugador/personaje", { token, eleccion: {} });

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador("harapiento_doble");
    // El jugador se cambia de ropa real (equipara algo distinto) antes de la segunda llamada.
    await bd.guardarEquipo(jugador.id, { pechera: "camisa_lino_campesina", piernas: "pantalon_harapiento" }, { pechera: 30, piernas: 20 });

    await postJson(url, "/auth/jugador/personaje", { token, eleccion: {} });

    const { equipo } = await bd.cargarEquipo(jugador.id);
    // La segunda llamada no vuelve a poner harapos sobre la pechera ya cambiada.
    assert.strictEqual(equipo.pechera, "camisa_lino_campesina");
    assert.strictEqual(equipo.piernas, "pantalon_harapiento");
  } finally {
    await cerrar();
  }
});
