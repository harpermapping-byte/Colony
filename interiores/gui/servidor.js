#!/usr/bin/env node
"use strict";

// Editor web del bakeador de interiores — mismo patrón que baker/gui/servidor.js
// (servidor http plano, sin framework, API + estáticos). El servidor guarda
// EL edificio actual en memoria (variable `edificioActual`) y expone
// operaciones de generación/edición/regeneración sobre él — el generador
// nunca es el resultado final bloqueado (sección 4 del pedido): genera,
// el editor deja tocar cualquier cosa, y "Guardar" escribe el estado a
// disco tal cual está, con lo generado y lo modificado a mano mezclado.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const { cargarCatalogos } = require("../src/catalogo");
const { generarEdificio } = require("../src/edificio");
const edicion = require("../src/edicion");

const RAIZ_GUI = __dirname;
const RAIZ_INTERIORES = path.join(__dirname, "..");
const CARPETA_OUTPUT = path.join(RAIZ_INTERIORES, "output");
const PUERTO = Number(process.env.PUERTO_INTERIORES) || 4100;

const catalogos = cargarCatalogos();
let edificioActual = null;

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function abrirNavegador(url) {
  const comando = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(comando, () => {});
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

function responderJSON(res, codigo, datos) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(datos));
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

// Los objetos Sala (salas.js) llevan Sets (tiles/puertas/ventanas) — no
// son JSON tal cual. Serializa a arrays solo para el viaje al navegador;
// el servidor sigue guardando el objeto real (con Sets) en memoria entre
// peticiones, esto es puramente de transporte.
function serializarSala(sala) {
  if (!sala) return null;
  return { ...sala, tiles: [...sala.tiles], puertas: [...sala.puertas], ventanas: [...sala.ventanas] };
}

function serializarResultadoSala(r) {
  return { ...r, sala: serializarSala(r.sala) };
}

function serializarEdificio(edificio) {
  return {
    ...edificio,
    plantas: edificio.plantas.map((p) => ({
      ...p,
      salas: p.salas.map((s) => ({ ...s, resultado: serializarResultadoSala(s.resultado), salaPlanta: serializarSala(s.salaPlanta) })),
    })),
  };
}

function encontrarSala(edificio, nivel, indiceSala) {
  const planta = edificio.plantas.find((p) => p.nivel === nivel);
  if (!planta) return null;
  const sala = planta.salas[indiceSala];
  if (!sala) return null;
  return { planta, sala };
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);

  try {
    // --- API de catálogo (para los desplegables del editor) ---
    if (url.pathname === "/api/tiposEdificio" && req.method === "GET") {
      const ids = Object.keys(catalogos.tiposEdificio).filter((k) => !k.startsWith("_")).sort();
      return responderJSON(res, 200, { tiposEdificio: ids });
    }
    if (url.pathname === "/api/tiposSala" && req.method === "GET") {
      const ids = Object.entries(catalogos.tiposSala)
        .filter(([k]) => !k.startsWith("_"))
        .map(([id, def]) => ({ id, nombre: def.nombre || id, categoria: def.categoria || "" }));
      return responderJSON(res, 200, { tiposSala: ids });
    }
    if (url.pathname === "/api/elementos" && req.method === "GET") {
      const items = Object.entries(catalogos.elementos)
        .filter(([k]) => !k.startsWith("_"))
        .map(([id, def]) => ({ id, capa: def.capa, colorDebug: def.colorDebug, huella: def.huella || [1, 1], colocacion: def.colocacion }));
      return responderJSON(res, 200, { elementos: items });
    }

    // --- Generación ---
    if (url.pathname === "/api/generar" && req.method === "POST") {
      const body = await leerCuerpoJSON(req);
      const { tipoEdificioId, semilla, riqueza, amueblado } = body;
      if (!catalogos.tiposEdificio[tipoEdificioId]) return responderJSON(res, 400, { ok: false, error: "tipoEdificio desconocido" });
      edificioActual = generarEdificio({ tipoEdificioId, catalogos, semilla: semilla || `${tipoEdificioId}-${Date.now()}`, riqueza, amueblado: amueblado || "completo" });
      return responderJSON(res, 200, { ok: true, edificio: serializarEdificio(edificioActual) });
    }

    if (url.pathname === "/api/edificio" && req.method === "GET") {
      if (!edificioActual) return responderJSON(res, 200, { ok: true, edificio: null });
      return responderJSON(res, 200, { ok: true, edificio: serializarEdificio(edificioActual) });
    }

    // --- Edición no destructiva (opera sobre resultado de una sala) ---
    if (url.pathname.startsWith("/api/editar/") && req.method === "POST") {
      if (!edificioActual) return responderJSON(res, 400, { ok: false, error: "no hay edificio generado" });
      const body = await leerCuerpoJSON(req);
      const encontrada = encontrarSala(edificioActual, body.nivel, body.indiceSala);
      if (!encontrada) return responderJSON(res, 404, { ok: false, error: "sala no encontrada" });
      const resultado = encontrada.sala.resultado;
      const accion = url.pathname.slice("/api/editar/".length);

      let salida;
      if (accion === "mover") salida = edicion.moverElemento(resultado, body.instanceId, body.x, body.y, { forzar: body.forzar });
      else if (accion === "rotar") salida = edicion.rotarElemento(resultado, body.instanceId, catalogos, body.grados, { forzar: body.forzar });
      else if (accion === "eliminar") salida = edicion.eliminarElemento(resultado, body.instanceId);
      else if (accion === "anadir") salida = edicion.anadirElemento(resultado, catalogos, body.elementoId, body.x, body.y, { forzar: body.forzar, rotacion: body.rotacion });
      else if (accion === "duplicar") salida = edicion.duplicarElemento(resultado, body.instanceId);
      else if (accion === "sustituir") salida = edicion.sustituirElemento(resultado, catalogos, body.instanceId, body.nuevoElementoId);
      else if (accion === "cambiarTipoSala") salida = edicion.cambiarTipoSala(resultado, catalogos, body.nuevoTipoSalaId);
      else return responderJSON(res, 404, { ok: false, error: "acción desconocida: " + accion });

      return responderJSON(res, 200, { ...salida, resultado: serializarResultadoSala(resultado) });
    }

    // --- Regeneración parcial (sección 6) ---
    if (url.pathname === "/api/regenerar/mobiliario" && req.method === "POST") {
      if (!edificioActual) return responderJSON(res, 400, { ok: false, error: "no hay edificio generado" });
      const body = await leerCuerpoJSON(req);
      const encontrada = encontrarSala(edificioActual, body.nivel, body.indiceSala);
      if (!encontrada) return responderJSON(res, 404, { ok: false, error: "sala no encontrada" });
      const salida = edicion.regenerarHabitacion(encontrada.sala.resultado, catalogos, { forzar: body.forzar });
      return responderJSON(res, 200, { ...salida, resultado: serializarResultadoSala(encontrada.sala.resultado) });
    }
    if (url.pathname === "/api/regenerar/planta" && req.method === "POST") {
      if (!edificioActual) return responderJSON(res, 400, { ok: false, error: "no hay edificio generado" });
      const body = await leerCuerpoJSON(req);
      const planta = edificioActual.plantas.find((p) => p.nivel === body.nivel);
      if (!planta) return responderJSON(res, 404, { ok: false, error: "planta no encontrada" });
      const salida = edicion.regenerarPiso(planta, catalogos, { forzar: body.forzar });
      return responderJSON(res, 200, { ok: true, resumen: salida, edificio: serializarEdificio(edificioActual) });
    }
    if (url.pathname === "/api/regenerar/edificio" && req.method === "POST") {
      if (!edificioActual) return responderJSON(res, 400, { ok: false, error: "no hay edificio generado" });
      const body = await leerCuerpoJSON(req);
      const salida = edicion.regenerarEdificio(edificioActual, catalogos, { forzar: body.forzar });
      return responderJSON(res, 200, { ok: true, resumen: salida, edificio: serializarEdificio(edificioActual) });
    }

    // --- Guardar a disco ---
    if (url.pathname === "/api/guardar" && req.method === "POST") {
      if (!edificioActual) return responderJSON(res, 400, { ok: false, error: "no hay edificio generado" });
      if (!fs.existsSync(CARPETA_OUTPUT)) fs.mkdirSync(CARPETA_OUTPUT, { recursive: true });
      const rutaArchivo = path.join(CARPETA_OUTPUT, `${edificioActual.id}.json`);
      fs.writeFileSync(rutaArchivo, JSON.stringify(serializarEdificio(edificioActual), null, 2));
      return responderJSON(res, 200, { ok: true, archivo: rutaArchivo });
    }

    if (url.pathname === "/api/apagar" && req.method === "POST") {
      responderJSON(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 200);
      return;
    }

    // --- Estáticos ---
    let rutaPedida = decodeURIComponent(url.pathname);
    if (rutaPedida === "/") rutaPedida = "/index.html";
    const rutaAbsoluta = path.normalize(path.join(RAIZ_GUI, rutaPedida));
    if (!rutaAbsoluta.startsWith(RAIZ_GUI)) {
      res.writeHead(403);
      res.end("Prohibido");
      return;
    }
    servirArchivoEstatico(res, rutaAbsoluta);
  } catch (e) {
    responderJSON(res, 500, { ok: false, error: e.message });
  }
});

servidor.listen(PUERTO, () => {
  const url = `http://localhost:${PUERTO}/`;
  console.log(`Editor de interiores en ${url}`);
  abrirNavegador(url);
});
