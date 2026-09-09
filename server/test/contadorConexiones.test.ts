import { test } from "node:test";
import assert from "node:assert/strict";
import { jugadorConectado, jugadorDesconectado, obtenerConexionesActivas } from "../src/mundo/contadorConexiones";

// GET /estado (index.ts) usa este contador para que autoActualizar.ps1 sepa
// si es seguro reiniciar sin cortar una partida en curso — el contrato real
// que importa es "nunca queda negativo" y "sube/baja exactamente con cada
// join/leave pareado", ver contadorConexiones.ts.
test("empieza en 0 y sube/baja con cada conexión/desconexión", () => {
  const inicial = obtenerConexionesActivas();
  jugadorConectado();
  jugadorConectado();
  assert.equal(obtenerConexionesActivas(), inicial + 2);
  jugadorDesconectado();
  assert.equal(obtenerConexionesActivas(), inicial + 1);
  jugadorDesconectado();
  assert.equal(obtenerConexionesActivas(), inicial);
});

test("nunca baja de 0 aunque se desconecte de más", () => {
  // No debería pasar en producción (cada onLeave tiene su crearJugador
  // pareado), pero un contador global no debe poder quedar en negativo
  // por un desajuste puntual — eso rompería para siempre la comprobación
  // de "servidor vacío" del auto-deploy.
  while (obtenerConexionesActivas() > 0) jugadorDesconectado();
  jugadorDesconectado();
  jugadorDesconectado();
  assert.equal(obtenerConexionesActivas(), 0);
});
