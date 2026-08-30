/**
 * Procesar un cadáver ENTERO ya recogido (docs/GDD_Caza.md, pedido
 * 2026-08-30 octava pasada): "podrías coger su cadáver, transportarlo,
 * despellejarlo ahí mismo o despiezarlo ahí mismo (tardas mucho más tiempo y
 * da menos material)... en cambio si lo haces en [mesa_despiece/mesa_corte]
 * te da más material, tardas mucho menos". Módulo PURO (sin Colyseus/BD/fs)
 * — mismo patrón que curtido.ts/lootCaza.ts: no sabe de sesiones ni de
 * inventario real, solo calcula duración y resultado a partir de datos.
 *
 * Trabaja SOLO con el itemId del cadáver (`datosDeCadaver`, lootCaza.ts) —
 * no hace falta la especie exacta ni tocar ItemInstancia con un campo nuevo:
 * el itemId YA codifica carne+piel+tamaño desde que se generó el loot.
 *
 * Verbo "desollar" -> piel (+ tirada de trofeo, igual en campo que en mesa:
 * el streamer no pidió que cambiara). Verbo "despiezar" -> carne/tendones/
 * tripas/grasa. Ambos consumen el MISMO ítem "cadáver entero" — puedes
 * elegir cuál hacer primero (o solo uno), el cadáver desaparece al procesarlo
 * cualquiera de las dos veces (mismo cadáver, dos posibles destinos —
 * decisión explícita: no hace falta desollar Y despiezar la misma pieza).
 */
import { TABLA_LOOT_CAZA, PROBABILIDAD_TROFEO, datosDeCadaver } from "./lootCaza";

export type VerboDespiece = "desollar" | "despiezar";

const TIEMPO_BASE_SEG: Record<VerboDespiece, number> = { desollar: 15, despiezar: 20 };

/** "Tardas mucho más tiempo" en el sitio — 3x el tiempo de mesa, mismo orden de magnitud que otros multiplicadores de esta serie de pedidos. */
export const MULTIPLICADOR_TIEMPO_CAMPO = 3;
/** "Da menos material" en el sitio — mitad del rendimiento completo de mesa. */
export const FRACCION_MATERIAL_CAMPO = 0.5;

export interface EstadoDespiece {
  /** instanciaId del ítem "cadáver entero" en el inventario del jugador — se re-verifica al recolectar (por si lo soltó/movió mientras esperaba). */
  itemInstanciaId: number;
  cadaverItemId: string;
  verbo: VerboDespiece;
  /** true = se inició junto a mesa_despiece/mesa_corte (más rápido, más material). */
  enMesa: boolean;
  /** epoch ms en que termina — calculado UNA VEZ al iniciar, nunca recalculado mientras está en curso (mismo criterio que EstadoCrafteo.terminaEn). */
  terminaEn: number;
}

/** Arranca el procesado — no muta nada externo, el llamador decide cuándo consumir el ítem/guardar el estado. */
export function iniciarDespiece(
  itemInstanciaId: number,
  cadaverItemId: string,
  verbo: VerboDespiece,
  enMesa: boolean,
  ahoraMs: number,
): EstadoDespiece {
  const baseMs = TIEMPO_BASE_SEG[verbo] * 1000;
  const duracionMs = enMesa ? baseMs : baseMs * MULTIPLICADOR_TIEMPO_CAMPO;
  return { itemInstanciaId, cadaverItemId, verbo, enMesa, terminaEn: ahoraMs + duracionMs };
}

/** `true` cuando el procesado en curso ya puede recogerse — comparación pura, sin tick. */
export function despiezeListo(estado: EstadoDespiece, ahoraMs: number): boolean {
  return ahoraMs >= estado.terminaEn;
}

export interface ResultadoDespiece {
  carne?: { itemId: string; cantidad: number };
  tendones?: number;
  tripas?: number;
  grasa?: number;
  piel?: { itemId: string; cantidad: number };
  trofeoItemId?: string;
}

/**
 * Escala una cantidad completa (TABLA_LOOT_CAZA) por el factor de campo/mesa
 * — nunca a 0 si la cantidad base era > 0 (siempre queda ALGO, "menos" no es
 * "nada"), redondeado hacia abajo.
 */
function escalarCantidad(cantidadCompleta: number, enMesa: boolean): number {
  if (cantidadCompleta <= 0) return 0;
  if (enMesa) return cantidadCompleta;
  return Math.max(1, Math.floor(cantidadCompleta * FRACCION_MATERIAL_CAMPO));
}

/**
 * Resultado real de recoger un procesado ya listo — puro, determinista salvo
 * el 5% de trofeo (mismo criterio que el antiguo `pielDeDesollado`: `rnd`
 * inyectado, evento EN VIVO no bake, así que no usa el PRNG determinista de
 * `azar.js`). `null` si el itemId del cadáver no resuelve a datos conocidos
 * (no debería pasar — se valida ANTES de guardar el EstadoDespiece).
 */
export function recolectarDespiece(estado: EstadoDespiece, rnd: () => number = Math.random): ResultadoDespiece | null {
  const datos = datosDeCadaver(estado.cadaverItemId);
  if (!datos) return null;
  const cantidades = TABLA_LOOT_CAZA[datos.categoriaVida];

  if (estado.verbo === "despiezar") {
    const resultado: ResultadoDespiece = {
      tendones: escalarCantidad(cantidades.tendones, estado.enMesa),
      tripas: escalarCantidad(cantidades.tripas, estado.enMesa),
      grasa: escalarCantidad(cantidades.grasa, estado.enMesa),
    };
    if (datos.carne) resultado.carne = { itemId: datos.carne, cantidad: escalarCantidad(cantidades.carne, estado.enMesa) };
    return resultado;
  }

  // desollar
  const resultado: ResultadoDespiece = {};
  if (datos.piel) resultado.piel = { itemId: datos.piel, cantidad: escalarCantidad(cantidades.piel, estado.enMesa) };
  if (rnd() < PROBABILIDAD_TROFEO) resultado.trofeoItemId = cantidades.trofeo;
  return resultado;
}
