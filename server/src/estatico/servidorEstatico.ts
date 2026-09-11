/**
 * Sirve el build estático del CLIENTE desde el MISMO proceso Node que ya
 * corre Colyseus (pedido streamer 2026-09-09: dejar Vercel — le iban a
 * cobrar — y mover cliente + servidor a su propio PC, que ya hospeda el
 * servidor 24/7 vía PM2 + Cloudflare Tunnel).
 *
 * Por qué en el mismo proceso y no un segundo servidor de archivos aparte:
 * menos piezas que arrancar/vigilar/romper (un solo PM2, un solo túnel, un
 * solo dominio) y, de regalo, cliente y servidor quedan en el MISMO ORIGEN —
 * así `client/src/config.ts` puede derivar la URL del WebSocket de
 * `location.host` y nunca más hace falta configurar `VITE_COLYSEUS_URL` en
 * producción.
 *
 * Cero conflicto con Colyseus: el upgrade de WebSocket viaja por el evento
 * "upgrade" del `http.Server`, que es DISTINTO del evento "request" que
 * atiende este handler — servir "/" como HTML no le quita nada al WS.
 *
 * Cada archivo se sirve con `createReadStream(...).pipe(res)`, nunca se lee
 * entero a memoria: un sector del mapa principal pesa varios MB y hay cientos
 * — bufferizarlos convertiría cada oleada de streaming de sectores en un pico
 * de heap del proceso que además comparte con el estado vivo de las rooms.
 *
 * MISMO criterio que `twitch/rutasOauth.ts`/`admin/rutasAdmin.ts`: sin
 * Express, una función que devuelve `true` si ya ha respondido.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// Ruta calculada desde ESTE archivo (no desde index.ts) para que no dependa
// de dónde se importe: compilado a `server/dist/estatico/servidorEstatico.js`
// (tsconfig: outDir "dist", rootDir "src"), así que tres ".." llegan a la
// raíz del repo y de ahí a `client/dist`. Ese build YA incluye una copia
// completa de `assets/` en `client/dist/assets/` — la hace `closeBundle` de
// `client/vite.config.ts::servirAssetsRaiz` tras cada `vite build`.
const RAIZ_REPO = join(__dirname, "..", "..", "..");
const CARPETA_CLIENTE_DIST = join(RAIZ_REPO, "client", "dist");

// `/assets/**` (mapas bakeados, .glb, texturas) se sirve DIRECTO desde la
// carpeta del repo, no desde la copia que `vite build` deja en
// client/dist/assets/. Dos motivos, los dos operativos:
//   1) son 343MB — duplicarlos en cada build es tiempo y disco a cambio de
//      nada cuando el servidor vive dentro del propio repo clonado;
//   2) un rehorneado de mapa (que en este proyecto pasa a menudo) entra en
//      vivo con un simple `git pull`, sin recompilar el cliente y sin
//      reiniciar a nadie.
// Es además EXACTAMENTE lo que ya hace el `vite dev` (client/vite.config.ts::
// servirAssetsRaiz), así que desarrollo y producción sirven lo mismo desde el
// mismo sitio. La copia de client/dist/assets/ se queda intacta y sin usar:
// mantiene válido el build para un hosting estático si algún día hiciera
// falta.
const CARPETA_ASSETS_RAIZ = join(RAIZ_REPO, "assets");

const TIPOS_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/**
 * Mismas reglas de caché que tenía `client/vercel.json` (que deja de aplicar
 * al salir de Vercel): arte que solo cambia cuando se regenera a mano, un
 * día; bakes de mapa, una hora (se rehornean de vez en cuando — Vetrheim ya
 * se ha rehorneado varias veces esta semana). NUNCA `immutable` en assets:
 * un .glb regenerado EN SITIO con el mismo nombre se quedaría pegado viejo
 * en el navegador del jugador para siempre.
 *
 * Excepción: `/_bundle/` son los chunks del propio Vite, con hash de
 * contenido en el nombre (`build.assetsDir` en client/vite.config.ts) — ahí
 * `immutable` sí es correcto, un cambio de contenido cambia el nombre.
 */
const CATEGORIAS_ARTE = /^\/assets\/(vegetacion|rocas|edificios|interiores|herramientas|armas|objetos|personajes|animales|enemigos)\//;

function cacheControlPara(rutaUrl: string): string | null {
  if (rutaUrl.startsWith("/_bundle/")) return "public, max-age=31536000, immutable";
  if (rutaUrl.startsWith("/assets/mapas/")) return "public, max-age=3600, stale-while-revalidate=86400";
  if (CATEGORIAS_ARTE.test(rutaUrl)) return "public, max-age=86400, stale-while-revalidate=604800";
  return null;
}

/** `true` si hay un build del cliente que servir. Se consulta en cada petición porque el build puede aparecer/regenerarse con el proceso ya en marcha (autoActualizar.ps1 reconstruye el cliente EN CALIENTE, sin reiniciar PM2). */
function hayBuildDelCliente(): boolean {
  return existsSync(join(CARPETA_CLIENTE_DIST, "index.html"));
}

/**
 * 404 de verdad, en vez de dejar caer la petición al health check de
 * `index.ts` (que responde 200 "Streamer Colony server OK" a cualquier
 * ruta): el cliente comprueba `response.ok` antes de parsear un .glb o un
 * JSON de sector, así que un 200 con texto plano se interpretaría como
 * "existe" y reventaría al parsearlo, en vez de caer limpiamente al
 * placeholder como está diseñado (ver entityLoader.ts).
 */
function responder404(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(req.method === "HEAD" ? undefined : "404 — no encontrado");
}

export function manejarPeticionEstatica(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!hayBuildDelCliente()) return false;

  let rutaUrl: string;
  try {
    rutaUrl = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    // %-encoding inválido: decodeURIComponent lanza. Nunca lo manda un
    // cliente legítimo del juego.
    responder404(req, res);
    return true;
  }
  // `join` normaliza los ".." y el `startsWith` corta cualquier intento de
  // salir de la carpeta — mismo patrón ya usado por `servirAssetsRaiz()` en
  // client/vite.config.ts para la carpeta de assets del repo.
  const enAssets = rutaUrl.startsWith("/assets/");
  const carpetaBase = enAssets ? CARPETA_ASSETS_RAIZ : CARPETA_CLIENTE_DIST;
  let archivo = enAssets
    ? join(CARPETA_ASSETS_RAIZ, rutaUrl.slice("/assets".length))
    : join(CARPETA_CLIENTE_DIST, rutaUrl);
  if (!archivo.startsWith(carpetaBase)) {
    responder404(req, res);
    return true;
  }

  let esIndex = false;
  if (!existsSync(archivo) || statSync(archivo).isDirectory()) {
    // Sin extensión ("/" o una ruta de la SPA) → index.html. CON extensión
    // que no existe (un .glb/.js que falta) → 404 de verdad. Y bajo
    // /assets/** SIEMPRE 404 aunque no traiga extensión: ahí nunca hay
    // rutas de SPA, solo archivos.
    if (enAssets || extname(rutaUrl)) {
      responder404(req, res);
      return true;
    }
    archivo = join(CARPETA_CLIENTE_DIST, "index.html");
    esIndex = true;
  }

  const extension = extname(archivo);
  const cabeceras: Record<string, string> = {
    "Content-Type": TIPOS_MIME[extension] || "application/octet-stream",
  };
  // index.html referencia los chunks con hash: si se cachea, un jugador
  // seguiría pidiendo el bundle viejo tras un despliegue.
  const cache = esIndex || extension === ".html" ? "no-cache" : cacheControlPara(rutaUrl);
  if (cache) cabeceras["Cache-Control"] = cache;

  res.writeHead(200, cabeceras);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const flujo = createReadStream(archivo);
  // Un jugador que cierra la pestaña a mitad de descargar un sector aborta
  // la respuesta: sin esto el stream queda abierto (fuga de descriptores).
  res.on("close", () => flujo.destroy());
  flujo.on("error", () => res.destroy());
  flujo.pipe(res);
  return true;
}

/** Solo para el log de arranque: dice dónde busca el cliente y si lo encontró. */
export function estadoBuildDelCliente(): { carpeta: string; existe: boolean } {
  return { carpeta: CARPETA_CLIENTE_DIST, existe: hayBuildDelCliente() };
}
