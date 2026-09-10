/**
 * Persecución automática de la presa por el JUGADOR (docs/GDD_Caza.md §4ter,
 * 2026-09-10) — la pieza pura, sin Colyseus, que decide hacia dónde anda el
 * cazador en cada tick mientras no toque ninguna tecla de movimiento.
 *
 * Por qué vive en el SERVIDOR y no en el cliente (donde estuvo la primera
 * versión de ese mismo día): el e2e real con una liebre destapó que un
 * cliente lento (o con la pestaña en segundo plano) manda su `input`
 * hacia la presa con segundos de retraso, y que sin ninguna esquiva el
 * jugador se quedaba clavado contra el primer árbol/roca/orilla mientras
 * la presa seguía huyendo "sin límite" hasta salir del radio de interés —
 * la persecución moría en silencio. El servidor ya es quien mueve al
 * jugador a 30hz con colisión real (`actualizarMovimiento`), así que el
 * rumbo se decide aquí, tick a tick, con la posición REAL de ambos y una
 * esquiva simple (mismo criterio "nunca A* en vivo" que la propia fauna,
 * `huirDe`/`perseguirA`): si el jugador lleva unos ticks sin avanzar lo
 * que debería, desvía el rumbo un ángulo fijo durante un rato y luego
 * vuelve a apuntar directo. Cualquier `input` real del jugador manda
 * siempre (cancela la persecución en el acto).
 */

/** Casillas — si el cazador queda más lejos que esto de su presa, la caza se cancela sola (`caza:perdida`). Por debajo del radio de interés (70, `RADIO_INTERES_TILES`) A PROPÓSITO: el cliente sigue viendo a la presa cuando le llega el aviso, nunca "desaparece" antes. */
export const RADIO_PERDIDA_CAZA = 60;
/** Casillas — más cerca que esto el cazador deja de empujar hacia la presa (el tick de fauna, a 5hz, resuelve la captura a `RADIO_CAPTURA`=1.5; empujar más solo haría vibrar al jugador encima del animal). */
export const DISTANCIA_PARADA = 0.9;
/** Ticks seguidos (a 30hz) sin avanzar lo esperado antes de probar un rumbo desviado. */
const TICKS_PARA_DESVIAR = 6;
/** Ticks que se mantiene cada rumbo desviado antes de volver a apuntar directo a la presa. */
const TICKS_DE_DESVIO = 15;
/** Fracción del paso esperado por debajo de la cual un tick cuenta como "atascado". */
const FRACCION_ATASCO = 0.25;
/** Ángulos de esquiva, probados en este orden cíclico (radianes) — los pequeños primero, así un tronco suelto se rodea sin dar media vuelta. */
const DESVIOS = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];

export interface EstadoPersecucion {
  ticksAtascado: number;
  desvioIdx: number;
  ticksDesvioRestantes: number;
  /** Posición del cazador en el tick anterior y cuánto debía haber avanzado desde entonces (0 = no se le pidió moverse). */
  ultimaX: number;
  ultimaY: number;
  pasoAnterior: number;
}

export function nuevoEstadoPersecucion(x: number, y: number): EstadoPersecucion {
  return { ticksAtascado: 0, desvioIdx: -1, ticksDesvioRestantes: 0, ultimaX: x, ultimaY: y, pasoAnterior: 0 };
}

/**
 * Rumbo unitario (o {0,0} si ya está pegado) del cazador hacia su presa
 * para ESTE tick, mutando `estado`. `paso` = cuánto va a avanzar el
 * cazador este tick si nada lo bloquea (vel * dt) — sirve para juzgar el
 * tick anterior: si desde la última llamada avanzó menos de
 * FRACCION_ATASCO de lo pedido, cuenta como atascado.
 */
export function direccionPersecucion(
  estado: EstadoPersecucion,
  cazador: { x: number; y: number },
  presa: { x: number; y: number },
  paso: number,
): { x: number; y: number } {
  // 1) Juzga el tick anterior con la posición real de ahora.
  if (estado.pasoAnterior > 0) {
    const avanzado = Math.hypot(cazador.x - estado.ultimaX, cazador.y - estado.ultimaY);
    if (avanzado < estado.pasoAnterior * FRACCION_ATASCO) estado.ticksAtascado++;
    else estado.ticksAtascado = 0;
  }
  if (estado.ticksAtascado >= TICKS_PARA_DESVIAR) {
    estado.ticksAtascado = 0;
    estado.desvioIdx = (estado.desvioIdx + 1) % DESVIOS.length;
    estado.ticksDesvioRestantes = TICKS_DE_DESVIO;
  }
  estado.ultimaX = cazador.x;
  estado.ultimaY = cazador.y;

  // 2) Rumbo de este tick.
  const dx = presa.x - cazador.x;
  const dy = presa.y - cazador.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= DISTANCIA_PARADA) {
    estado.pasoAnterior = 0;
    return { x: 0, y: 0 };
  }
  let ang = Math.atan2(dy, dx);
  if (estado.ticksDesvioRestantes > 0) {
    ang += DESVIOS[estado.desvioIdx];
    estado.ticksDesvioRestantes--;
  }
  estado.pasoAnterior = paso;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}
