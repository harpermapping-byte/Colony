/**
 * Catálogo de eventos de "puntos de canal" (docs/GDD_Twitch.md, pedido
 * 2026-08-30) — dos pools ("malo"/"bueno"), cada canje elige UNO al azar de
 * su pool, cooldown de 5 min POR POOL (separados entre sí). Módulo PURO —
 * la aplicación real de cada efecto vive en `gestorTwitch.ts` (que sí toca
 * BD/rooms); aquí solo el catálogo y las reglas de cooldown/sorteo, para
 * poder testear la selección sin levantar un servidor.
 */

export type TipoEvento = "malo" | "bueno";

export interface EntradaEvento {
  id: string;
  nombre: string;
  tipo: TipoEvento;
  /** cuánto dura el efecto en el mundo, en ms (0 = instantáneo, no hay "activo/inactivo" que mantener). */
  duracionMs: number;
}

const DOS_MIN = 2 * 60_000;
const CINCO_MIN = 5 * 60_000;

export const EVENTOS_MALOS: EntradaEvento[] = [
  { id: "tormenta_rayos", nombre: "Tormenta de rayos", tipo: "malo", duracionMs: CINCO_MIN },
  { id: "eclipse", nombre: "Eclipse", tipo: "malo", duracionMs: DOS_MIN },
  { id: "plaga_ratas", nombre: "Plaga de ratas", tipo: "malo", duracionMs: DOS_MIN },
  { id: "corralito", nombre: "El Corralito", tipo: "malo", duracionMs: CINCO_MIN },
  { id: "terremoto", nombre: "Terremoto", tipo: "malo", duracionMs: 60_000 },
];

export const EVENTOS_BUENOS: EntradaEvento[] = [
  { id: "lluvia_dinero", nombre: "Lluvia de dinero", tipo: "bueno", duracionMs: 0 },
  { id: "hay_que_trabajar", nombre: "Hay que trabajar", tipo: "bueno", duracionMs: CINCO_MIN },
  { id: "mercado_oferta", nombre: "Mercado en oferta", tipo: "bueno", duracionMs: CINCO_MIN },
  { id: "bendicion_gremio", nombre: "Bendición de gremio", tipo: "bueno", duracionMs: 0 },
];

export function poolDe(tipo: TipoEvento): EntradaEvento[] {
  return tipo === "malo" ? EVENTOS_MALOS : EVENTOS_BUENOS;
}

/** Elige un evento al azar del pool pedido — `azar` inyectable solo para tests deterministas (por defecto Math.random real). */
export function elegirEventoAleatorio(tipo: TipoEvento, azar: () => number = Math.random): EntradaEvento {
  const pool = poolDe(tipo);
  return pool[Math.floor(azar() * pool.length)];
}

export const COOLDOWN_CANJE_MS = CINCO_MIN;

/** `true` si ya pasó el cooldown desde `ultimoEn` (epoch ms) — `null`/`undefined` = nunca se activó, siempre listo. */
export function cooldownCumplido(ultimoEn: number | null | undefined, ahora: number = Date.now()): boolean {
  if (ultimoEn == null) return true;
  return ahora - ultimoEn >= COOLDOWN_CANJE_MS;
}
