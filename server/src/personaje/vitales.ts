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
 * NO incluye `vida` como CAMPO — docs/GDD_Mecanicas.md §5.4 (combate.ts) ya
 * fijó `Player.vida/vidaMax` como la ÚNICA fuente de HP, con una regla
 * explícita "no negociable sin volver a preguntar al streamer": nadie se
 * cura ni se hace daño solo con el paso del tiempo, curar/dañar es SIEMPRE
 * un evento explícito. Los vitales de aquí solo se restauran por acción
 * explícita del jugador (`personaje:consumir`), igual de "evento, no tick"
 * que `curar()`.
 *
 * `aplicarInanicion` (§3.6, más abajo) es la EXCEPCIÓN deliberada a esa
 * regla — pedida por el propio streamer, la única autoridad que puede
 * levantarla ("no negociable SIN VOLVER A PREGUNTAR AL STREAMER"; esto es
 * exactamente eso). Sigue siendo lógica PURA aquí (toma/devuelve números,
 * nunca toca `Player`/Colyseus directamente) — quien la llama (`RoomExteriorBase`)
 * es quien decide a qué `Player.vida/vidaMax` aplicar el resultado.
 */

export interface Vitales {
  comida: number;
  bebida: number;
  sueno: number;
  estamina: number;
  // Higiene (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30):
  // sube con CADA comida (misma cantidad que restaura de `comida`, evento
  // explícito igual que el resto de vitales — nunca un tick propio); al
  // tope el jugador se ensucia (`Player.sucio`, ver HubState.ts). No decae
  // sola: solo baja al usar una hoja (`higiene:cagar`) o llega a 100.
  caca: number;
  // Temperatura corporal (docs/GDD_Clima.md, pedido 2026-08-30): 0-100,
  // `TEMPERATURA_NEUTRA`=50 es cómodo — deriva sola hacia la temperatura del
  // mundo (`aplicarTemperaturaCorporal`, mismo integrador que tickVitales,
  // por eso vive AQUÍ y no en tickVitales: necesita un dato externo —la
  // temperatura del mundo— que tickVitales no recibe).
  temperatura: number;
}

export const VITAL_MAX = 100;

/** Nuevo jugador: todo lleno, `caca` vacía, temperatura corporal neutra — mismo criterio que "nivel 1 = sin XP", empezar sin penalización. */
export function vitalesIniciales(): Vitales {
  return { comida: VITAL_MAX, bebida: VITAL_MAX, sueno: VITAL_MAX, estamina: VITAL_MAX, caca: 0, temperatura: TEMPERATURA_NEUTRA };
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

// --- Temperatura corporal (docs/GDD_Clima.md, pedido 2026-08-30) — placeholders de balance, mismo criterio que el resto ---
export const TEMPERATURA_NEUTRA = 50;
/** Fuera de este rango (25-75) se considera "extremo": gasta comida/bebida más rápido y resta al vidaMax efectivo (ver aplicarInanicion). */
export const UMBRAL_FRIO_EXTREMO = 25;
export const UMBRAL_CALOR_EXTREMO = 75;
const TASA_DERIVA_TEMPERATURA_POR_HORA = 15; // cuánto se acerca la temperatura corporal a la del mundo cada hora real
const DRENAJE_EXTRA_POR_HORA_TEMPERATURA = 6; // extra sobre TASA_DECAY_POR_HORA cuando hace demasiado calor/frío

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

/** Restaura un vital concreto (comer/beber, o sumar `caca` al comer) hasta el tope — usado por `personaje:consumir`. Curar `vida` NO pasa por aquí (ver combate.ts:curar sobre Player directamente). */
export function restaurarVital(v: Vitales, vital: "comida" | "bebida" | "sueno" | "estamina" | "caca", cantidad: number): void {
  v[vital] = clamp(v[vital] + cantidad, VITAL_MAX);
}

/**
 * Inanición (docs/GDD_Personaje.md §3.6) — pedido LITERAL del streamer: "si
 * [comida o bebida] se queda en 0 empezaria a hacer daño paulatino al
 * jugador y bajaria su resistencia a casi 0". Mientras comida O bebida
 * estén a 0: `vida` decae `danoPorHora` por hora real (mismo integrador
 * simple que `tickVitales`, sin checkpoint) y `vidaMax` cae al mínimo de
 * nivel 1 (`vidaMaxInanicion`) en vez del que le tocara por su Resistencia
 * real (`vidaMaxNormal`) — "resistencia a casi 0" se interpreta como este
 * EFECTO, nunca tocando la XP/nivel persistidos (perder progreso real por
 * quedarte sin comer sería demasiado punitivo, y encima irrecuperable si el
 * jugador se desconecta hambriento). En cuanto vuelve a comer/beber,
 * `vidaMax` se restaura a `vidaMaxNormal` en la siguiente llamada.
 *
 * `tambienReducirVidaMax` (docs/GDD_Clima.md, pedido 2026-08-30) — el
 * mismo efecto de vidaMax reducido, pero disparado por temperatura corporal
 * extrema (`aplicarTemperaturaCorporal`) en vez de/además de por hambre.
 * Reduce vidaMax igual que la inanición, pero NO daña `vida` por sí solo —
 * pasar frío o calor te debilita mientras dura, no te hace sangrar; el daño
 * paulatino sigue siendo EXCLUSIVO de comida/bebida a 0 de verdad.
 */
export function aplicarInanicion(
  vitalesActuales: { comida: number; bebida: number },
  estado: { vida: number; vidaMax: number },
  vidaMaxNormal: number,
  vidaMaxReducido: number,
  danoPorHora: number,
  horasTranscurridas: number,
  tambienReducirVidaMax = false,
): void {
  if (horasTranscurridas <= 0) return;
  const hambriento = vitalesActuales.comida <= 0 || vitalesActuales.bebida <= 0;
  if (hambriento || tambienReducirVidaMax) {
    if (estado.vidaMax !== vidaMaxReducido) estado.vidaMax = vidaMaxReducido;
    if (hambriento) {
      estado.vida = Math.max(0, Math.min(estado.vida, estado.vidaMax) - danoPorHora * horasTranscurridas);
    } else {
      estado.vida = Math.min(estado.vida, estado.vidaMax); // solo recorta si hacía falta, sin dañar
    }
  } else if (estado.vidaMax !== vidaMaxNormal) {
    estado.vidaMax = vidaMaxNormal;
  }
}

/** Mapea la temperatura del mundo (grados aprox., docs/GDD_Clima.md, `server/src/mundo/clima.ts`) al rango 0-100 de `Vitales.temperatura` — 15°C ~= neutro (50). Placeholder de balance, mismo criterio que el resto. */
export function objetivoTemperaturaCorporal(temperaturaMundoC: number): number {
  return clamp(TEMPERATURA_NEUTRA + (temperaturaMundoC - 15) * 2.5, VITAL_MAX);
}

/**
 * Temperatura corporal (docs/GDD_Clima.md, pedido LITERAL del streamer:
 * "regula la temperatura de cada jugador... si pasa un rango tanto para
 * arriba como para abajo, a más calor resistencia baja antes y debes beber
 * más, si es hacia abajo resistencia también baja y necesitas comer más").
 * Deriva hacia `objetivoTemperaturaCorporal(temperaturaMundoC)` cada hora
 * real (integrador simple, mismo criterio que `tickVitales` — vive fuera de
 * ahí porque necesita un dato externo, la temperatura del mundo, que
 * `tickVitales` no recibe). Fuera del rango cómodo, gasta el vital que
 * corresponda MÁS RÁPIDO (calor -> bebida, frío -> comida) — el llamador
 * (`RoomExteriorBase`) decide qué hacer con el "extremo" devuelto (pasarlo
 * a `aplicarInanicion` como `tambienReducirVidaMax`).
 */
export function aplicarTemperaturaCorporal(v: Vitales, temperaturaMundoC: number, horasTranscurridas: number): "calor" | "frio" | null {
  if (horasTranscurridas <= 0) return null;
  const objetivo = objetivoTemperaturaCorporal(temperaturaMundoC);
  const pasoMax = TASA_DERIVA_TEMPERATURA_POR_HORA * horasTranscurridas;
  const delta = Math.max(-pasoMax, Math.min(pasoMax, objetivo - v.temperatura));
  v.temperatura = clamp(v.temperatura + delta, VITAL_MAX);
  if (v.temperatura >= UMBRAL_CALOR_EXTREMO) {
    v.bebida = clamp(v.bebida - DRENAJE_EXTRA_POR_HORA_TEMPERATURA * horasTranscurridas, VITAL_MAX);
    return "calor";
  }
  if (v.temperatura <= UMBRAL_FRIO_EXTREMO) {
    v.comida = clamp(v.comida - DRENAJE_EXTRA_POR_HORA_TEMPERATURA * horasTranscurridas, VITAL_MAX);
    return "frio";
  }
  return null;
}
