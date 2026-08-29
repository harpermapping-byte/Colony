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

import { Contenedor } from "./inventario";
import { ContenedorSchema, ItemInstanciaSchema } from "../rooms/schema/HubState";

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
