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
const { construirCatalogoContenido } = require("../src/catalogoContenido");
const edicion = require("../src/edicion");

const RAIZ_GUI = __dirname;
const RAIZ_INTERIORES = path.join(__dirname, "..");
const CARPETA_OUTPUT = path.join(RAIZ_INTERIORES, "output");
const PUERTO = Number(process.env.PUERTO_INTERIORES) || 4100;

const catalogos = cargarCatalogos();
const catalogoContenido = construirCatalogoContenido(catalogos);
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

// Inverso de serializarSala/serializarEdificio: reconstruye los Sets desde
// los arrays del JSON guardado en disco, para que un edificio CARGADO sea
// indistinguible en memoria de uno recién generado — todas las operaciones
// de edición/regeneración (que consultan sala.tiles/puertas como Sets)
// funcionan igual sobre él, y el estado generado/modificado de cada pieza
// viaja tal cual (una regeneración sigue respetando lo editado a mano).
function deserializarSala(sala) {
  if (!sala) return null;
  return { ...sala, tiles: new Set(sala.tiles || []), puertas: new Set(sala.puertas || []), ventanas: new Set(sala.ventanas || []) };
}

function deserializarEdificio(json) {
  return {
    ...json,
    plantas: (json.plantas || []).map((p) => ({
      ...p,
      salas: (p.salas || []).map((s) => ({
        ...s,
        resultado: s.resultado ? { ...s.resultado, sala: deserializarSala(s.resultado.sala) } : s.resultado,
        salaPlanta: deserializarSala(s.salaPlanta),
      })),
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
    // Catálogo de ventanas (catalogo/ventanas.json — 4 ejes combinables:
    // forma/tamano/marco/cristal) para los desplegables de "añadir
    // ventana" del editor — mismas 4 secciones que ya consulta
    // colocarElementos.js (ejeValido), solo sin filtrar por riqueza aquí
    // (el editor deja elegir cualquiera a mano; riquezaMinima es solo un
    // sesgo del generador automático, no una prohibición dura).
    if (url.pathname === "/api/ventanas" && req.method === "GET") {
      const limpiar = (seccion) => Object.fromEntries(Object.entries(seccion || {}).filter(([k]) => !k.startsWith("_")));
      return responderJSON(res, 200, {
        forma: limpiar(catalogos.ventanas?.forma),
        tamano: limpiar(catalogos.ventanas?.tamano),
        marco: limpiar(catalogos.ventanas?.marco),
        cristal: limpiar(catalogos.ventanas?.cristal),
      });
    }

    // Catálogo de contenido normalizado (sección 10 del pedido de
    // catálogo): navegación por categoría/subcategoría/tag y búsqueda de
    // texto, todo resuelto por catalogoContenido.js — la paleta del
    // editor consume esto en vez de una lista fija.
    if (url.pathname === "/api/catalogo" && req.method === "GET") {
      let resultado = catalogoContenido.items;
      const categoria = url.searchParams.get("categoria");
      const subcategoria = url.searchParams.get("subcategoria");
      const tag = url.searchParams.get("tag");
      const q = url.searchParams.get("q");
      const sala = url.searchParams.get("sala");
      if (categoria) resultado = resultado.filter((it) => it.categoria === categoria);
      // subcategoria/texto reusan la búsqueda REAL de catalogoContenido.js (buscarPorSubcategoria/
      // buscarPorTexto) en vez de reimplementar el mismo filtro a mano por segunda vez — encontrado
      // en la auditoría de 2026-09-02: la copia de aquí ya se había desincronizado de la real (esta
      // no comparaba `it.id` en minúsculas, la de catalogoContenido.js tampoco lo hacía, pero
      // cualquier cambio futuro en una sola de las dos copias las habría desincronizado en serio).
      if (subcategoria) {
        const ids = new Set(catalogoContenido.buscarPorSubcategoria(subcategoria).map((it) => it.id));
        resultado = resultado.filter((it) => ids.has(it.id));
      }
      if (tag) resultado = resultado.filter((it) => it.tags.includes(tag));
      if (sala) resultado = resultado.filter((it) => it.salasPermitidas.length === 0 || it.salasPermitidas.includes(sala));
      if (q) {
        const ids = new Set(catalogoContenido.buscarPorTexto(q).map((it) => it.id));
        resultado = resultado.filter((it) => ids.has(it.id));
      }
      const categorias = [...new Set(catalogoContenido.items.map((it) => it.categoria))].sort();
      const tags = [...new Set(catalogoContenido.items.flatMap((it) => it.tags))].sort();
      return responderJSON(res, 200, { items: resultado, categorias, tags, total: catalogoContenido.items.length });
    }
    if (url.pathname === "/api/catalogo/validar" && req.method === "GET") {
      return responderJSON(res, 200, catalogoContenido.validar());
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
      if (accion === "mover") salida = edicion.moverElemento(resultado, body.instanceId, body.x, body.y, { forzar: body.forzar, catalogos });
      else if (accion === "rotar") salida = edicion.rotarElemento(resultado, body.instanceId, catalogos, body.grados, { forzar: body.forzar });
      else if (accion === "eliminar") salida = edicion.eliminarElemento(resultado, body.instanceId);
      else if (accion === "anadir") salida = edicion.anadirElemento(resultado, catalogos, body.elementoId, body.x, body.y, { forzar: body.forzar, rotacion: body.rotacion });
      else if (accion === "duplicar") salida = edicion.duplicarElemento(resultado, body.instanceId, { catalogos });
      else if (accion === "sustituir") salida = edicion.sustituirElemento(resultado, catalogos, body.instanceId, body.nuevoElementoId);
      else if (accion === "cambiarEstado") salida = edicion.cambiarEstado(resultado, body.instanceId, body.cambios || {});
      else if (accion === "cambiarTipoSala") salida = edicion.cambiarTipoSala(resultado, catalogos, body.nuevoTipoSalaId);
      // Puertas/ventanas como instancia editable (2026-09-04): mismo
      // patrón request/response que el resto de /api/editar/* — el body
      // trae nivel+indiceSala (para localizar la sala) más los parámetros
      // propios de cada operación.
      else if (accion === "moverPuerta") salida = edicion.moverPuerta(resultado, body.x, body.y, { lado: body.lado, forzar: body.forzar });
      else if (accion === "anadirVentana") salida = edicion.anadirVentana(resultado, catalogos, body.x, body.y, body.lado, { forma: body.forma, tamano: body.tamano, marco: body.marco, cristal: body.cristal, forzar: body.forzar });
      else if (accion === "moverVentana") salida = edicion.moverVentana(resultado, body.instanceId, body.x, body.y, { lado: body.lado, forzar: body.forzar });
      else if (accion === "eliminarVentana") salida = edicion.eliminarVentana(resultado, body.instanceId);
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

    // --- Cargar un edificio guardado (el hueco que faltaba: guardar sin
    // poder reabrir convertía cada guardado en un callejón sin salida) ---
    if (url.pathname === "/api/guardados" && req.method === "GET") {
      const archivos = fs.existsSync(CARPETA_OUTPUT)
        ? fs.readdirSync(CARPETA_OUTPUT).filter((f) => f.endsWith(".json")).sort()
        : [];
      return responderJSON(res, 200, { archivos });
    }
    if (url.pathname === "/api/cargar" && req.method === "POST") {
      const body = await leerCuerpoJSON(req);
      // path.basename: nunca aceptar rutas con directorios — solo nombres
      // de archivo de la propia carpeta output.
      const nombre = path.basename(String(body.archivo || ""));
      if (!nombre.endsWith(".json")) return responderJSON(res, 400, { ok: false, error: "archivo inválido" });
      const rutaArchivo = path.join(CARPETA_OUTPUT, nombre);
      if (!fs.existsSync(rutaArchivo)) return responderJSON(res, 404, { ok: false, error: `no existe ${nombre}` });
      try {
        edificioActual = deserializarEdificio(JSON.parse(fs.readFileSync(rutaArchivo, "utf8")));
      } catch (e) {
        return responderJSON(res, 400, { ok: false, error: `no se pudo leer ${nombre}: ${e.message}` });
      }
      return responderJSON(res, 200, { ok: true, edificio: serializarEdificio(edificioActual) });
    }

    if (url.pathname === "/api/apagar" && req.method === "POST") {
      responderJSON(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 200);
      return;
    }

    // --- three.js servido desde el node_modules del propio repo (para la
    // vista 3D del edificio) — sin CDN ni dependencia nueva: es el mismo
    // paquete `three` que ya usa el cliente del juego. Se sirve el
    // directorio build/ entero (no solo three.module.js) porque desde
    // r167+ ese archivo importa internamente "./three.core.js". ---
    if (url.pathname.startsWith("/vendor/") && req.method === "GET") {
      const carpetaBuildThree = path.join(RAIZ_INTERIORES, "..", "node_modules", "three", "build");
      const nombre = path.basename(decodeURIComponent(url.pathname)); // sin subdirectorios: solo archivos del build
      const rutaThree = path.join(carpetaBuildThree, nombre);
      if (!nombre.endsWith(".js") || !fs.existsSync(rutaThree)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("no encontrado — ¿npm install en la raíz del repo?");
      }
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(fs.readFileSync(rutaThree));
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
