/**
 * Agricultura — PURO (sin Colyseus/BD/fs), mismo patrón que
 * produccion.ts/desgaste.ts: nada de tick de fondo, todo se resuelve
 * comparando `tiempoMundo().dia` (día de MUNDO entero, no horas reales)
 * contra los timestamps guardados en `viva.extra.cultivo` cuando algo lo
 * toca de verdad (sembrar/regar/abonar/cosechar/consultar). Pedido del
 * streamer 2026-08-30: labrar/macetas, agua y fertilizante 0-100 que
 * decaen con el tiempo (el suelo se ve más claro cuanto más bajos están),
 * siembra por meses según la semilla, cosecha única o recurrente según la
 * especie.
 *
 * El agua/fertilizante NO se trackean como un número guardado — se
 * DERIVAN del día en que se regó/abonó por última vez, exactamente igual
 * que el resto del proyecto deriva stock/desgaste de un timestamp en vez
 * de mantenerlo al día con un tick.
 */

export interface EstadoCultivo {
  /** itemId de la semilla plantada — ausente/undefined = parcela vacía, lista para plantar. */
  semillaId?: string;
  /** tiempoMundo().dia en que se plantó (o se reinició tras una cosecha recurrente). */
  diaPlantado?: number;
  /** tiempoMundo().dia del último riego — el agua se DERIVA de esto, nunca se guarda aparte. */
  diaUltimoRiego?: number;
  /** tiempoMundo().dia del último abonado — igual que el riego. */
  diaUltimoAbono?: number;
}

/** De 100 (recién regado) a 0 en 4 días de mundo sin volver a regar. */
export const DECAIMIENTO_AGUA_POR_DIA = 25;
/** El fertilizante aguanta más: de 100 a 0 en unos 8 días de mundo. */
export const DECAIMIENTO_FERTILIZANTE_POR_DIA = 12;

/** Nivel de agua ahora mismo (0-100), derivado de cuántos días de mundo han pasado desde el último riego. Parcela nunca regada = 0. */
export function nivelAgua(estado: EstadoCultivo, diaActual: number): number {
  if (estado.diaUltimoRiego == null) return 0;
  const dias = Math.max(0, diaActual - estado.diaUltimoRiego);
  return Math.max(0, 100 - DECAIMIENTO_AGUA_POR_DIA * dias);
}

/** Igual que `nivelAgua` pero para fertilizante. */
export function nivelFertilizante(estado: EstadoCultivo, diaActual: number): number {
  if (estado.diaUltimoAbono == null) return 0;
  const dias = Math.max(0, diaActual - estado.diaUltimoAbono);
  return Math.max(0, 100 - DECAIMIENTO_FERTILIZANTE_POR_DIA * dias);
}

/** ¿Esta semilla puede plantarse en el mes de mundo actual? */
export function puedeSembrarEnMes(mesesSiembra: number[], mesActual: number): boolean {
  return mesesSiembra.includes(mesActual);
}

/**
 * ¿Está lista para cosechar? Ha pasado `diasCrecimiento` desde que se
 * plantó Y hay algo de agua AHORA MISMO (bloqueo simple: si se deja secar
 * del todo, no se puede cosechar hasta volver a regar — el crecimiento en
 * sí corre por calendario, no día a día "¿se regó hoy?", ver cabecera).
 */
export function listaParaCosechar(estado: EstadoCultivo, diasCrecimiento: number, diaActual: number): boolean {
  if (estado.semillaId == null || estado.diaPlantado == null) return false;
  const diasCrecidos = diaActual - estado.diaPlantado;
  return diasCrecidos >= diasCrecimiento && nivelAgua(estado, diaActual) > 0;
}

export interface ResultadoCosecha {
  cantidad: number;
  /** true = la parcela sigue con la MISMA semilla plantada, reinicia el contador de días; false = la parcela queda vacía. */
  siguePlantada: boolean;
}

/**
 * Resuelve una cosecha ya validada (llamar solo si `listaParaCosechar` dio
 * true): cantidad final = base × multiplicador de la maceta/bancal, +50%
 * si el fertilizante está a más de la mitad en este instante (bonus
 * simple, no bloqueante — a diferencia del agua, que si falta del todo
 * bloquea la cosecha entera).
 */
export function resolverCosecha(
  estado: EstadoCultivo,
  cantidadBase: number,
  cosechaRecurrente: boolean,
  multiplicadorMaceta: number,
  diaActual: number,
): ResultadoCosecha {
  const bonusFertilizante = nivelFertilizante(estado, diaActual) >= 50 ? 1.5 : 1;
  const cantidad = Math.max(1, Math.round(cantidadBase * multiplicadorMaceta * bonusFertilizante));
  return { cantidad, siguePlantada: cosechaRecurrente };
}
