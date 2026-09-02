/**
 * Agricultura por CASILLA — PURO (sin Colyseus/BD/fs), mismo patrón que
 * server/src/cultivo/cultivo.ts pero sobre suelo abierto en vez de una
 * construcción con huella fija (docs/GDD_Carros.md §9, propuesta
 * 2026-09-04: "habrá dos agriculturas", esta es la nueva, en paralelo a
 * la de construcción existente — pendiente de cablear a Colyseus, este
 * módulo es la lógica ya lista y probada para cuando se enganche).
 *
 * Reusa el MISMO catálogo de semillas (`DatosCultivo` en inventario.ts:
 * diasCrecimiento, cosechaRecurrente, cantidadPorCosecha) — solo cambia
 * DÓNDE vive la planta (una casilla suelta identificada por su índice
 * global, no una construcción con huella). Persistencia y el Map en
 * memoria por mapa (mismo criterio que `recolectablesDeMapa`, pero con
 * escritura a BD) viven en la capa de Room, no aquí.
 */

export type EstadoCasilla = "labrada" | "sembrada";

export interface EstadoCasillaCultivo {
  estado: EstadoCasilla;
  duenoId: number;
  /** Solo con estado "sembrada". */
  semillaId?: string;
  /** tiempoMundo().dia en que se plantó — solo con estado "sembrada". */
  diaPlantado?: number;
}

export interface ResultadoAccionCasilla<T = void> {
  ok: boolean;
  motivo?: "ya_labrada" | "sin_labrar" | "no_es_tuya" | "ya_sembrada" | "no_madura";
  valor?: T;
}

/** Labra una casilla vacía (sin entrada todavía en el mapa de casillas de cultivo) — deja "labrada", lista para sembrar. Labrar una casilla ya labrada/sembrada se rechaza (hay que cosechar/esperar antes de volver a arar). */
export function labrar(existente: EstadoCasillaCultivo | undefined, duenoId: number): ResultadoAccionCasilla<EstadoCasillaCultivo> {
  if (existente) return { ok: false, motivo: "ya_labrada" };
  return { ok: true, valor: { estado: "labrada", duenoId } };
}

/** Siembra una semilla en una casilla YA labrada y vacía, del mismo dueño. */
export function plantar(
  casilla: EstadoCasillaCultivo | undefined,
  semillaId: string,
  duenoId: number,
  diaActual: number,
): ResultadoAccionCasilla<EstadoCasillaCultivo> {
  if (!casilla) return { ok: false, motivo: "sin_labrar" };
  if (casilla.duenoId !== duenoId) return { ok: false, motivo: "no_es_tuya" };
  if (casilla.estado !== "labrada") return { ok: false, motivo: "ya_sembrada" };
  return { ok: true, valor: { estado: "sembrada", duenoId, semillaId, diaPlantado: diaActual } };
}

/** ¿Lista para cosechar? Han pasado `diasCrecimiento` desde que se plantó. A diferencia de cultivo.ts (bancales) NO hay bloqueo por agua todavía — la agricultura de casilla no modela riego en esta v1 (GDD_Carros.md §9.1: "sin chequeo de tipo de suelo/humedad por ahora"). */
export function listaParaCosechar(casilla: EstadoCasillaCultivo | undefined, diasCrecimiento: number, diaActual: number): boolean {
  if (!casilla || casilla.estado !== "sembrada" || casilla.diaPlantado == null) return false;
  return diaActual - casilla.diaPlantado >= diasCrecimiento;
}

export interface ResultadoCosechaCasilla {
  cantidad: number;
  /** Estado de la casilla tras cosechar: recurrente = sigue "sembrada" con el ciclo reiniciado; no recurrente = vuelve a "labrada" vacía (a diferencia de un bancal no recurrente, aquí NO hace falta re-arar — solo volver a plantar, sembrar es la acción barata). */
  siguienteCasilla: EstadoCasillaCultivo;
}

/** Cosecha ya validada (llamar solo si `listaParaCosechar` dio true). */
export function cosechar(
  casilla: EstadoCasillaCultivo,
  cantidadPorCosecha: number,
  cosechaRecurrente: boolean,
  diaActual: number,
): ResultadoCosechaCasilla {
  const siguienteCasilla: EstadoCasillaCultivo = cosechaRecurrente
    ? { estado: "sembrada", duenoId: casilla.duenoId, semillaId: casilla.semillaId, diaPlantado: diaActual }
    : { estado: "labrada", duenoId: casilla.duenoId };
  return { cantidad: cantidadPorCosecha, siguienteCasilla };
}
