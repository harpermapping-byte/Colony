import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync, statSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, extname } from "node:path";

// `assets/` (modelos .glb, texturas de terreno) vive en la RAIZ del repo,
// no dentro de `client/` — es la misma carpeta que ya usa el bakeador de
// exteriores (ver `assets/README.md`), así que el cliente la sirve desde
// ahí en vez de duplicarla dentro de `client/public/`. Sin depender de
// ningún paquete nuevo: middleware manual en dev, copia manual tras el
// build de producción.
const CARPETA_ASSETS_RAIZ = join(__dirname, "..", "assets");

const TIPOS_MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".json": "application/json",
};

function servirAssetsRaiz(): Plugin {
  return {
    name: "servir-assets-raiz",
    configureServer(server) {
      server.middlewares.use("/assets", (req, res, next) => {
        const ruta = decodeURIComponent((req.url || "").split("?")[0]);
        const archivo = join(CARPETA_ASSETS_RAIZ, ruta);
        if (!archivo.startsWith(CARPETA_ASSETS_RAIZ) || !existsSync(archivo) || !statSync(archivo).isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", TIPOS_MIME[extname(archivo)] || "application/octet-stream");
        createReadStream(archivo).pipe(res);
      });
    },
    closeBundle() {
      // Copia recursiva simple a dist/assets tras el build de producción.
      const destino = join(__dirname, "dist", "assets");
      function copiarRecursivo(origen: string, destino: string) {
        mkdirSync(destino, { recursive: true });
        for (const entrada of readdirSync(origen, { withFileTypes: true })) {
          const origenHijo = join(origen, entrada.name);
          const destinoHijo = join(destino, entrada.name);
          if (entrada.isDirectory()) copiarRecursivo(origenHijo, destinoHijo);
          else copyFileSync(origenHijo, destinoHijo);
        }
      }
      if (existsSync(CARPETA_ASSETS_RAIZ)) copiarRecursivo(CARPETA_ASSETS_RAIZ, destino);
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [join(__dirname, ".."), __dirname] },
    // Vite 5+ bloquea por defecto cualquier Host desconocido (protección
    // contra DNS rebinding) — sin esto, entrar por un túnel público
    // (cloudflared, ngrok...) para probar en red con otro jugador da
    // "Blocked request. This host is not allowed" (encontrado probando la
    // Test Zone 2026-08-31). Solo aplica en dev (`npm run dev:client`); el
    // build de producción servido por Vercel no pasa por aquí.
    allowedHosts: true,
  },
  // Los chunks propios del bundler van a dist/_bundle en vez de al
  // dist/assets por defecto de Vite — ese nombre lo reservamos para la
  // copia de la carpeta `assets/` del repo (glb/texturas), para que no se
  // mezclen ni puedan pisarse entre sí.
  build: { assetsDir: "_bundle" },
  plugins: [servirAssetsRaiz()],
});
