"use strict";

// Decide el tipo de terreno final de una casilla, combinando bioma base +
// agua (hidrología) + camino + reglas de banda alta (GDD secciones 2 y 4).
// "variante" (0..1, de una capa de ruido de alta frecuencia) elige entre
// alternativas MECÁNICAS del mismo bioma (cambian modVelocidad/estratigrafia)
// para que el suelo no sea un único tile plano repetido — playa arenosa vs.
// rocosa, césped raído en manchas.
//
// "subvariante" (0..1, capa de ruido INDEPENDIENTE) es distinta: elige entre
// 2-3 subbiomas puramente COSMÉTICOS del terreno base final (mismo
// transitable/modVelocidad/estratigrafia, solo cambia colorDebug/textura —
// pedido 2026-08-29, "que cada bioma tenga un subbioma... no se vea la misma
// imagen repetida hasta la saciedad"). Nunca sustituye a "variante": esta se
// aplica DESPUÉS, sobre lo que ya haya decidido el sistema mecánico de
// siempre (cesped_ralo/playa_rocosa incluidos, catálogo terrenos.json).
// OJO al añadir aquí: cada id nuevo cuenta contra el límite duro de 36
// símbolos de terrenos.json (_nota_limite_36) — por eso barro/ceniza/roca
// se quedan en 2 looks (base+1) en vez de 3, presupuesto ya ajustado.
const SUBVARIANTES = {
  cesped: ["cesped", "cesped_b", "cesped_c"],
  nieve: ["nieve", "nieve_b", "nieve_c"],
  arena: ["arena", "arena_b", "arena_c"],
  barro: ["barro", "barro_b"],
  ceniza: ["ceniza", "ceniza_b"],
  playa: ["playa", "playa_b"],
  roca: ["roca", "roca_b"],
};
function conSubvariante(idBase, subvariante) {
  const opciones = SUBVARIANTES[idBase];
  if (!opciones) return idBase;
  const idx = Math.min(opciones.length - 1, Math.floor(subvariante * opciones.length));
  return opciones[idx];
}

function decidirTerreno({ biomaId, catalogoBiomas, banda, hidro, esCamino, variante = 0.5, subvariante = 0.5 }) {
  // Camino que cruza agua = puente, no "camino pintado encima del río":
  // el cruce se ve como estructura de verdad. Los caminos solo pueden
  // cruzar ríos de banda baja (costoArista los hace impasables en banda
  // alta), así que un puente siempre cae sobre un tramo vadeable.
  if (esCamino) return hidro.esRio || hidro.esLago ? "puente" : "camino";

  if (hidro.esLago || hidro.esRio) {
    return banda <= 1 ? "agua" : "agua_profunda";
  }

  if (banda === 6) return "roca_inaccesible"; // cumbre, GDD sección 2
  if (banda === 5) return conSubvariante(biomaId === "montana_nevada" ? "nieve" : "roca", subvariante);

  if (biomaId === "costa" && variante < 0.22) return "playa_rocosa";
  if ((biomaId === "pradera" || biomaId === "bosque") && variante < 0.16) return "cesped_ralo";

  const bioma = catalogoBiomas[biomaId];
  return bioma ? conSubvariante(bioma.terrenoBase, subvariante) : "tierra";
}

module.exports = { decidirTerreno, conSubvariante };
