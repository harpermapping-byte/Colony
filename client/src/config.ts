// URL del servidor Colyseus por entorno, en orden de prioridad:
// 1) VITE_COLYSEUS_URL si está definida (dashboard de Vercel o build local);
// 2) en desarrollo (página servida desde localhost/IP privada) → el servidor
//    local de siempre;
// 3) en producción (cualquier otro host, p.ej. el estático de Vercel) → el
//    servicio Node de Render, con wss porque la página va por https.
// Así el deploy de Vercel funciona sin configurar nada en su dashboard, y
// los tests E2E (siempre en localhost) siguen yendo al servidor local.
const esLocal =
  typeof location !== "undefined" && /^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);
export const SERVER_URL =
  import.meta.env.VITE_COLYSEUS_URL || (esLocal ? "ws://localhost:2567" : "wss://colony-server.onrender.com");
