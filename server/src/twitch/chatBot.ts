/**
 * Conector REAL de chat de Twitch (docs/GDD_Twitch.md, pedido 2026-08-30) —
 * IRC vía tmi.js, con una cuenta de BOT aparte (nunca la cuenta personal
 * del streamer, ver conversación de diseño: "cero dato tuyo para leer el
 * chat"). Feature-flag por variables de entorno — si no están puestas, esta
 * pieza simplemente no arranca (el resto del mecanismo sigue probándose por
 * `twitch:simularComando`/`twitch:simularCanje`, jarl-only).
 *
 * Roles de chat (mod/sub/tier/VIP) llegan GRATIS en los "badges" de cada
 * mensaje de IRC — sin ningún scope OAuth adicional, por eso `!curar` y los
 * títulos de rol pueden vivir aquí. Lo que NO llega por chat (seguidor,
 * bits, canjes de puntos de canal, tier real cuando el badge no lo detalla)
 * necesita autorización del streamer — pendiente, ver GDD §5.
 *
 * Variables de entorno:
 *   TWITCH_BOT_USERNAME — nombre de la cuenta de bot
 *   TWITCH_BOT_TOKEN     — token OAuth de ESA cuenta de bot (oauth:xxxxx),
 *                          se genera en https://twitchtokengenerator.com
 *                          (scope: chat:read) o la consola de desarrollador
 *                          de Twitch — NUNCA el token del streamer.
 *   TWITCH_CANAL          — canal a escuchar (nombre de usuario del streamer)
 */
import tmi from "tmi.js";
import { obtenerGestorTwitch } from "./gestorTwitch";

export function iniciarChatBot(): void {
  const usuario = process.env.TWITCH_BOT_USERNAME;
  const token = process.env.TWITCH_BOT_TOKEN;
  const canal = process.env.TWITCH_CANAL;
  if (!usuario || !token || !canal) {
    console.log("[twitch] Chat bot desactivado (falta TWITCH_BOT_USERNAME/TWITCH_BOT_TOKEN/TWITCH_CANAL) — solo disparadores de prueba (jarl).");
    return;
  }

  const client = new tmi.Client({
    identity: { username: usuario, password: token },
    channels: [canal],
  });

  const gestor = obtenerGestorTwitch();

  client.on("message", (_canal, userstate, mensaje, self) => {
    if (self) return; // ignora sus propios mensajes, si el bot llegara a escribir algo
    const nombreTwitch = userstate["display-name"] ?? userstate.username;
    if (!nombreTwitch) return;

    // Roles directos de los badges de IRC — sin llamada a Helix, sin scope
    // adicional (docs/GDD_Twitch.md §2). "founder"/"subscriber" ambos cuentan
    // como sub — Twitch marca a los fundadores con su propio badge aparte.
    // NOTA: el tier EXACTO (1/2/3) no viaja de forma fiable en los badges de
    // chat (el valor del badge "subscriber" codifica meses de antigüedad,
    // no el tier) — se deja en 1 para cualquier sub por ahora; distinguir
    // tier de verdad necesita Helix (docs/GDD_Twitch.md §5, pendiente).
    const esSub = !!userstate.subscriber || !!userstate.badges?.founder;
    gestor.actualizarRol(nombreTwitch, {
      esMod: !!userstate.mod,
      esVip: !!userstate.badges?.vip,
      esSub,
      tierSub: esSub ? 1 : 0,
    });

    gestor.manejarComandoChat(nombreTwitch, mensaje);
  });

  client.connect().catch((err) => console.error("[twitch] No se pudo conectar el chat bot:", err));
  console.log(`[twitch] Chat bot conectado al canal "${canal}" como "${usuario}".`);
}
