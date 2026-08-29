/**
 * Detección de "¿está el streamer en directo?" (docs/GDD_Twitch.md, pedido
 * 2026-08-30: "que se active solo cuando entre en directo") — INFORMACIÓN
 * PÚBLICA de Twitch, cero dato/autorización del streamer: se pide con un
 * token de APLICACIÓN (client credentials, `TWITCH_CLIENT_ID`+
 * `TWITCH_CLIENT_SECRET` del proyecto, no de su cuenta).
 *
 * Sondeo cada `INTERVALO_MS` (no EventSub — evita tener que exponer un
 * receptor de webhooks públicos solo para esto) — barato de sobra para el
 * volumen de peticiones (regla CLAUDE.md "optimizado para gratis": un
 * request cada par de minutos, nunca por tick).
 */
const INTERVALO_MS = 2 * 60_000;

interface TokenApp {
  valor: string;
  expiraEn: number; // epoch ms
}

let tokenCache: TokenApp | null = null;

async function obtenerTokenApp(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiraEn > Date.now() + 60_000) return tokenCache.valor;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!r.ok) throw new Error(`Twitch OAuth token de app falló: ${r.status}`);
  const datos = (await r.json()) as { access_token: string; expires_in: number };
  tokenCache = { valor: datos.access_token, expiraEn: Date.now() + datos.expires_in * 1000 };
  return tokenCache.valor;
}

async function comprobarEnDirecto(clientId: string, clientSecret: string, canal: string): Promise<boolean> {
  const token = await obtenerTokenApp(clientId, clientSecret);
  const r = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(canal)}`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Twitch Helix /streams falló: ${r.status}`);
  const datos = (await r.json()) as { data: unknown[] };
  return datos.data.length > 0;
}

/** Arranca el sondeo si hay credenciales — si no, `gestorTwitch` ya asume "en directo" siempre (modo prueba), ver su constructor. */
export function iniciarDeteccionDirecto(fijarEnDirecto: (valor: boolean) => void): void {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const canal = process.env.TWITCH_CANAL;
  if (!clientId || !clientSecret || !canal) return; // sin credenciales: nada que sondear, gestorTwitch ya avisó por consola

  const sondear = () => {
    comprobarEnDirecto(clientId, clientSecret, canal)
      .then(fijarEnDirecto)
      .catch((err) => console.error("[twitch] comprobación de directo falló (se reintenta en el próximo sondeo):", err));
  };
  sondear();
  setInterval(sondear, INTERVALO_MS).unref();
}
