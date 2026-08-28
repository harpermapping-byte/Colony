#!/usr/bin/env node
"use strict";

// Herramienta admin de PARCELAS (GDD_Construccion §1) — mismo patrón que
// interiores/gui/servidor.js: http plano sin dependencias, estáticos + API
// JSON. Diferencia clave: aquí el servidor NO tiene estado en memoria — la
// verdad es assets/mapas/principal/parcelas.json (o el mapa de RUTA_MAPA) y
// cada GET lo lee / cada POST lo re-valida y escribe.
//
// El módulo también se usa por require() (generar_demo.js y los tests
// necesitan el MISMO lector de mapa y la MISMA validación que aplica el
// POST): solo escucha si se ejecuta directamente (require.main).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const Mascara = require("../src/mascara");
const { terrenoVetado } = require("../src/varita");

const RAIZ_GUI = __dirname;
const RAIZ_REPO = path.join(__dirname, "..", "..");
const PUERTO = Number(process.env.PUERTO) || 4200;
// RUTA_MAPA: carpeta del mapa bakeado (indice.json + sectores + parcelas.json).
// Relativa a la raíz del repo si no es absoluta, para que `RUTA_MAPA=assets/mapas/demo`
// funcione desde cualquier cwd.
const RUTA_MAPA = path.resolve(RAIZ_REPO, process.env.RUTA_MAPA || "assets/mapas/principal");
const RUTA_PARCELAS = path.join(RUTA_MAPA, "parcelas.json");
const RUTA_TERRENOS = path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json");

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

// ---------------------------------------------------------------------------
// Lector de mapa bakeado (lado servidor). Carga sectores BAJO DEMANDA y los
// cachea — el mapa principal son 100 sectores/70MB y la validación de un
// parcelas.json normal solo toca 1-4 de ellos. Espejo en Node de lo que hace
// client/src/mapa/formatoMapa.ts: terreno = 1 carácter base36 por casilla →
// índice en leyendaTerreno del indice.json.
// ---------------------------------------------------------------------------
function crearLectorMapa(rutaMapa) {
  const indice = JSON.parse(fs.readFileSync(path.join(rutaMapa, "indice.json"), "utf8"));
  const tamChunk = indice.tamanoChunk;
  const tamSector = indice.tamanoSectorChunks;
  const anchoMapa = indice.anchoChunks * tamChunk;
  const altoMapa = indice.altoChunks * tamChunk;
  const sectores = new Map(); // "sx_sy" -> sector cargado (o null si no existe el archivo)

  const pad3 = (n) => String(n).padStart(3, "0");

  function sectorDe(sx, sy) {
    const k = `${sx}_${sy}`;
    if (!sectores.has(k)) {
      const ruta = path.join(rutaMapa, `sector_${pad3(sx)}_${pad3(sy)}.json`);
      sectores.set(k, fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : null);
    }
    return sectores.get(k);
  }

  /** Id de terreno de la casilla global (x,y); null si está fuera del mapa o falta el sector. */
  function terrenoEn(x, y) {
    if (x < 0 || y < 0 || x >= anchoMapa || y >= altoMapa) return null;
    const cx = Math.floor(x / tamChunk);
    const cy = Math.floor(y / tamChunk);
    const sector = sectorDe(Math.floor(cx / tamSector), Math.floor(cy / tamSector));
    const chunk = sector && sector.chunks[`${cx}_${cy}`];
    if (!chunk) return null;
    const c = chunk.terreno[(y - cy * tamChunk) * tamChunk + (x - cx * tamChunk)];
    return indice.leyendaTerreno[parseInt(c, 36)] ?? indice.leyendaTerreno[0];
  }

  return { indice, anchoMapa, altoMapa, terrenoEn };
}

// ---------------------------------------------------------------------------
// Validación de un parcelas.json contra el mapa (la que re-aplica el POST,
// GDD §1: el servidor nunca se fía de la GUI). Devuelve { ok } o
// { ok:false, motivo } con la primera infracción encontrada.
// ---------------------------------------------------------------------------
function validarParcelas(datos, lector, terrenos) {
  if (!datos || typeof datos !== "object" || typeof datos.parcelas !== "object") {
    return { ok: false, motivo: "formato inválido: falta el objeto `parcelas`" };
  }
  const ocupadas = new Map(); // clave numérica -> parcelaId, para detectar solapes
  for (const [id, parcela] of Object.entries(datos.parcelas)) {
    if (!Array.isArray(parcela.runs)) return { ok: false, motivo: `${id}: falta \`runs\`` };
    let contadas = 0;
    for (const run of parcela.runs) {
      const [y, x0, x1] = run;
      if (!Number.isInteger(y) || !Number.isInteger(x0) || !Number.isInteger(x1) || x1 < x0) {
        return { ok: false, motivo: `${id}: run inválido ${JSON.stringify(run)}` };
      }
      for (let x = x0; x <= x1; x++) {
        contadas++;
        const terreno = lector.terrenoEn(x, y);
        if (terreno === null) return { ok: false, motivo: `${id}: casilla (${x},${y}) fuera del mapa` };
        if (terrenoVetado(terreno, terrenos[terreno])) {
          return { ok: false, motivo: `${id}: casilla (${x},${y}) vetada (terreno \`${terreno}\`)` };
        }
        const k = Mascara.clave(x, y, lector.anchoMapa);
        const otra = ocupadas.get(k);
        if (otra) return { ok: false, motivo: `${id}: casilla (${x},${y}) solapa con ${otra}` };
        ocupadas.set(k, id);
      }
    }
    // Los campos cacheados (§1) tienen que ser coherentes con los runs: si la
    // GUI mandara un `casillas` desfasado, el resto de consumidores (tope de
    // props del servidor de juego) operarían con un dato falso.
    if (parcela.casillas !== contadas) {
      return { ok: false, motivo: `${id}: \`casillas\` dice ${parcela.casillas} pero los runs suman ${contadas}` };
    }
    if (!Number.isInteger(parcela.topeProps) || parcela.topeProps < 0) {
      return { ok: false, motivo: `${id}: \`topeProps\` inválido` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------
function responderJSON(res, codigo, datos) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(datos));
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

function servirArchivo(res, rutaAbsoluta) {
  fs.readFile(rutaAbsoluta, (err, contenido) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("No encontrado: " + rutaAbsoluta);
    }
    res.writeHead(200, { "Content-Type": TIPOS_MIME[path.extname(rutaAbsoluta)] || "application/octet-stream" });
    res.end(contenido);
  });
}

// Estático confinado a una raíz (mismo truco anti-escape que interiores).
function servirBajoRaiz(res, raiz, rutaRelativa) {
  const rutaAbsoluta = path.normalize(path.join(raiz, rutaRelativa));
  if (!rutaAbsoluta.startsWith(raiz)) {
    res.writeHead(403);
    return res.end("Prohibido");
  }
  servirArchivo(res, rutaAbsoluta);
}

function crearServidor() {
  const lector = crearLectorMapa(RUTA_MAPA);
  const terrenos = JSON.parse(fs.readFileSync(RUTA_TERRENOS, "utf8"));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PUERTO}`);
    try {
      // Colores/reglas de terreno: la GUI los pide aquí, no los duplica (regla 2).
      if (url.pathname === "/api/catalogo/terrenos" && req.method === "GET") {
        return responderJSON(res, 200, terrenos);
      }

      if (url.pathname === "/api/parcelas" && req.method === "GET") {
        const datos = fs.existsSync(RUTA_PARCELAS)
          ? JSON.parse(fs.readFileSync(RUTA_PARCELAS, "utf8"))
          : { version: 1, mapa: lector.indice.nombre, siguienteId: 1, parcelas: {} };
        return responderJSON(res, 200, { ok: true, datos, rutaMapa: "/mapa" });
      }

      if (url.pathname === "/api/parcelas" && req.method === "POST") {
        const datos = await leerCuerpoJSON(req);
        const veredicto = validarParcelas(datos, lector, terrenos);
        if (!veredicto.ok) return responderJSON(res, 400, veredicto);
        fs.writeFileSync(RUTA_PARCELAS, JSON.stringify(datos, null, 2) + "\n");
        return responderJSON(res, 200, { ok: true, archivo: RUTA_PARCELAS });
      }

      // El mapa activo (respeta RUTA_MAPA) — la GUI pide /mapa/indice.json y
      // /mapa/sector_XXX_YYY.json sin saber dónde vive en disco.
      if (url.pathname.startsWith("/mapa/") && req.method === "GET") {
        return servirBajoRaiz(res, RUTA_MAPA, decodeURIComponent(url.pathname.slice("/mapa".length)));
      }

      // Assets del repo (por si la GUI quiere overview.png u otros mapas).
      if (url.pathname.startsWith("/assets/") && req.method === "GET") {
        return servirBajoRaiz(res, path.join(RAIZ_REPO, "assets"), decodeURIComponent(url.pathname.slice("/assets".length)));
      }

      // mascara.js/varita.js compartidos con el navegador tal cual.
      if (url.pathname.startsWith("/src/") && req.method === "GET") {
        return servirBajoRaiz(res, path.join(RAIZ_GUI, "..", "src"), decodeURIComponent(url.pathname.slice("/src".length)));
      }

      let rutaPedida = decodeURIComponent(url.pathname);
      if (rutaPedida === "/") rutaPedida = "/index.html";
      servirBajoRaiz(res, RAIZ_GUI, rutaPedida);
    } catch (e) {
      responderJSON(res, 500, { ok: false, motivo: e.message });
    }
  });
}

function abrirNavegador(url) {
  const comando = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(comando, () => {});
}

if (require.main === module) {
  crearServidor().listen(PUERTO, () => {
    const url = `http://localhost:${PUERTO}/`;
    console.log(`Editor de parcelas en ${url} (mapa: ${RUTA_MAPA})`);
    abrirNavegador(url);
  });
}

module.exports = { crearLectorMapa, validarParcelas, crearServidor, RUTA_MAPA, RUTA_PARCELAS, RUTA_TERRENOS };
