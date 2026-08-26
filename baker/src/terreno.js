"use strict";

// Decide el tipo de terreno final de una casilla, combinando bioma base +
// agua (hidrología) + camino + reglas de banda alta (GDD secciones 2 y 4).
// "variante" (0..1, de una capa de ruido de alta frecuencia) elige entre
// alternativas del mismo bioma para que el suelo no sea un único tile
// plano repetido — playa arenosa vs. rocosa, césped raído en manchas.
function decidirTerreno({ biomaId, catalogoBiomas, banda, hidro, esCamino, variante = 0.5 }) {
  if (esCamino) return "camino";

  if (hidro.esLago || hidro.esRio) {
    return banda <= 1 ? "agua" : "agua_profunda";
  }

  if (banda === 6) return "roca_inaccesible"; // cumbre, GDD sección 2
  if (banda === 5) return biomaId === "montana_nevada" ? "nieve" : "roca";

  if (biomaId === "costa" && variante < 0.22) return "playa_rocosa";
  if ((biomaId === "pradera" || biomaId === "bosque") && variante < 0.16) return "cesped_ralo";

  const bioma = catalogoBiomas[biomaId];
  return bioma ? bioma.terrenoBase : "tierra";
}

module.exports = { decidirTerreno };
