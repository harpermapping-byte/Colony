"use strict";

// Censo de un asentamiento (GDD_Poblacion_NPCs.md, Fase 1): a partir del
// tier + semilla decide qué "slots" de individuo hay que generar —
// cabezas de familia sueltos y unidades familiares (cabeza + cónyuge +
// 0-2 hijos). Determinista: mismo tier+semilla = mismo censo siempre.
const { crearPRNG } = require("../../interiores/src/azar");

function enteroEnRango([min, max], rnd) {
  return min + Math.floor(rnd() * (max - min + 1));
}

/**
 * @param {string} tierId - clave en ciudades/catalogo/asentamientos.json (aldea, pueblo...)
 * @param {string} semilla - semilla del asentamiento (p.ej. su id de POI)
 * @param {object} catalogos - poblacion/src/catalogo.js
 * @returns {Array<{slotId, npcId, semilla, familiaId: string|null, rolFamiliar: "cabeza"|"conyuge"|"hijo"|null}>}
 */
function generarCenso(tierId, semilla, catalogos) {
  const entradas = catalogos.censo[tierId];
  if (!entradas) throw new Error(`sin censo definido para el tier: ${tierId}`);

  const rndCenso = crearPRNG(`${semilla}|censo`);
  const slots = [];
  let contadorFamilia = 0;

  for (const entrada of entradas) {
    const cantidad = enteroEnRango(entrada.cantidad, rndCenso);
    for (let i = 0; i < cantidad; i++) {
      const slotSemilla = `${semilla}|${entrada.npc}_${i}`;
      const rndSlot = crearPRNG(`${slotSemilla}|familia`);
      const formaFamilia = entrada.familia && rndSlot() < (entrada.probFamilia ?? 0.5);

      if (!formaFamilia) {
        slots.push({ slotId: slotSemilla, npcId: entrada.npc, semilla: slotSemilla, familiaId: null, rolFamiliar: null });
        continue;
      }

      // El cónyuge y los hijos se generan como "aldeano" (look genérico) —
      // simplificación v1 documentada en el GDD: aún no hay arquetipos
      // civiles propios (ama de casa, aprendiz...) en personajes/catalogo.
      const familiaId = `familia_${tierId}_${contadorFamilia++}`;
      slots.push({ slotId: slotSemilla, npcId: entrada.npc, semilla: slotSemilla, familiaId, rolFamiliar: "cabeza" });
      slots.push({
        slotId: `${slotSemilla}|conyuge`,
        npcId: "aldeano",
        semilla: `${slotSemilla}|conyuge`,
        familiaId,
        rolFamiliar: "conyuge",
      });
      const nHijos = Math.floor(rndSlot() * 3); // 0-2
      for (let h = 0; h < nHijos; h++) {
        slots.push({
          slotId: `${slotSemilla}|hijo_${h}`,
          npcId: "aldeano",
          semilla: `${slotSemilla}|hijo_${h}`,
          familiaId,
          rolFamiliar: "hijo",
        });
      }
    }
  }

  return slots;
}

module.exports = { generarCenso };
