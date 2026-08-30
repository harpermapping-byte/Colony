/**
 * Pesca — PURO (sin Colyseus/fs, `azar` inyectable para tests), mismo
 * patrón que desgaste.ts/vitales.ts. Pedido del streamer 2026-08-30:
 * caña + cebo, lanzar junto al agua, boya que espera una picada cada
 * INTERVALO_PICADA_MS con PROBABILIDAD_PICADA de picar; si pica, hay una
 * ventana (VENTANA_REACCION_MS, "la boya se mueve 3 veces") para
 * reaccionar antes de que el pez escape.
 *
 * El temporizador de verdad (Delayed de Colyseus) vive en
 * RoomExteriorBase — este módulo solo decide SI pica y QUÉ pica, para
 * poder testear la probabilidad/reparto sin levantar una room.
 */

export const INTERVALO_PICADA_MS = 5000;
export const PROBABILIDAD_PICADA = 0.5;
/** Puramente informativo para el cliente (cuántos "bocados" anima la boya durante la ventana de reacción) — el servidor no trackea cada uno por separado, solo la ventana total. */
export const MOVIMIENTOS_BOYA = 3;
export const INTERVALO_MOVIMIENTO_BOYA_MS = 1200;
export const VENTANA_REACCION_MS = MOVIMIENTOS_BOYA * INTERVALO_MOVIMIENTO_BOYA_MS;

export interface CapturaPosible {
  itemId: string;
  peso: number;
}

// Sin distinción río/lago/mar por casilla en el servidor todavía (el
// runtime no lee bioma de agua, solo TIPO.AGUA/AGUA_PROFUNDA) — reparto
// genérico entre los 4 recursos de pesca ya existentes en items.json.
// Cuando el servidor conozca el bioma de cada masa de agua, esto puede
// pasar a una tabla por región sin tocar la lógica de aquí.
export const TABLA_CAPTURAS: CapturaPosible[] = [
  { itemId: "pescado_rio", peso: 3 },
  { itemId: "pescado_lago", peso: 3 },
  { itemId: "pescado_mar", peso: 2 },
  { itemId: "marisco", peso: 2 },
];

/** ¿Pica esta vez? (un roll por cada INTERVALO_PICADA_MS transcurrido, mientras se espera). */
export function tocaPicar(azar: () => number = Math.random): boolean {
  return azar() < PROBABILIDAD_PICADA;
}

/** Reparte la captura por peso — determinista dado un `azar` fijo (para tests). */
export function elegirCaptura(tabla: CapturaPosible[] = TABLA_CAPTURAS, azar: () => number = Math.random): string {
  const total = tabla.reduce((suma, c) => suma + c.peso, 0);
  let r = azar() * total;
  for (const c of tabla) {
    if (r < c.peso) return c.itemId;
    r -= c.peso;
  }
  return tabla[tabla.length - 1].itemId; // redondeo de coma flotante en el borde: la última entrada
}
