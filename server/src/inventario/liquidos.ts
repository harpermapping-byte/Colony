/**
 * Líquidos en recipientes portables (docs/GDD_Inventario.md §9, pedido
 * 2026-08-30) — PURO (sin Colyseus/fs), mismo patrón que desgaste.ts:
 * un ítem sin `volumenMaxMl` en el catálogo nunca es un recipiente y este
 * módulo no hace nada con él. "Llenar" sustituye el contenido entero — no
 * hay mezcla de dos líquidos a la vez en el mismo recipiente.
 */

import { EntradaCatalogoItem, ItemInstancia } from "./inventario";

/** ¿Esta entrada de catálogo es un recipiente de líquido? */
export function esRecipienteLiquido(entrada: EntradaCatalogoItem): boolean {
  return (entrada.volumenMaxMl ?? 0) > 0;
}

/** ¿Tiene líquido de verdad ahora mismo (volumen > 0)? Opcionalmente, ¿es del tipo esperado ("agua"...)? */
export function tieneLiquido(instancia: ItemInstancia, tipoEsperado?: string): boolean {
  const l = instancia.liquido;
  if (!l || l.volumenMl <= 0) return false;
  return tipoEsperado == null || l.tipo === tipoEsperado;
}

/** Llena el recipiente HASTA SU TOPE con `tipo` — sustituye cualquier líquido anterior (nunca mezcla). No hace nada si la entrada no es un recipiente. */
export function llenar(instancia: ItemInstancia, entrada: EntradaCatalogoItem, tipo: string, contaminada = false): void {
  if (!esRecipienteLiquido(entrada)) return;
  instancia.liquido = { tipo, volumenMl: entrada.volumenMaxMl!, contaminada };
}

/** Vacía el recipiente entero (p.ej. al meterlo en la olla como ingrediente de agua). */
export function vaciar(instancia: ItemInstancia): void {
  instancia.liquido = undefined;
}

/** Resta `volumenMl` del contenido (p.ej. un trago de cantimplora) — nunca baja de 0; si llega a 0, vacía del todo (mismo criterio que quitarItem al agotar cantidad). Devuelve cuánto se pudo beber de verdad. */
export function consumirVolumen(instancia: ItemInstancia, volumenMl: number): number {
  const l = instancia.liquido;
  if (!l || l.volumenMl <= 0) return 0;
  const bebido = Math.min(l.volumenMl, volumenMl);
  const restante = l.volumenMl - bebido;
  if (restante <= 0) instancia.liquido = undefined;
  else instancia.liquido = { ...l, volumenMl: restante };
  return bebido;
}
