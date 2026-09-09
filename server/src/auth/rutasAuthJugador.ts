/**
 * Rutas HTTP planas del login de JUGADOR (pedido streamer 2026-09-09,
 * "cuentas por contraseña") — MISMO criterio que `admin/rutasAdmin.ts`:
 * sobre el mismo `http.Server` que ya sirve el health check y el WebSocket
 * de Colyseus, sin Express, JSON in/JSON out, sin redirecciones.
 *
 * POST /auth/jugador/registro { nombre, password } -> { token, nombre }
 * POST /auth/jugador/login    { nombre, password } -> { token, nombre }
 *
 * "registro" cubre DOS casos con el mismo endpoint (menos superficie que
 * separar "crear"/"reclamar"): el nombre no existía todavía → nace un
 * personaje nuevo con esa contraseña (mismo `obtenerOCrearJugador` de
 * siempre); el nombre ya existía SIN contraseña (personaje "legado" de
 * antes de este sistema, identificado solo por nombre) → se reclama
 * fijándole la contraseña. Si ya existía CON contraseña, error: ese nombre
 * ya es una cuenta de otra persona.
 *
 * Sin sesión ninguna (`playerSession` ausente en el join), el flujo de
 * siempre sigue intacto — nombre libre por `?nombre=` en la URL, usado hoy
 * por toda la suite de tests e2e y por cualquier invitado que no se loguee.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { hashPassword, verificarPassword } from "../admin/passwordHash";
import { crearSesionJugador } from "./jugadorAuth";

const LONGITUD_MAXIMA_CUERPO = 64 * 1024;
const LONGITUD_MINIMA_PASSWORD = 6;
const LONGITUD_MAXIMA_NOMBRE = 20; // RoomExteriorBase.crearJugador trunca player.name a 20 — evita la sorpresa de "mi nombre no es el que registré"

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

function conCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", CLIENT_URL);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function responderJson(res: ServerResponse, status: number, cuerpo: unknown) {
  conCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpoJson<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const trozos: Buffer[] = [];
    let bytes = 0;
    let excedido = false;
    req.on("data", (trozo: Buffer) => {
      bytes += trozo.length;
      if (bytes > LONGITUD_MAXIMA_CUERPO) {
        excedido = true;
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on("end", () => {
      if (excedido) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(trozos).toString("utf8")) as T);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function validarNombreYPassword(nombre: string | undefined, password: string | undefined): string | null {
  if (!nombre || !password) return "falta nombre o password";
  if (nombre.trim().length === 0 || nombre.length > LONGITUD_MAXIMA_NOMBRE) return `el nombre debe tener entre 1 y ${LONGITUD_MAXIMA_NOMBRE} caracteres`;
  if (password.length < LONGITUD_MINIMA_PASSWORD) return `la contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres`;
  return null;
}

/** `true` si esta petición era de /auth/jugador/* y ya se respondió (o se está respondiendo async) — el llamante debe parar ahí. */
export function manejarPeticionAuthJugador(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/auth/jugador/")) return false;

  if (req.method === "OPTIONS") {
    conCors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (url.pathname === "/auth/jugador/registro" && req.method === "POST") {
    leerCuerpoJson<{ nombre?: string; password?: string }>(req).then(async (cuerpo) => {
      const nombre = cuerpo?.nombre?.trim();
      const password = cuerpo?.password;
      const error = validarNombreYPassword(nombre, password);
      if (error) return responderJson(res, 400, { error });

      const bd = await obtenerBdCompartida();
      const credenciales = await bd.obtenerCredencialesJugador(nombre!);
      if (credenciales && credenciales.passwordHash) {
        return responderJson(res, 409, { error: "ese nombre ya tiene una cuenta — si es tuyo, inicia sesión en vez de crear una cuenta nueva" });
      }

      // Sin fila todavía (personaje nuevo) o fila "legado" sin password (se reclama) — mismo primitivo de siempre.
      const jugador = await bd.obtenerOCrearJugador(nombre!);
      await bd.establecerPasswordJugador(jugador.id, hashPassword(password!));
      const token = crearSesionJugador({ jugadorId: jugador.id, nombre: jugador.nombre });
      responderJson(res, 200, { token, nombre: jugador.nombre });
    });
    return true;
  }

  if (url.pathname === "/auth/jugador/login" && req.method === "POST") {
    leerCuerpoJson<{ nombre?: string; password?: string }>(req).then(async (cuerpo) => {
      const nombre = cuerpo?.nombre?.trim();
      const password = cuerpo?.password;
      if (!nombre || !password) return responderJson(res, 400, { error: "falta nombre o password" });

      const bd = await obtenerBdCompartida();
      const credenciales = await bd.obtenerCredencialesJugador(nombre);
      if (!credenciales || !credenciales.passwordHash) {
        // Mismo nombre puede existir "legado" sin contraseña todavía — distinto
        // de "no existe" para no mandar a alguien con personaje real a crear
        // uno nuevo sin darse cuenta (perdería su progreso), pero SIN
        // confirmar por email/nombre si el personaje existe de verdad más
        // allá de esto (el nombre de personaje ya es público en el juego).
        return responderJson(res, 404, { error: "ese nombre no tiene contraseña todavía — usa 'Crear cuenta' para reclamarlo o registrar uno nuevo" });
      }
      if (!verificarPassword(password, credenciales.passwordHash)) {
        return responderJson(res, 401, { error: "nombre o contraseña incorrectos" });
      }
      const token = crearSesionJugador({ jugadorId: credenciales.id, nombre });
      responderJson(res, 200, { token, nombre });
    });
    return true;
  }

  return false;
}
