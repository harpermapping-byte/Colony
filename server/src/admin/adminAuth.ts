/**
 * Sesión de admin (jarl por mapa + superadmin) — pedido 2026-08-30: login
 * dual, o bien con Twitch (login de Twitch ya vinculado a una cuenta de
 * admin) o bien con usuario/contraseña propios de este juego. Mismo patrón
 * exacto que `twitch/oauthLogin.ts::crearSesionTwitch/resolverSesionTwitch`
 * — token opaco (`crypto.randomBytes`), guardado EN MEMORIA (se pierde al
 * reiniciar el server, igual que las sesiones de Twitch: nada grave, el
 * jugador vuelve a loguearse), TTL con sliding expiration.
 *
 * "1 jarl por mapa" (decidido con el streamer): `mapaId` en `IdentidadAdmin`
 * es el mapa que administra si `rol==="jarl"` — `null` para `rol==="superadmin"`
 * (todos los mapas). Quién es jarl de qué mapa vive en la tabla `admin_cuentas`
 * (server/src/datos/bd.ts), esto solo gestiona la SESIÓN una vez resuelta esa
 * identidad contra la BD (login por contraseña) o contra un twitch_login
 * vinculado (login por Twitch).
 */
import * as crypto from "node:crypto";

const TTL_SESION_MS = 6 * 60 * 60_000; // 6h, igual que las sesiones de Twitch — se renueva en cada resolución

export type RolAdmin = "jarl" | "superadmin";

export interface IdentidadAdmin {
  usuario: string;
  rol: RolAdmin;
  /** Solo con rol==="jarl": el mapaId que administra. null para superadmin (cualquier mapa) o si no aplica. */
  mapaId: string | null;
}

const sesionesActivas = new Map<string, IdentidadAdmin & { expiraEn: number }>();

function limpiarSesionesCaducadas(ahora = Date.now()) {
  for (const [clave, fila] of sesionesActivas) {
    if (fila.expiraEn < ahora) sesionesActivas.delete(clave);
  }
}

/** Tras verificar la contraseña o resolver el twitch_login contra `admin_cuentas` — crea el token opaco de sesión. */
export function crearSesionAdmin(identidad: IdentidadAdmin): string {
  limpiarSesionesCaducadas();
  const token = crypto.randomBytes(24).toString("hex");
  sesionesActivas.set(token, { ...identidad, expiraEn: Date.now() + TTL_SESION_MS });
  return token;
}

/**
 * `RoomExteriorBase.crearJugador` la llama en CADA join, igual que
 * `resolverSesionTwitch` — el cliente reenvía el mismo `adminSession` en
 * cada `joinOrCreate` mientras dure la pestaña. Renueva el TTL en cada
 * resolución con éxito (sesión de directo larga, no de un solo uso).
 * `null` si caducó, nunca existió, o no se mandó ningún token.
 */
export function resolverSesionAdmin(token: string | undefined): IdentidadAdmin | null {
  if (!token) return null;
  limpiarSesionesCaducadas();
  const fila = sesionesActivas.get(token);
  if (!fila) return null;
  fila.expiraEn = Date.now() + TTL_SESION_MS;
  return { usuario: fila.usuario, rol: fila.rol, mapaId: fila.mapaId };
}

/** Invalida una sesión — "cerrar sesión" de esta pestaña concreta. */
export function cerrarSesionAdmin(token: string): void {
  sesionesActivas.delete(token);
}

/** Invalida TODAS las sesiones activas de un usuario (todas sus pestañas) — se usa al cambiar la contraseña. */
export function cerrarSesionesDeUsuario(usuario: string): void {
  for (const [token, fila] of sesionesActivas) {
    if (fila.usuario === usuario) sesionesActivas.delete(token);
  }
}
