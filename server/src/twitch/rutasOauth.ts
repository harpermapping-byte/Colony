/**
 * Rutas HTTP planas del login con Twitch (docs/GDD_Twitch.md §7) — sobre el
 * MISMO `http.Server` que ya sirve el health check y el WebSocket de
 * Colyseus (regla CLAUDE.md "un solo proceso"), sin Express ni ningún
 * framework nuevo: dos `if` sobre `req.url`, nada más.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  credencialesConfiguradas,
  crearSesionTwitch,
  estadoValido,
  generarUrlAutorizacion,
  intercambiarCodigoPorIdentidad,
} from "./oauthLogin";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173"; // puerto por defecto de Vite en dev

function redirigir(res: ServerResponse, url: string) {
  res.writeHead(302, { Location: url });
  res.end();
}

/** `true` si esta petición era de /auth/twitch/* y ya se respondió — el llamante debe parar ahí. */
export function manejarPeticionLoginTwitch(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/auth/twitch/login") {
    if (!credencialesConfiguradas()) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Login con Twitch no configurado en este servidor (faltan TWITCH_CLIENT_ID/SECRET/TWITCH_REDIRECT_URI).");
      return true;
    }
    redirigir(res, generarUrlAutorizacion());
    return true;
  }

  if (url.pathname === "/auth/twitch/callback") {
    if (!estadoValido(url.searchParams.get("state"))) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Enlace de login caducado o inválido — vuelve a intentarlo desde el juego.");
      return true;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Twitch no mandó código de autorización.");
      return true;
    }
    intercambiarCodigoPorIdentidad(code)
      .then((identidad) => {
        const token = crearSesionTwitch(identidad);
        const destino = new URL(CLIENT_URL);
        destino.searchParams.set("twitchSession", token);
        destino.searchParams.set("twitchLogin", identidad.twitchLogin);
        redirigir(res, destino.toString());
      })
      .catch((err) => {
        console.error("[twitch] login falló:", err);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("No se pudo completar el login con Twitch — vuelve a intentarlo.");
      });
    return true;
  }

  return false;
}
