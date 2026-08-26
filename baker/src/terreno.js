"use strict";

// Decide el tipo de terreno final de una casilla, combinando bioma base +
// agua (hidrología) + camino + reglas de banda alta (GDD secciones 2 y 4).
function decidirTerreno({ biomaId, catalogoBiomas, banda, hidro, esCamino }) {
  if (esCamino) return "camino";

  if (hidro.esLago || hidro.esRio) {
    return banda <= 1 ? "agua" : "agua_profunda";
  }

  if (banda === 6) return "roca_inaccesible"; // cumbre, GDD sección 2
  if (banda === 5) return biomaId === "montana_nevada" ? "nieve" : "roca";

  const bioma = catalogoBiomas[biomaId];
  return bioma ? bioma.terrenoBase : "tierra";
}

module.exports = { decidirTerreno };
