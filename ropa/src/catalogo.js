"use strict";

const fs = require("fs");
const path = require("path");

const CARPETA_CATALOGO = path.join(__dirname, "..", "catalogo");
// Materiales NO se duplican: es el mismo catálogo que ya usan los
// interiores (interiores/catalogo/materiales.json) — ropa solo añadió ahí
// las fibras que le faltaban (lino/lana/seda). Ver CLAUDE.md punto 2
// ("catálogo como fuente de verdad").
const MATERIALES_COMPARTIDOS = path.join(__dirname, "..", "..", "interiores", "catalogo", "materiales.json");
const PROPORCIONES_RIG = path.join(__dirname, "..", "..", "client", "src", "render3d", "proporcionesRig.json");

function cargarJSON(rutaAbsoluta) {
  return JSON.parse(fs.readFileSync(rutaAbsoluta, "utf8"));
}

function cargarCatalogos() {
  return {
    materiales: cargarJSON(MATERIALES_COMPARTIDOS),
    prendas: cargarJSON(path.join(CARPETA_CATALOGO, "prendas.json")),
    profesiones: cargarJSON(path.join(CARPETA_CATALOGO, "profesiones.json")),
    proporcionesRig: cargarJSON(PROPORCIONES_RIG),
  };
}

module.exports = { cargarCatalogos };
