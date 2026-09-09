/**
 * Sesión de CUENTA de jugador (pedido streamer 2026-09-09: "cuentas por
 * contraseña" — hasta ahora la identidad de un personaje era solo su
 * `nombre`, sin nada que impida a cualquiera escribir ese mismo nombre en
 * la URL y "ser" ese jugador). MISMO patrón exacto que
 * `admin/adminAuth.ts`: token opaco (`crypto.randomBytes`) guardado EN
 * MEMORIA, TTL con sliding expiration — se pierde al reiniciar el server,
 * igual que las sesiones de admin/Twitch (el jugador vuelve a loguearse,
 * nada persiste mal por ello).
 *
 * TTL mucho más largo que el de admin (6h): una cuenta de jugador se espera
 * que se use días/semanas seguidas sin volver a teclear la contraseña cada
 * vez que se cierra la pestaña — el cliente guarda el token en
 * `localStorage` (a diferencia de `sessionStorage` para admin/Twitch,
 * pensados como sesión de directo corta).
 */
import * as crypto from "node:crypto";

const TTL_SESION_MS = 30 * 24 * 60 * 60_000; // 30 días, sliding (se renueva en cada resolución)

export interface IdentidadJugador {
  jugadorId: number;
  nombre: string;
}

const sesionesActivas = new Map<string, IdentidadJugador & { expiraEn: number }>();

function limpiarSesionesCaducadas(ahora = Date.now()) {
  for (const [clave, fila] of sesionesActivas) {
    if (fila.expiraEn < ahora) sesionesActivas.delete(clave);
  }
}

/** Tras verificar la contraseña contra `jugadores.password_hash` — crea el token opaco de sesión. */
export function crearSesionJugador(identidad: IdentidadJugador): string {
  limpiarSesionesCaducadas();
  const token = crypto.randomBytes(24).toString("hex");
  sesionesActivas.set(token, { ...identidad, expiraEn: Date.now() + TTL_SESION_MS });
  return token;
}

/**
 * `RoomExteriorBase.crearJugador` la llama en CADA join (mismo criterio que
 * `resolverSesionAdmin`/`resolverSesionTwitch`) — el cliente reenvía el
 * mismo `playerSession` mientras dure el login. Renueva el TTL en cada
 * resolución con éxito. `null` si caducó, nunca existió, o no se mandó
 * ningún token — en ese caso el join sigue funcionando exactamente igual
 * que antes de que existiera este sistema (invitado por nombre libre,
 * usado hoy por toda la suite de tests e2e).
 */
export function resolverSesionJugador(token: string | undefined): IdentidadJugador | null {
  if (!token) return null;
  limpiarSesionesCaducadas();
  const fila = sesionesActivas.get(token);
  if (!fila) return null;
  fila.expiraEn = Date.now() + TTL_SESION_MS;
  return { jugadorId: fila.jugadorId, nombre: fila.nombre };
}

/** Invalida una sesión — "cerrar sesión" de esta pestaña/dispositivo concreto. */
export function cerrarSesionJugador(token: string): void {
  sesionesActivas.delete(token);
}

/** Invalida TODAS las sesiones activas de un jugador (todos sus dispositivos) — se usa al cambiar la contraseña. */
export function cerrarSesionesDeJugador(jugadorId: number): void {
  for (const [token, fila] of sesionesActivas) {
    if (fila.jugadorId === jugadorId) sesionesActivas.delete(token);
  }
}
