/**
 * Login con Twitch — SOLO para que la integración de Twitch (comandos de
 * chat, títulos) reconozca al jugador de verdad, sin depender de que el
 * nombre de su PJ coincida con su usuario de Twitch (docs/GDD_Twitch.md,
 * pedido 2026-08-30: "que el jugador se conecte con su cuenta Twitch
 * aunque su PJ tenga otro [nombre]"). Alcance DELIBERADAMENTE PEQUEÑO —
 * no sustituye la identidad del jugador en el resto del juego (gremios,
 * propiedades, mascotas, economía siguen por nombre de PJ, sin tocar):
 * eso es "login real", ya anotado en el proyecto como una de las últimas
 * piezas a construir (`docs/GDD_Construccion.md`), y un cambio mucho más
 * grande que lo que hace falta para arreglar el chat de Twitch.
 *
 * Flujo (Authorization Code de OAuth2, la cuenta del JUGADOR, no la del
 * streamer — cada jugador autoriza la suya):
 *   1. GET /auth/twitch/login   → redirige a Twitch con un `state` random
 *   2. El jugador acepta en Twitch → Twitch llama a
 *      GET /auth/twitch/callback?code=...&state=...
 *   3. El servidor intercambia el code por un token de USUARIO, pide su
 *      identidad real (id + login) a Helix, y la guarda tras un token de
 *      sesión propio (opaco) — nunca expone el token de Twitch al cliente.
 *   4. Redirige al CLIENTE con `?twitchSession=<token>&twitchLogin=<login>`
 *      — el cliente GUARDA ese token (no solo lo usa una vez: lo manda en
 *      CADA `joinOrCreate` mientras dure la pestaña, porque cruzar un
 *      portal/mazmorra/arena es una conexión de Colyseus NUEVA, con su
 *      propio `crearJugador`) y `resolverSesionTwitch` lo valida cada vez
 *      sin gastarlo — expira solo por inactividad (`TTL_SESION_MS`,
 *      renovado en cada resolución, "sesión de directo" más que "un solo uso").
 *
 * Sin `TWITCH_CLIENT_ID`/`SECRET`/`TWITCH_REDIRECT_URI` configurados, las
 * rutas HTTP simplemente no se registran (ver index.ts) — jugar sin login
 * de Twitch sigue funcionando exactamente igual que hasta ahora.
 */
import * as crypto from "node:crypto";

const TTL_STATE_MS = 10 * 60_000; // 10 min de sobra para que el jugador acepte en Twitch
const TTL_SESION_MS = 6 * 60 * 60_000; // 6h — dura lo que un directo largo, se renueva en cada resolverSesionTwitch

export interface IdentidadTwitch {
  twitchUserId: string;
  twitchLogin: string;
}

const estadosPendientes = new Map<string, number>(); // state -> expiraEn
const sesionesActivas = new Map<string, IdentidadTwitch & { expiraEn: number }>(); // token -> identidad

function limpiarEstadosCaducados(ahora = Date.now()) {
  for (const [clave, expiraEn] of estadosPendientes) {
    if (expiraEn < ahora) estadosPendientes.delete(clave);
  }
}

function limpiarSesionesCaducadas(ahora = Date.now()) {
  for (const [clave, fila] of sesionesActivas) {
    if (fila.expiraEn < ahora) sesionesActivas.delete(clave);
  }
}

export function credencialesConfiguradas(): boolean {
  return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_REDIRECT_URI);
}

export function generarUrlAutorizacion(): string {
  const state = crypto.randomBytes(16).toString("hex");
  limpiarEstadosCaducados();
  estadosPendientes.set(state, Date.now() + TTL_STATE_MS);
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID!,
    redirect_uri: process.env.TWITCH_REDIRECT_URI!,
    response_type: "code",
    scope: "", // identidad básica (id/login) no necesita ningún scope adicional
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

export function estadoValido(state: string | null): boolean {
  if (!state) return false;
  limpiarEstadosCaducados();
  const habia = estadosPendientes.has(state);
  estadosPendientes.delete(state); // un solo uso, tanto si es válido como si no
  return habia;
}

/** Intercambia el `code` de Twitch por la identidad real del jugador (id + login). */
export async function intercambiarCodigoPorIdentidad(code: string): Promise<IdentidadTwitch> {
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      client_secret: process.env.TWITCH_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.TWITCH_REDIRECT_URI!,
    }),
  });
  if (!r.ok) throw new Error(`Twitch OAuth token de usuario falló: ${r.status}`);
  const token = (await r.json()) as { access_token: string };

  const ru = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token.access_token}` },
  });
  if (!ru.ok) throw new Error(`Twitch Helix /users falló: ${ru.status}`);
  const datos = (await ru.json()) as { data: { id: string; login: string }[] };
  if (!datos.data[0]) throw new Error("Twitch no devolvió ningún usuario para ese token");
  return { twitchUserId: datos.data[0].id, twitchLogin: datos.data[0].login };
}

/** Guarda la identidad tras un token de sesión propio — nunca se expone el token de Twitch en sí. */
export function crearSesionTwitch(identidad: IdentidadTwitch): string {
  limpiarSesionesCaducadas();
  const token = crypto.randomBytes(24).toString("hex");
  sesionesActivas.set(token, { ...identidad, expiraEn: Date.now() + TTL_SESION_MS });
  return token;
}

/**
 * `RoomExteriorBase.crearJugador` la llama en CADA join (Hub, cruzar un
 * portal, entrar a una mazmorra/arena...) — NO se borra al leer (a
 * diferencia de un token de un solo uso): el cliente reusa el mismo token
 * mientras dure la pestaña, así que hace falta que siga sirviendo. Cada
 * resolución con éxito renueva el TTL (sliding expiration) para que una
 * sesión de directo larga no expire a mitad de stream. `null` si caducó o
 * nunca existió.
 */
export function resolverSesionTwitch(token: string): IdentidadTwitch | null {
  limpiarSesionesCaducadas();
  const fila = sesionesActivas.get(token);
  if (!fila) return null;
  fila.expiraEn = Date.now() + TTL_SESION_MS;
  return { twitchUserId: fila.twitchUserId, twitchLogin: fila.twitchLogin };
}
