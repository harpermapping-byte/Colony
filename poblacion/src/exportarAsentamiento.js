"use strict";

// Orquesta TODO (GDD_Poblacion_NPCs.md): ciudad (ciudades/) + población
// (Fase 1) + ubicación (Fase 2) + perfil social + rutina + caminos
// bakeados (Fase 3). Es el artefacto final por asentamiento — lo que el
// servidor consumirá cuando puebla NPCs de verdad (el runtime que MUEVE
// al NPC por su camino según la hora sigue pendiente, ver GDD).
//
//   node poblacion/src/exportarAsentamiento.js <tier> <semilla> [salida.json]
const fs = require("fs");
const path = require("path");
const { generarCiudad } = require("../../ciudades/src/generar");
const { cargarCatalogos: cargarCatalogosInteriores } = require("../../interiores/src/catalogo");
const { cargarCatalogos } = require("./catalogo");
const { exportarPoblacion } = require("./exportarPoblacion");
const { asignarUbicacion } = require("./asignarUbicacion");
const { asignarPerfil } = require("./asignarPerfil");
const { generarRutina } = require("./generarRutina");
const { bakearCaminosDeRutina } = require("./bakearCaminos");

/**
 * @param {string} tierId - tier de ciudades/catalogo/asentamientos.json
 * @param {string} semilla
 * @param {object} [opciones] - { apiKey, contextoMundo, dia }
 */
async function exportarAsentamiento(tierId, semilla, opciones = {}) {
  const catalogosInteriores = cargarCatalogosInteriores();
  const catalogos = cargarCatalogos();

  const ciudad = generarCiudad({ tier: tierId, semilla, catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion(tierId, semilla, opciones);
  const deficit = asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios, catalogosInteriores.elementos);

  const cacheCaminos = new Map();
  for (const npc of poblacion.npcs) {
    npc.perfilSocial = asignarPerfil(npc, catalogos.perfilesSociales);
    npc.rutina = npc.perfilSocial ? generarRutina(npc, ciudad, catalogos, opciones.dia ?? 0) : [];
    if (npc.rutina.length) bakearCaminosDeRutina(ciudad, npc.rutina, cacheCaminos);
  }

  return { tierId, semilla, ciudad, npcs: poblacion.npcs, deficit };
}

module.exports = { exportarAsentamiento };

if (require.main === module) {
  const [tierId, semilla, salida] = process.argv.slice(2);
  if (!tierId || !semilla) {
    console.error("uso: node poblacion/src/exportarAsentamiento.js <tier> <semilla> [salida.json]");
    process.exit(1);
  }
  exportarAsentamiento(tierId, semilla).then((resultado) => {
    const ruta = salida ?? path.join(__dirname, "..", "output", `asentamiento_${tierId}_${semilla}.json`);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    // ciudad completa (interiores anidados de cada edificio) ya la exporta
    // ciudades/ por su cuenta y pesa varios MB — aquí solo lo nuevo de
    // población, para no duplicarla.
    const { ciudad, ...resto } = resultado;
    fs.writeFileSync(ruta, JSON.stringify(resto, null, 2), "utf8");
    const conRutina = resultado.npcs.filter((n) => n.rutina.length > 0).length;
    console.log(
      `${resultado.npcs.length} NPCs en "${tierId}" (${conRutina} con rutina, ` +
        `${resultado.deficit.sinVivienda.length} sin vivienda, ${resultado.deficit.sinTrabajo.length} sin trabajo) -> ${ruta}`,
    );
  });
}
