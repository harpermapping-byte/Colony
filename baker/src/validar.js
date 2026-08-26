"use strict";

// Pasada de validación (GDD sección 12): revisa que los POIs importantes
// queden conectados por camino al punto de origen (la ciudad). No repite el
// pathfinding, reutiliza el resultado que ya calculó caminos.js — si A* no
// encontró ruta, aquí se reporta como problema antes de dar el mapa por bueno.
function validarMapa({ resultadosCaminos, totalPOIs, totalChunks }) {
  const problemas = [];
  const sinRuta = resultadosCaminos.filter((r) => !r.encontrada);

  if (sinRuta.length > 0) {
    problemas.push(
      `${sinRuta.length} POI(s) sin camino encontrado hasta la ciudad: ` +
        sinRuta.map((r) => `${r.poiId} en (${r.x},${r.y})`).join(", ")
    );
  }

  if (totalPOIs === 0) {
    problemas.push("No se colocó ningún POI en todo el mapa — revisa la separación mínima o los biomas habilitados.");
  }

  return {
    ok: problemas.length === 0,
    problemas,
    resumen: `${totalChunks} chunks generados, ${totalPOIs} POIs colocados, ${sinRuta.length} sin ruta.`,
  };
}

module.exports = { validarMapa };
