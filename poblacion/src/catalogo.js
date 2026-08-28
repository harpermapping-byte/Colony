"use strict";

const fs = require("fs");
const path = require("path");

const CARPETA_CATALOGO = path.join(__dirname, "..", "catalogo");

function cargarJSON(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function cargarCatalogos() {
  return {
    nombres: cargarJSON(path.join(CARPETA_CATALOGO, "nombres.json")),
    censo: cargarJSON(path.join(CARPETA_CATALOGO, "censo.json")),
    oficiosEdificios: cargarJSON(path.join(CARPETA_CATALOGO, "oficiosEdificios.json")),
    perfilesSociales: cargarJSON(path.join(CARPETA_CATALOGO, "perfilesSociales.json")),
    accionesPorSala: cargarJSON(path.join(CARPETA_CATALOGO, "accionesPorSala.json")),
    especiales: cargarJSON(path.join(CARPETA_CATALOGO, "especiales.json")),
  };
}

module.exports = { cargarCatalogos };
