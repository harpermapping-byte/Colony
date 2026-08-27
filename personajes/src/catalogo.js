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

// Los animales cruzan DOS catálogos: el del baker (la lista real de
// especies del mundo, con su colorDebug) y el de rig de aquí (esqueleto y
// proporciones por especie) — mismo id en ambos, cero duplicados.
const ANIMALES_BAKER = path.join(__dirname, "..", "..", "baker", "catalogo", "animales.json");

function cargarCatalogos() {
  return {
    npcs: cargarJSON(path.join(CARPETA_CATALOGO, "npcs.json")),
    rasgos: cargarJSON(path.join(CARPETA_CATALOGO, "rasgos.json")),
    animalesRig: cargarJSON(path.join(CARPETA_CATALOGO, "animales_rig.json")),
    animalesBaker: cargarJSON(ANIMALES_BAKER),
    proporcionesRig: cargarJSON(PROPORCIONES_RIG),
  };
}

module.exports = { cargarCatalogos };
