/**
 * Puente Contenedor puro (inventario.ts, fuente de verdad) -> ContenedorSchema
 * (HubState.ts, lo único que Colyseus replica al cliente). Fase 1 dejó los
 * dos lados definidos pero SIN nada que los conectara — "coger"/"soltar"
 * (fase 2, docs/GDD_Inventario.md §7) son la primera mutación que necesita
 * que el jugador VEA el resultado, así que hacía falta este helper antes de
 * poder cerrar esa fase (bug real detectado en la crítica adversarial del
 * diseño: sin esto, "coger" borra del mundo pero el propio jugador nunca ve
 * el ítem en su inventario).
 *
 * Reconstruye el ArraySchema entero (clear + push) en vez de diferenciar:
 * solo se llama en eventos discretos por jugador (join/coger/soltar), nunca
 * en un tick — barato de sobra a esa frecuencia.
 */

import { Contenedor, SlotsEquipo } from "./inventario";
import { ContenedorSchema, ItemInstanciaSchema, InventarioSchema } from "../rooms/schema/HubState";

export function sincronizarContenedor(schema: ContenedorSchema, puro: Contenedor): void {
  schema.ancho = puro.ancho;
  schema.alto = puro.alto;
  schema.items.clear();
  for (const it of puro.items) {
    const s = new ItemInstanciaSchema();
    s.id = it.id;
    s.itemId = it.itemId;
    s.cantidad = it.cantidad;
    s.x = it.x;
    s.y = it.y;
    s.rot = it.rot;
    schema.items.push(s);
  }
}

/**
 * Puente equipo/extras puros (docs/GDD_Equipo.md) -> InventarioSchema.equipo
 * (MapSchema<string>) / InventarioSchema.extras (MapSchema<ContenedorSchema>)
 * — mismo criterio "reconstruye entero, solo en eventos discretos" que
 * `sincronizarContenedor`: se llama tras equipar/desequipar, nunca en un
 * tick. `schema.cuerpo` se sincroniza aparte con `sincronizarContenedor`
 * (quien llama ya lo hacía para "coger"/"soltar", esto no lo duplica).
 */
export function sincronizarEquipo(schema: InventarioSchema, equipo: SlotsEquipo, extras: Map<string, Contenedor>): void {
  schema.equipo.clear();
  for (const [slot, itemId] of Object.entries(equipo)) {
    if (itemId) schema.equipo.set(slot, itemId);
  }
  schema.extras.clear();
  for (const [slot, contenedor] of extras) {
    const contSchema = new ContenedorSchema();
    sincronizarContenedor(contSchema, contenedor);
    schema.extras.set(slot, contSchema);
  }
}
