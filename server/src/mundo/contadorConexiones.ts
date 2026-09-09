// Contador global de sesiones conectadas en este proceso — TODAS las room
// types comparten proceso (single Node, sin cluster), así que un contador
// de módulo basta: incrementado en `crearJugador` (RoomExteriorBase.ts, el
// único punto donde CUALQUIER room type crea un Player real) y decrementado
// en `onLeave` (mismo archivo) — la pareja exacta de cada join real.
//
// Uso real (pedido streamer 2026-09-09, "que el pm2 se reinicie solo con
// cada push a main"): `server/src/index.ts` lo expone en `GET /estado`
// para que `server/deploy/autoActualizar.ps1` sepa si es seguro reiniciar
// SIN cortar una partida en curso — el mismo criterio de seguridad que ya
// tenía el redeploy manual (`actualizar.ps1`), ahora automatizado en vez
// de exigir que el streamer elija el momento a mano.
let conexionesActivas = 0;

export function jugadorConectado(): void {
  conexionesActivas++;
}

export function jugadorDesconectado(): void {
  conexionesActivas = Math.max(0, conexionesActivas - 1);
}

export function obtenerConexionesActivas(): number {
  return conexionesActivas;
}
