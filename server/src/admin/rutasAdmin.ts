/**
 * Rutas HTTP planas del login de admin (docs/GDD_Admin.md, pedido
 * 2026-08-30) — MISMO criterio que `twitch/rutasOauth.ts`: sobre el mismo
 * `http.Server` que ya sirve el health check y el WebSocket de Colyseus,
 * sin Express, dos `if` sobre `req.url`. A diferencia del login de Twitch
 * (redirect-based), este es un login por contraseña propio: JSON in, JSON
 * out, sin redirecciones.
 *
 * POST /auth/admin/login            { usuario, password } -> { token, usuario, rol, mapaId }
 * POST /auth/admin/cambiar-password { token, passwordActual, passwordNueva } -> { ok: true }
 *
 * El login CON Twitch de una cuenta de admin no pasa por aquí: se resuelve
 * en `twitch/rutasOauth.ts` (mismo callback que ya usan los jugadores),
 * comprobando si el `twitch_login` que devuelve Twitch está vinculado en
 * `admin_cuentas` — así el streamer entra con su Twitch de siempre y de
 * paso entra como jarl/superadmin si su cuenta está vinculada.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { hashPassword, verificarPassword } from "./passwordHash";
import { crearSesionAdmin, resolverSesionAdmin, cerrarSesionesDeUsuario } from "./adminAuth";

const LONGITUD_MAXIMA_CUERPO = 64 * 1024; // 64KB de sobra para estos payloads, corta cualquier abuso
const LONGITUD_MINIMA_PASSWORD = 6;

function responderJson(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

/** Lee y parsea el cuerpo JSON de la petición. `null` si está vacío, es demasiado grande o no es JSON válido. */
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

/** `true` si esta petición era de /auth/admin/* y ya se respondió (o se está respondiendo async) — el llamante debe parar ahí. */
export function manejarPeticionAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/auth/admin/login" && req.method === "POST") {
    leerCuerpoJson<{ usuario?: string; password?: string }>(req).then(async (cuerpo) => {
      const usuario = cuerpo?.usuario?.trim();
      const password = cuerpo?.password;
      if (!usuario || !password) return responderJson(res, 400, { error: "falta usuario o password" });

      const bd = await obtenerBdCompartida();
      const cuenta = await bd.obtenerCuentaAdminPorUsuario(usuario);
      // Mismo mensaje de error tanto si el usuario no existe como si la
      // contraseña es incorrecta o la cuenta solo se loguea por Twitch
      // (passwordHash null) — no dar pistas de qué falló.
      if (!cuenta || !cuenta.passwordHash || !verificarPassword(password, cuenta.passwordHash)) {
        return responderJson(res, 401, { error: "usuario o contraseña incorrectos" });
      }
      const token = crearSesionAdmin({ usuario: cuenta.usuario, rol: cuenta.rol, mapaId: cuenta.mapaId });
      responderJson(res, 200, { token, usuario: cuenta.usuario, rol: cuenta.rol, mapaId: cuenta.mapaId });
    });
    return true;
  }

  if (url.pathname === "/auth/admin/cambiar-password" && req.method === "POST") {
    leerCuerpoJson<{ token?: string; passwordActual?: string; passwordNueva?: string }>(req).then(async (cuerpo) => {
      const token = cuerpo?.token;
      const passwordNueva = cuerpo?.passwordNueva;
      if (!token || !passwordNueva) return responderJson(res, 400, { error: "falta token o passwordNueva" });
      if (passwordNueva.length < LONGITUD_MINIMA_PASSWORD) {
        return responderJson(res, 400, { error: `la contraseña nueva debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres` });
      }

      const identidad = resolverSesionAdmin(token);
      if (!identidad) return responderJson(res, 401, { error: "sesión de admin caducada o inválida — vuelve a loguearte" });

      const bd = await obtenerBdCompartida();
      const cuenta = await bd.obtenerCuentaAdminPorUsuario(identidad.usuario);
      if (!cuenta) return responderJson(res, 404, { error: "cuenta de admin no encontrada" });

      // Si ya tenía contraseña propia, exige la actual. Si solo se logueaba
      // por Twitch (password_hash null), esto es "poner contraseña por
      // primera vez" — no hay nada que verificar contra.
      if (cuenta.passwordHash && !verificarPassword(cuerpo?.passwordActual ?? "", cuenta.passwordHash)) {
        return responderJson(res, 401, { error: "contraseña actual incorrecta" });
      }

      await bd.actualizarPasswordAdmin(cuenta.id, hashPassword(passwordNueva));
      cerrarSesionesDeUsuario(cuenta.usuario); // fuerza volver a loguearse en todas las pestañas
      responderJson(res, 200, { ok: true });
    });
    return true;
  }

  return false;
}
