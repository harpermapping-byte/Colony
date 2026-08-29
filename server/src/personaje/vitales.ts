/**
 * Vitales del jugador — docs/GDD_Personaje.md. PURA (sin Colyseus/BD): se
 * llama desde el loop de movimiento que YA existe (RoomExteriorBase —
 * mismo sitio donde ya corre `separarPJs` cada tick), nunca un tick nuevo.
 * Sin persistencia entre sesiones — mismo criterio ya aceptado para el
 * inventario ("vive y muere con la sesión", docs/GDD_Inventario.md): con el
 * login todavía siendo un nombre libre (sin cuenta real), guardar un reloj
 * de hambre/sed entre reconexiones no aporta nada que no resuelva mejor el
 * login real cuando exista — se revisita entonces.
 */

export interface Vitales {
  vida: number;
  vidaMax: number;
  comida: number;
  bebida: number;
  sueno: number;
  estamina: number;
}

export const VITAL_MAX = 100;

/** Nuevo jugador: todo lleno — mismo criterio que "nivel 1 = sin XP", empezar sin penalización. */
export function vitalesIniciales(): Vitales {
  return { vida: VITAL_MAX, vidaMax: VITAL_MAX, comida: VITAL_MAX, bebida: VITAL_MAX, sueno: VITAL_MAX, estamina: VITAL_MAX };
}

/**
 * PLACEHOLDERS de balance (mismo criterio que pesoMaximoTransportable,
 * tiempoBaseSeg...): números de referencia a afinar, no una decisión
 * cerrada. Horas REALES (no tiempoMundo()), mismo convenio ya usado en
 * precios_propiedad.json (periodoHoras).
 */
export const TASA_DECAY_POR_HORA = {
  comida: VITAL_MAX / 16, // vacía del todo en 16h reales sin comer
  bebida: VITAL_MAX / 10, // vacía en 10h — la sed aprieta antes que el hambre
  sueno: VITAL_MAX / 20, // vacía en 20h despierto
};
/** Estamina no decae sola (nada la gasta todavía — sprint/combate sin construir): se regenera pasivamente hasta el máximo. */
export const TASA_REGEN_ESTAMINA_POR_HORA = VITAL_MAX / 1;
/** Vida drenada por hora, por CADA vital básico que esté en 0 simultáneamente (se suman) — el límite real con "morir de hambre de verdad" lo cierra el futuro GDD de Muerte/Respawn; aquí solo se clampa en 0, sin más consecuencia todavía. */
export const TASA_VIDA_POR_VITAL_EN_CERO = 2;

function clamp(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Avanza `horasTranscurridas` horas reales de vida del personaje, en sitio
 * (muta `v`). Se llama cada tick del loop de movimiento con el delta de ese
 * tick — igual de barato que la separación PJ-PJ que ya corre ahí, sin
 * checkpoint ni timestamp: es un integrador simple, no un recálculo lazy
 * contra un guardado (no hay guardado, ver nota de arriba).
 */
export function tickVitales(v: Vitales, horasTranscurridas: number): void {
  if (horasTranscurridas <= 0) return;
  v.comida = clamp(v.comida - TASA_DECAY_POR_HORA.comida * horasTranscurridas, VITAL_MAX);
  v.bebida = clamp(v.bebida - TASA_DECAY_POR_HORA.bebida * horasTranscurridas, VITAL_MAX);
  v.sueno = clamp(v.sueno - TASA_DECAY_POR_HORA.sueno * horasTranscurridas, VITAL_MAX);
  v.estamina = clamp(v.estamina + TASA_REGEN_ESTAMINA_POR_HORA * horasTranscurridas, VITAL_MAX);

  const vitalesEnCero = (v.comida <= 0 ? 1 : 0) + (v.bebida <= 0 ? 1 : 0) + (v.sueno <= 0 ? 1 : 0);
  if (vitalesEnCero > 0) {
    v.vida = clamp(v.vida - TASA_VIDA_POR_VITAL_EN_CERO * vitalesEnCero * horasTranscurridas, v.vidaMax);
  }
}

/** Restaura un vital concreto (comer/beber) hasta su tope — usado por `personaje:consumir`. */
export function restaurarVital(v: Vitales, vital: "comida" | "bebida" | "sueno" | "estamina" | "vida", cantidad: number): void {
  const tope = vital === "vida" ? v.vidaMax : VITAL_MAX;
  v[vital] = clamp(v[vital] + cantidad, tope);
}
