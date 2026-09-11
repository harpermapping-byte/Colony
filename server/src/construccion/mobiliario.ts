/**
 * Mobiliario del carpintero (docs/GDD_Construccion.md §9, pedido streamer
 * 2026-09-11: "estanterías de poción que se vean las pociones al colocarla,
 * son inventarios más limitados pero visuales... sofás de 1 o 2 plazas...
 * camas de diferentes tiers... si hago caja, pues tiene inventario").
 *
 * Funciones PURAS sobre los campos nuevos de `interiores/catalogo/elementos.json`
 * (`plazas`, `calidadDescanso`, `aceptaItems`, `expositor`) que consume
 * RoomExteriorBase.ts — separadas del room para poder testearlas sin
 * Colyseus y para que el cliente (que replica la misma idea en el panel del
 * cofre) tenga una única definición del contrato.
 */
import type { Contenedor, EntradaCatalogoItem } from "../inventario/inventario";
import type { EntradaConstruible, FiltroAceptaItems } from "./catalogo";

/** Tope de ítems que se DIBUJAN encima de un expositor — una estantería 8x6 con 48 huecos llenos no necesita 48 props para leerse como "llena". */
export const MAX_EXPUESTOS = 24;

/**
 * ¿Admite este mueble el ítem? Sin filtro (o filtro vacío) admite todo —
 * un cofre normal. Con filtro, basta con cumplir CUALQUIERA de sus listas:
 * `ids` exactos, `prefijos` del itemId, `tipos` de catálogo (arma/armadura/
 * herramienta/libro/semilla/consumible/equipable...) o `slots` de equipo
 * (anillo/cuello/brazalete para una vitrina de joyas, capa/casco para un
 * perchero). Los prefijos permiten filtrar familias que el catálogo no
 * etiqueta por `tipo` (pociones = consumibles con id `pocion_*`/`elixir_*`).
 */
export function aceptaItemEnMueble(
  filtro: FiltroAceptaItems | undefined,
  itemId: string,
  entradaItem: EntradaCatalogoItem | undefined,
): boolean {
  if (!filtro) return true;
  const hayCriterio = (filtro.ids?.length ?? 0) + (filtro.prefijos?.length ?? 0) + (filtro.tipos?.length ?? 0) + (filtro.slots?.length ?? 0) > 0;
  if (!hayCriterio) return true;
  if (filtro.ids?.includes(itemId)) return true;
  if (filtro.prefijos?.some((p) => itemId.startsWith(p))) return true;
  if (entradaItem) {
    if (filtro.tipos?.includes(entradaItem.tipo)) return true;
    if (entradaItem.slotEquipo && filtro.slots?.includes(entradaItem.slotEquipo)) return true;
  }
  return false;
}

/**
 * Lista de itemIds a dibujar sobre un expositor, en orden de rejilla
 * (fila a fila, izquierda a derecha) para que el jugador vea "lo primero
 * que metió, primero" y la disposición sea estable entre patches. Un ítem
 * apilado cuenta UNA vez (un montón de 10 pociones es una botella visible).
 */
export function expuestosDe(contenedor: Contenedor | undefined): string[] {
  if (!contenedor) return [];
  return [...contenedor.items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, MAX_EXPUESTOS)
    .map((it) => it.itemId);
}

/** Cuántos jugadores caben A LA VEZ en un asiento/cama — ausente o inválido = 1 (el comportamiento de siempre). */
export function plazasDe(entrada: EntradaConstruible | undefined): number {
  const p = entrada?.plazas;
  return typeof p === "number" && Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
}

/**
 * Multiplicador de la duración del buff "descansado" al dormir en esa cama
 * (docs/GDD_Mecanicas.md §5.12): una cama de pino da el rato de siempre,
 * una noble con dosel el doble. Acotado para que un dato raro del catálogo
 * nunca dé un buff eterno ni nulo.
 */
export function factorDescansoDe(entrada: EntradaConstruible | undefined): number {
  const c = entrada?.calidadDescanso;
  if (typeof c !== "number" || !Number.isFinite(c)) return 1;
  return Math.min(4, Math.max(0.25, c));
}
