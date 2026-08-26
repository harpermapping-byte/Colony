#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const { generarMapa, cargarCatalogos } = require("../src/generar");

const RAIZ_BAKER = path.join(__dirname, "..");
const PUERTO = Number(process.env.PUERTO) || 4000;

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function abrirNavegador(url) {
  const comando = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(comando, () => {}); // si falla, el usuario simplemente abre la URL a mano — no es crítico
}

function leerCuerpoJSON(req) {
  return new Promise((resolve, reject) => {
    let datos = "";
    req.on("data", (trozo) => (datos += trozo));
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function servirArchivoEstatico(res, rutaAbsoluta) {
  fs.readFile(rutaAbsoluta, (err, contenido) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado: " + rutaAbsoluta);
      return;
    }
    const ext = path.extname(rutaAbsoluta);
    res.writeHead(200, { "Content-Type": TIPOS_MIME[ext] || "application/octet-stream" });
    res.end(contenido);
  });
}

function listarMapasGenerados() {
  const carpetaOutput = path.join(RAIZ_BAKER, "output");
  if (!fs.existsSync(carpetaOutput)) return [];
  return fs
    .readdirSync(carpetaOutput, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(carpetaOutput, d.name, "indice.json")))
    .map((d) => d.name);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);

  // --- API ---
  if (url.pathname === "/api/opciones" && req.method === "GET") {
    const catalogos = cargarCatalogos();
    const biomas = Object.entries(catalogos.biomas)
      .filter(([id]) => !id.startsWith("_"))
      .map(([id, datos]) => ({
        id,
        habilitadoPorDefecto: !!datos.habilitadoPorDefecto,
        requiereVulcanismo: !!datos.requiereVulcanismo,
      }));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ biomas }));
    return;
  }

  if (url.pathname === "/api/mapas" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ mapas: listarMapasGenerados() }));
    return;
  }

  if (url.pathname === "/api/generar" && req.method === "POST") {
    let config;
    try {
      config = await leerCuerpoJSON(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Config inválida: " + e.message);
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const enviar = (evento, datos) => {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
    };

    try {
      const resultado = generarMapa(config, {
        onProgreso: (mensaje) => enviar("progreso", { mensaje }),
      });
      enviar("fin", { ok: true, ...resultado });
    } catch (e) {
      enviar("fin", { ok: false, error: e.message });
    }
    res.end();
    return;
  }

  if (url.pathname === "/api/apagar" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Adiós.");
    setTimeout(() => process.exit(0), 200);
    return;
  }

  // --- Archivos estáticos: la GUI, el visor, y los mapas ya generados ---
  let rutaPedida = decodeURIComponent(url.pathname);
  if (rutaPedida === "/") rutaPedida = "/gui/index.html";

  const rutaAbsoluta = path.normalize(path.join(RAIZ_BAKER, rutaPedida));
  if (!rutaAbsoluta.startsWith(RAIZ_BAKER)) {
    res.writeHead(403);
    res.end("Prohibido");
    return;
  }
  servirArchivoEstatico(res, rutaAbsoluta);
});

servidor.listen(PUERTO, () => {
  const url = `http://localhost:${PUERTO}/`;
  console.log(`Interfaz del bakeador en ${url}`);
  console.log("(esta ventana debe quedarse abierta mientras la usas — para cerrar todo, pulsa \"Cerrar\" en la página, o cierra esta ventana)");
  abrirNavegador(url);
});
