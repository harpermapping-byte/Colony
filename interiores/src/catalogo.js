"use strict";

const fs = require("fs");
const path = require("path");

const CARPETA_CATALOGO = path.join(__dirname, "..", "catalogo");

function cargarJSON(nombre) {
  return JSON.parse(fs.readFileSync(path.join(CARPETA_CATALOGO, nombre), "utf8"));
}

function cargarCatalogos() {
  return {
    materiales: cargarJSON("materiales.json"),
    tiposSala: cargarJSON("tipos_sala.json"),
    tiposEdificio: cargarJSON("tipos_edificio.json"),
    conectores: cargarJSON("conectores.json"),
    puertas: cargarJSON("puertas.json"),
    ventanas: cargarJSON("ventanas.json"),
    elementos: cargarJSON("elementos.json"),
    formasSala: cargarJSON("formasSala.json"),
  };
}

// Escala humilde < modesta < noble (sección 9 del GDD: "se admite si es igual o superior").
const ORDEN_RIQUEZA = { humilde: 0, modesta: 1, noble: 2 };

function riquezaAlcanza(riquezaSala, riquezaMinimaRequerida) {
  if (!riquezaMinimaRequerida) return true;
  return ORDEN_RIQUEZA[riquezaSala] >= ORDEN_RIQUEZA[riquezaMinimaRequerida];
}

module.exports = { cargarCatalogos, riquezaAlcanza, ORDEN_RIQUEZA };
