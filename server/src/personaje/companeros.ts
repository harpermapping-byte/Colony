/**
 * Compañeros NPC (docs/GDD_Companeros.md, pedido 2026-08-30) — un Npc real
 * de `poblacion/` reclutado por un jugador (contratar por diálogo con tirada
 * de carisma, o comprado a través de un vendedor sin tirada), con hambre/sed
 * simplificada tipo "mascota" y progresión de nivel 1-10. PURA (sin
 * Colyseus/BD), mismo patrón que anatomia.ts/enfermedades.ts: toma/devuelve
 * datos, quien llama (`RoomExteriorBase`) decide sobre qué entidad aplicarlo.
 */

import { generarUmbrales, nivelDeXp } from "../progresion/nivel";

// --- Persuasión (diálogo directo con un NPC, tirada de carisma) ---

/** Probabilidad de convencer a un NPC de unirse como compañero, según el nivel de Carisma (1-10) del jugador — coherente con descuentoComercio (bonusAtributos.ts): sube con el nivel, nunca garantizado del todo. */
export function probabilidadReclutar(nivelCarisma: number): number {
  return Math.min(0.9, 0.3 + (nivelCarisma - 1) * 0.07);
}

/** Tirada de persuasión — puro, el llamador decide qué pasa si falla (nada, se puede reintentar: es una conversación, no un golpe). */
export function intentarPersuadir(nivelCarisma: number, rnd: () => number = Math.random): boolean {
  return rnd() < probabilidadReclutar(nivelCarisma);
}

// --- Coste algorítmico ("a tu elección o algorítmicamente para que cada recluta sea diferente", pedido literal — se eligió algorítmico) ---

const COSTE_BASE_RECLUTAR = 40;
const COSTE_VARIACION_RECLUTAR = 120; // coste final entre 40 y 160 farycoins

function hashSemilla(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coste en farycoins de contratar un NPC concreto — DETERMINISTA por su slot (el mismo NPC siempre cuesta lo mismo, no cambia cada intento), distinto de un NPC a otro. */
export function costeReclutar(npcSlotId: string): number {
  const rnd = mulberry32(hashSemilla(npcSlotId));
  return Math.round(COSTE_BASE_RECLUTAR + rnd() * COSTE_VARIACION_RECLUTAR);
}

// --- Nivel y bonus (reusa la MISMA curva 1-10 ya usada para atributos de jugador — "pones tú los límites de cada nivel", pedido literal: se reusó la ya existente por coherencia) ---

export const UMBRALES_NIVEL_COMPANERO = generarUmbrales(10, 100);

export function nivelCompanero(xp: number): number {
  return nivelDeXp(xp, UMBRALES_NIVEL_COMPANERO);
}

/** Ataque ganado por nivel — modesto y lineal, "coherente, que no se vuelva un boss o un dios": +1 por nivel por encima del 1 (tope nivel 10 = +9). Se SUMA al ataque/defensa de equipo, igual que un jugador. */
export function bonusAtaquePorNivelCompanero(nivel: number): number {
  return nivel - 1;
}

/** Defensa ganada por nivel — la mitad de ritmo que el ataque (tope nivel 10 = +4.5). */
export function bonusDefensaPorNivelCompanero(nivel: number): number {
  return (nivel - 1) * 0.5;
}

// --- Hambre (docs/GDD_Companeros.md): "solo necesita comer y beber, como mecánica de animal salvaje" — UN solo contador simplificado (no las 5 vitales del jugador), con consecuencia real (a diferencia de la fauna salvaje, que no la tiene) ---

/** Horas reales para pasar de 0 a 100 de hambre sin comer nada — mismo orden de magnitud que el hambre del jugador (vitales.ts). */
export const HORAS_PARA_HAMBRE_TOTAL = 24;
/** A partir de aquí intenta comer solo de su propio inventario si tiene algo — no espera a estar muerto de hambre del todo. */
export const UMBRAL_HAMBRE_COME_SOLO = 60;
/** Vida perdida por hora real mientras está en hambre TOTAL (100) y no tiene nada que comer. */
export const DRENAJE_VIDA_POR_HAMBRE_POR_HORA = 2;

export interface EstadoHambreCompanero {
  /** 0 = saciado, 100 = muerto de hambre. */
  hambre: number;
}

export function hambreInicial(): EstadoHambreCompanero {
  return { hambre: 0 };
}

/**
 * Perezoso, mismo integrador horasTranscurridas que tickVitales/aplicarInanicion.
 * Si ya tiene hambre suficiente Y `tieneComida()` dice que sí, se la come sola
 * (el llamador aplica el consumo real vía `consumirComida`, aquí solo se
 * resetea el contador). Si llega a hambre TOTAL sin nada que comer, drena
 * vida y devuelve el mensaje de queja para la burbuja de texto — "buscar"
 * comida activamente (IA de forrajeo) queda FUERA de esta fase, ver GDD §7.
 */
export function resolverHambreCompanero(
  estado: EstadoHambreCompanero,
  horasTranscurridas: number,
  companero: { vida: number },
  tieneComida: () => boolean,
  consumirComida: () => void,
): string | null {
  if (horasTranscurridas <= 0) return null;
  estado.hambre = Math.min(100, estado.hambre + (100 / HORAS_PARA_HAMBRE_TOTAL) * horasTranscurridas);
  if (estado.hambre >= UMBRAL_HAMBRE_COME_SOLO && tieneComida()) {
    consumirComida();
    estado.hambre = 0;
    return null;
  }
  if (estado.hambre >= 100) {
    companero.vida = Math.max(0, companero.vida - DRENAJE_VIDA_POR_HAMBRE_POR_HORA * horasTranscurridas);
    return "Me muero de hambre...";
  }
  return null;
}
