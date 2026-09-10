// URL del servidor Colyseus por entorno, en orden de prioridad:
// 1) VITE_COLYSEUS_URL si está definida (override explícito: sigue haciendo
//    falta para apuntar a un servidor que NO sea el que sirve esta página);
// 2) en desarrollo (página servida desde localhost/IP privada, típicamente el
//    `vite dev` en :5173) → el servidor local de siempre en :2567;
// 3) en producción → MISMO ORIGEN que la página. Desde 2026-09-09 el cliente
//    lo sirve el propio proceso Node del servidor (pedido streamer: fuera
//    Vercel, todo desde su PC — ver server/src/estatico/servidorEstatico.ts),
//    así que el WebSocket vive en el mismo host/puerto que el HTML y basta
//    con derivar el protocolo (https → wss, http → ws). Nunca más hace falta
//    configurar una variable de entorno en producción, ni un dominio a fuego
//    que se quede obsoleto: el fallback anterior apuntaba a un servicio de
//    Render ya apagado y daba "no se pudo conectar con el servidor".
const esLocal =
  typeof location !== "undefined" && /^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);

function urlDelMismoOrigen(): string {
  // `location` no existe en un test de Node puro; ahí nunca se llega aquí
  // (esLocal cae a la rama local), pero el fallback mantiene el tipo sano.
  if (typeof location === "undefined") return "ws://localhost:2567";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
}

export const SERVER_URL =
  import.meta.env.VITE_COLYSEUS_URL || (esLocal ? "ws://localhost:2567" : urlDelMismoOrigen());
