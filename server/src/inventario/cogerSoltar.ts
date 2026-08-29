/**
 * "Coger del mundo / soltar al suelo" — fase 2 del inventario (pedido
 * 2026-08-29, docs/GDD_Inventario.md §7). PURA (sin Colyseus), mismo patrón
 * que inventario.ts/construccion.ts: las rooms solo resuelven QUÉ hay cerca
 * (bake exterior, objetos "sobre" de interior, drops de otros jugadores) y
 * llaman a esto para mutar el Contenedor.
 *
 * `intentarCoger` NO usa `agregarItem` a pelo: esa función puede dejar el
 * contenedor A MEDIAS si la cantidad no cabe entera (apila lo que puede y
 * solo falla al intentar abrir una pila nueva — documentado en su propio
 * comentario). Para que "coger" sea todo-o-nada de verdad (si falla, el
 * mundo no ha perdido nada y el jugador no ha ganado nada a medias) se
 * snapshotea el contenedor antes y se restaura entero si falla.
 */

import { CatalogoItems, Contenedor, agregarItem } from "./inventario";

export interface Cogible {
  itemId: string;
  cantidad: number;
}

export interface ResultadoCoger {
  ok: boolean;
  motivo?: "sin_hueco" | "item_desconocido";
}

export function intentarCoger(contenedor: Contenedor, catalogo: CatalogoItems, cogible: Cogible): ResultadoCoger {
  const itemsAntes = contenedor.items.map((it) => ({ ...it }));
  const siguienteIdAntes = contenedor.siguienteId;

  const resultado = agregarItem(contenedor, catalogo, cogible.itemId, cogible.cantidad);
  if (!resultado.ok) {
    contenedor.items = itemsAntes;
    contenedor.siguienteId = siguienteIdAntes;
    return { ok: false, motivo: resultado.motivo };
  }
  return { ok: true };
}
