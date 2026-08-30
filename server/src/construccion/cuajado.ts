/**
 * Cuajado de leche (docs/GDD_Cocina.md, cocina v2 2026-08-30) — PURO (sin
 * Colyseus/BD/fs), mismo patrón que curtido.ts: el mueble `recipiente_queso`
 * procesa UN ÚNICO lote a la vez, resuelto por timestamp cuando alguien lo
 * toca — sin tick de servidor. A diferencia del curtidor (material a granel
 * + piezas discretas), aquí solo hay UN insumo a granel (leche) y la
 * elección de meter sal o no decide el resultado: leche sola, tiempo corto,
 * da mantequilla; leche + sal, tiempo largo, da queso ("stats potentes"
 * pedido explícito). No se reusa curtido.ts tal cual porque su modelo
 * (material a granel + lote de PIEZAS distintas al material) no encaja con
 * "solo hay leche, y el resultado depende de si añadiste sal" — más simple
 * escribirlo aparte que forzar el encaje.
 */

export interface LoteQueso {
  cantidadLeche: number;
  conSal: boolean;
  /** epoch ms real (Date.now()) — NUNCA horas de mundo, mismo criterio que curtido.ts/cadaveres.ts. */
  iniciadoEn: number;
}

export interface EstadoQuesera {
  /** leche a granel cargada, a la espera de que alguien arranque un lote. */
  stockLeche: number;
  lote?: LoteQueso;
}

export function estadoQueseraInicial(): EstadoQuesera {
  return { stockLeche: 0 };
}

/** Horas reales que tarda cada resultado — mantequilla es un batido corto, queso es una cura larga. */
export const HORAS_MANTEQUILLA = 2;
export const HORAS_QUESO = 8;
/** Leche consumida por lote, sea cual sea el resultado. */
export const LECHE_POR_LOTE = 4;
/** Sal que hace falta para elegir queso en vez de mantequilla — la consume el jugador de SU inventario al arrancar el lote (RoomExteriorBase.ts), no es stock a granel del mueble: 1 unidad no merece el mecanismo de "cargar material" del curtidor. */
export const SAL_POR_LOTE_QUESO = 1;

/**
 * Arranca un lote nuevo: exige que NO haya ya uno en curso y que el stock
 * de leche cubra `LECHE_POR_LOTE` — la sal (si `conSal`) la valida y
 * consume el llamador ANTES de invocar esto (ver SAL_POR_LOTE_QUESO). No
 * muta `estado` (devuelve uno nuevo); `null` si no se puede arrancar.
 */
export function iniciarLoteQueso(estado: EstadoQuesera, conSal: boolean, ahoraMs: number): EstadoQuesera | null {
  if (estado.lote) return null;
  if (estado.stockLeche < LECHE_POR_LOTE) return null;
  return { stockLeche: estado.stockLeche - LECHE_POR_LOTE, lote: { cantidadLeche: LECHE_POR_LOTE, conSal, iniciadoEn: ahoraMs } };
}

/** itemId del resultado del lote en curso — solo tiene sentido si hay lote. */
export function resultadoLote(lote: LoteQueso): "queso" | "mantequilla" {
  return lote.conSal ? "queso" : "mantequilla";
}

function horasDelLote(lote: LoteQueso): number {
  return lote.conSal ? HORAS_QUESO : HORAS_MANTEQUILLA;
}

/** ¿Ya pasaron las horas necesarias desde que se inició el lote en curso? `false` si no hay ningún lote. */
export function loteQuesoListo(estado: EstadoQuesera, ahoraMs: number): boolean {
  if (!estado.lote) return false;
  return ahoraMs - estado.lote.iniciadoEn >= horasDelLote(estado.lote) * 3_600_000;
}

/** Recolecta el lote terminado: `null` si no hay lote o todavía no está listo. Devuelve el nuevo estado (sin lote, stock intacto) y qué/cuánto entregar. */
export function recolectarLoteQueso(estado: EstadoQuesera, ahoraMs: number): { estado: EstadoQuesera; itemId: "queso" | "mantequilla" } | null {
  if (!loteQuesoListo(estado, ahoraMs)) return null;
  return { estado: { stockLeche: estado.stockLeche }, itemId: resultadoLote(estado.lote!) };
}
