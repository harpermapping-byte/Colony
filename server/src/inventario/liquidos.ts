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

/** docs/GDD_Carros.md §8.5 (Fase 2, pedido 2026-09-03) — líquido a granel de una cisterna de carro (no es un ItemInstancia, no tiene huella/apilable). */
export interface LiquidoGranel {
  tipo: string;
  volumenMl: number;
  volumenMaxMl: number;
}

/**
 * Vierte de una cisterna (`origen`, a granel) a un recipiente portable
 * (`destino`) hasta llenarlo o hasta vaciar la cisterna, lo que ocurra
 * antes — docs/GDD_Carros.md §8.5: "mecanismo NUEVO, no existe transferencia
 * contenedor→contenedor hoy, solo cisterna→olla vía vaciado total". A
 * diferencia de `llenar` (sustituye entero), esto SUMA sobre lo que ya
 * llevara el destino si es el MISMO tipo de líquido; si el destino ya tiene
 * un líquido DISTINTO no se mezcla (rechaza, transferido=0 — todo o nada,
 * mismo criterio que el resto del inventario). Muta origen y destino en
 * sitio; devuelve cuánto se transfirió de verdad.
 */
export function transferirLiquido(origen: LiquidoGranel, destino: ItemInstancia, entradaDestino: EntradaCatalogoItem): number {
  if (!esRecipienteLiquido(entradaDestino) || origen.volumenMl <= 0) return 0;
  if (destino.liquido && destino.liquido.volumenMl > 0 && destino.liquido.tipo !== origen.tipo) return 0;
  const yaEnDestino = destino.liquido?.volumenMl ?? 0;
  const hueco = entradaDestino.volumenMaxMl! - yaEnDestino;
  const transferido = Math.min(hueco, origen.volumenMl);
  if (transferido <= 0) return 0;
  destino.liquido = { tipo: origen.tipo, volumenMl: yaEnDestino + transferido, contaminada: destino.liquido?.contaminada ?? false };
  origen.volumenMl -= transferido;
  return transferido;
}
