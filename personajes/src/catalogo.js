"use strict";

const fs = require("fs");
const path = require("path");

const CARPETA_CATALOGO = path.join(__dirname, "..", "catalogo");
// Las medidas del rig son la MISMA fuente que usan el cliente y ropa/ —
// cero medidas duplicadas (CLAUDE.md punto 2).
const PROPORCIONES_RIG = path.join(__dirname, "..", "..", "client", "src", "render3d", "proporcionesRig.json");

function cargarJSON(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function cargarCatalogos() {
  return {
    npcs: cargarJSON(path.join(CARPETA_CATALOGO, "npcs.json")),
    rasgos: cargarJSON(path.join(CARPETA_CATALOGO, "rasgos.json")),
    proporcionesRig: cargarJSON(PROPORCIONES_RIG),
  };
}

module.exports = { cargarCatalogos };
