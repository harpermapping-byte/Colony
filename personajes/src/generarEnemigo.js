"use strict";

// Genera UN enemigo concreto de personajes/catalogo/enemigos.json —
// docs/GDD_Bakeador_Dungeons.md. Cero motor nuevo: un enemigo es un NPC
// (generarPersonaje.js) o un animal (generarAnimal.js) con otra ficha,
// esta función solo decide cuál de los dos llamar según `tipoRig` y
// aplica el multiplicador de escala de los jefes (`escalaBoss`, solo en
// enemigos tipo "animal" — los "npc" ya escalan su tamaño vía el rango
// de `morfologia`, más alto/corpulento en la propia entrada del jefe).

const { generarPersonaje } = require("./generarPersonaje");
const { generarAnimal } = require("./generarAnimal");

/**
 * @param {string} enemigoId - clave en personajes/catalogo/enemigos.json
 * @param {object} opciones - { semilla, catalogos } (catalogos de personajes/src/catalogo.js,
 *   con `enemigos`/`animalesRig`/`animalesBaker`/`rasgos`/`proporcionesRig` cargados)
 */
function generarEnemigo(enemigoId, opciones) {
  const { catalogos, semilla } = opciones;
  const def = catalogos.enemigos[enemigoId];
  if (!def) throw new Error(`Enemigo desconocido: ${enemigoId}`);

  if (def.tipoRig === "animal") {
    const resultado = generarAnimal(def.especieId, {
      catalogos: { animalesRig: catalogos.animalesRig, animalesBaker: catalogos.animalesBaker },
      semilla: `${semilla}:enemigo:${enemigoId}`,
    });
    if (def.escalaBoss) resultado.ficha.escala = Number((resultado.ficha.escala * def.escalaBoss).toFixed(3));
    return {
      tipoRig: "animal",
      enemigoId,
      esBoss: !!def.esBoss,
      lootTier: def.lootTier || "humilde",
      ...resultado,
    };
  }

  // tipoRig "npc" (por defecto): generarPersonaje.js lee `catalogos.npcs[id]`,
  // así que se le pasa el catálogo de enemigos EN VEZ del de NPCs de aldea —
  // misma forma de entrada (profesion/morfologia/ropa/rasgos), catálogo distinto.
  const resultado = generarPersonaje(enemigoId, {
    catalogos: { ...catalogos, npcs: catalogos.enemigos },
    semilla: `${semilla}:enemigo`,
  });
  return {
    tipoRig: "npc",
    enemigoId,
    esBoss: !!def.esBoss,
    lootTier: def.lootTier || "humilde",
    ...resultado,
  };
}

module.exports = { generarEnemigo };
