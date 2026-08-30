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

// ---------------------------------------------------------------------------
// Injertos y cruces de cultivos (docs/Backlog_Mecanicas_Futuras.md, diseño
// YA CERRADO, construido 2026-08-30 tras confirmación del streamer): "cada
// cultivo tiene 6 atributos numéricos (0-1)... al cruzar A+B, cada atributo
// del resultado = media de los dos padres + variación aleatoria... el
// resultado se registra como especie nueva y permanente, con un nombre
// automático provisional renombrable a mano". `RoomExteriorBase.ts`
// persiste el resultado en la tabla `cultivos_hibridos` (bd.ts) y lo
// funde en el catálogo de ítems en memoria — este módulo solo calcula.
// ---------------------------------------------------------------------------
import { RasgosCultivo } from "../inventario/inventario";

const CLAVES_RASGOS: (keyof RasgosCultivo)[] = [
  "rendimiento",
  "calidad",
  "resistenciaEnfermedad",
  "velocidadCrecimiento",
  "necesidadAgua",
  "tamanoFruto",
];

/** Variación aleatoria del injerto: ±0.12 alrededor de la media de los dos padres — "no genética mendeliana compleja" (pedido explícito del diseño cerrado), acotado siempre a [0,1]. */
export const VARIACION_INJERTO = 0.12;

/** Cada rasgo del resultado = media de los dos padres + variación aleatoria, acotado a [0,1]. */
export function mezclarRasgos(a: RasgosCultivo, b: RasgosCultivo, azar: () => number = Math.random): RasgosCultivo {
  const resultado = {} as RasgosCultivo;
  for (const clave of CLAVES_RASGOS) {
    const media = (a[clave] + b[clave]) / 2;
    const variacion = (azar() * 2 - 1) * VARIACION_INJERTO;
    resultado[clave] = Math.max(0, Math.min(1, media + variacion));
  }
  return resultado;
}

export interface DatosCrecimientoBase {
  diasCrecimiento: number;
  mesesSiembra: number[];
  cosechaRecurrente: boolean;
  cantidadPorCosecha: number;
}

/**
 * Deriva la mecánica de cultivo del híbrido a partir de la de sus dos
 * padres y sus rasgos ya mezclados — el diseño cerrado no lo especifica
 * (queda "pendiente" en el backlog), así que se resuelve con el mismo
 * criterio del resto de esta v1: `velocidadCrecimiento` acelera/frena
 * `diasCrecimiento`, `rendimiento` escala `cantidadPorCosecha`, la
 * siembra se abre a la UNIÓN de los meses de ambos padres (más
 * versátil, coherente con "fomenta que se combinen"), y `cosechaRecurrente`
 * es recesiva-dominante simple: basta que UNO de los padres lo sea.
 */
export function derivarCrecimientoHibrido(a: DatosCrecimientoBase, b: DatosCrecimientoBase, rasgos: RasgosCultivo): DatosCrecimientoBase {
  const diasBase = (a.diasCrecimiento + b.diasCrecimiento) / 2;
  const diasCrecimiento = Math.max(1, Math.round(diasBase * (1.2 - rasgos.velocidadCrecimiento * 0.4)));
  const mesesSiembra = [...new Set([...a.mesesSiembra, ...b.mesesSiembra])].sort((x, y) => x - y);
  const cosechaRecurrente = a.cosechaRecurrente || b.cosechaRecurrente;
  const cantidadBase = (a.cantidadPorCosecha + b.cantidadPorCosecha) / 2;
  const cantidadPorCosecha = Math.max(1, Math.round(cantidadBase * (0.6 + rasgos.rendimiento * 0.8)));
  return { diasCrecimiento, mesesSiembra, cosechaRecurrente, cantidadPorCosecha };
}

/** "Híbrido {A}×{B}" — nombre automático provisional, renombrable a mano (docs/GDD_Agricultura.md §4). */
export function nombreHibrido(nombreA: string, nombreB: string): string {
  return `Híbrido ${nombreA}×${nombreB}`;
}

/** itemId -> texto legible ("fruto_hibrido_x" -> "Fruto Hibrido X") — mismo placeholder que el resto del arte del proyecto, sin catálogo de nombres propios todavía. */
export function nombreLegible(itemId: string): string {
  return itemId
    .replace(/_/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Mezcla dos colorDebug hex ("#rrggbb") a partes iguales — placeholder visual del híbrido hasta que exista arte real. */
export function mezclarColor(hexA: string, hexB: string): string {
  const componentes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const [ra, ga, ba] = componentes(hexA);
  const [rb, gb, bb] = componentes(hexB);
  const canal = (x: number, y: number) => Math.round((x + y) / 2).toString(16).padStart(2, "0");
  return `#${canal(ra, rb)}${canal(ga, gb)}${canal(ba, bb)}`;
}
