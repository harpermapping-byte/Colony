/**
 * Vitales del jugador — docs/GDD_Personaje.md. PURA (sin Colyseus/BD): se
 * llama desde el loop de movimiento que YA existe (RoomExteriorBase —
 * mismo sitio donde ya corre `separarPJs` cada tick), nunca un tick nuevo.
 * Sin persistencia entre sesiones — mismo criterio ya aceptado para el
 * inventario ("vive y muere con la sesión", docs/GDD_Inventario.md): con el
 * login todavía siendo un nombre libre (sin cuenta real), guardar un reloj
 * de hambre/sed entre reconexiones no aporta nada que no resuelva mejor el
 * login real cuando exista — se revisita entonces.
 *
 * NO incluye `vida` — docs/GDD_Mecanicas.md §5.4 (combate.ts) ya fijó
 * `Player.vida/vidaMax` como la ÚNICA fuente de HP, con una regla explícita
 * "no negociable sin volver a preguntar al streamer": nadie se cura ni se
 * hace daño solo con el paso del tiempo, curar/dañar es SIEMPRE un evento
 * explícito. Un `tickVitales` que drenara vida por hambre violaría esa
 * regla de raíz (fue un diseño de esta misma pasada que colisionó con
 * Combate al fusionar — ver docs/GDD_Personaje.md §2 para el detalle). Los
 * vitales de aquí solo se restauran por acción explícita del jugador
 * (`personaje:consumir`), igual de "evento, no tick" que `curar()`.
 */

export interface Vitales {
  comida: number;
  bebida: number;
  sueno: number;
  estamina: number;
}

export const VITAL_MAX = 100;

/** Nuevo jugador: todo lleno — mismo criterio que "nivel 1 = sin XP", empezar sin penalización. */
export function vitalesIniciales(): Vitales {
  return { comida: VITAL_MAX, bebida: VITAL_MAX, sueno: VITAL_MAX, estamina: VITAL_MAX };
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

function clamp(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Avanza `horasTranscurridas` horas reales de vida del personaje, en sitio
 * (muta `v`). Se llama cada tick del loop de movimiento con el delta de ese
 * tick — igual de barato que la separación PJ-PJ que ya corre ahí, sin
 * checkpoint ni timestamp: es un integrador simple, no un recálculo lazy
 * contra un guardado (no hay guardado, ver nota de arriba). Qué pasa cuando
 * comida/bebida/sueño llegan a 0 (penalización, si la hay) es del futuro
 * GDD de Muerte/Respawn — aquí solo se clampa en 0, sin más consecuencia.
 */
export function tickVitales(v: Vitales, horasTranscurridas: number): void {
  if (horasTranscurridas <= 0) return;
  v.comida = clamp(v.comida - TASA_DECAY_POR_HORA.comida * horasTranscurridas, VITAL_MAX);
  v.bebida = clamp(v.bebida - TASA_DECAY_POR_HORA.bebida * horasTranscurridas, VITAL_MAX);
  v.sueno = clamp(v.sueno - TASA_DECAY_POR_HORA.sueno * horasTranscurridas, VITAL_MAX);
  v.estamina = clamp(v.estamina + TASA_REGEN_ESTAMINA_POR_HORA * horasTranscurridas, VITAL_MAX);
}

/** Restaura un vital concreto (comer/beber) hasta el tope — usado por `personaje:consumir`. Curar `vida` NO pasa por aquí (ver combate.ts:curar sobre Player directamente). */
export function restaurarVital(v: Vitales, vital: "comida" | "bebida" | "sueno" | "estamina", cantidad: number): void {
  v[vital] = clamp(v[vital] + cantidad, VITAL_MAX);
}
