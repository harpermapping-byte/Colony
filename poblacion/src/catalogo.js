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
  };
}

module.exports = { cargarCatalogos };
