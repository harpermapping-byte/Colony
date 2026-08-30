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
// Cruce profesión->ropa (pedido 2026-08-30, docs/GDD_Ropa_Procedural.md):
// mismos catálogos que ya usa ropa/, cero duplicado (CLAUDE.md punto 2).
const ROPA_PRENDAS = path.join(__dirname, "..", "..", "ropa", "catalogo", "prendas.json");
const ROPA_PROFESIONES = path.join(__dirname, "..", "..", "ropa", "catalogo", "profesiones.json");

function cargarCatalogos() {
  return {
    npcs: cargarJSON(path.join(CARPETA_CATALOGO, "npcs.json")),
    // enemigos.json: hermano de npcs.json para mazmorras (docs/GDD_Bakeador_Dungeons.md)
    // — mismo generador por debajo (generarEnemigo.js), catálogo aparte para no
    // mezclar población de aldea con población hostil.
    enemigos: cargarJSON(path.join(CARPETA_CATALOGO, "enemigos.json")),
    rasgos: cargarJSON(path.join(CARPETA_CATALOGO, "rasgos.json")),
    animalesRig: cargarJSON(path.join(CARPETA_CATALOGO, "animales_rig.json")),
    animalesBaker: cargarJSON(ANIMALES_BAKER),
    proporcionesRig: cargarJSON(PROPORCIONES_RIG),
    ropaPrendas: cargarJSON(ROPA_PRENDAS),
    ropaProfesiones: cargarJSON(ROPA_PROFESIONES),
  };
}

module.exports = { cargarCatalogos };
