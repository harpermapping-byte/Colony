/**
 * Curva de nivel por XP compartida — antes vivía solo en crafteo.ts (nivel de
 * oficio, docs/GDD_Crafteo.md §6). docs/GDD_Personaje.md reusa EXACTAMENTE el
 * mismo mecanismo para el nivel de cada atributo del personaje: "el nivel se
 * deriva de XP, nunca se persiste en sí" es un principio, no algo propio del
 * crafteo — de ahí que se mueva aquí y ambos consumidores importen de un
 * único sitio (nunca dupliques una fuente de verdad).
 */

/** PLACEHOLDER de balance (mismo criterio que pesoMaximoTransportable, tiempoBaseSeg...): números de referencia a afinar, no una decisión cerrada. Nivel 1 = sin XP. */
export const UMBRALES_NIVEL = [0, 100, 300, 600, 1000, 1500];

/** Nivel derivado de XP — nunca se persiste el nivel en sí, siempre se calcula de la XP guardada. */
export function nivelDeXp(xp: number): number {
  let nivel = 1;
  for (let i = 1; i < UMBRALES_NIVEL.length; i++) {
    if (xp >= UMBRALES_NIVEL[i]) nivel = i + 1;
  }
  return nivel;
}
