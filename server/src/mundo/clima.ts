/**
 * Clima del SERVIDOR — misma fórmula determinista que
 * `client/src/mundo/clima.ts`, con `assets/mundo/clima.json` como única
 * fuente (docs/GDD_Clima.md). Cero red: servidor y cliente calculan el
 * MISMO resultado sin sincronizar nada — igual que ya hace `tiempoMundo()`
 * con la hora.
 *
 * Pasada 2026-09-01 (nieve/lluvia/niebla/viento, pedido del streamer):
 * - Temperatura: UNA curva anual continua (coseno, sin saltos entre
 *   estaciones) + oscilación diaria de siempre encima.
 * - El clima ya no es "un estado fijo todo el día": son 4 franjas de 6h
 *   con tirada independiente cada una.
 * - "lluvia" y "nieve" dejan de ser estados propios del catálogo: el
 *   catálogo solo decide si una franja es `precipitacion`; el tipo
 *   concreto (lluvia si hace >umbralNieveC, nieve si no) lo pone la
 *   temperatura DE ESA FRANJA — así "nieva siempre entre -5 y 5 grados"
 *   sale solo, sin tabla aparte que mantener sincronizada a mano.
 */
import * as climaJson from "../../../assets/mundo/clima.json";
import { DIAS_POR_ANIO, estacionYDiaDelAnio } from "./tiempoMundo";

export type Estacion = "primavera" | "verano" | "otono" | "invierno";

export interface EstadoClima {
  tipo: string; // soleado | nublado | lluvia | nieve | viento
  temperaturaC: number;
}

const FRANJAS = climaJson.franjas as { id: string; horaInicio: number; horaRepresentativa: number }[];
const HORA_TARDE = FRANJAS[2].horaRepresentativa;

/** Hash entero determinista (mismo criterio que combate/seleccionArena.ts, adaptado a un número en vez de un string). */
function hashEntero(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Índice de franja (0..3) al que pertenece una hora 0..24. */
export function franjaDeHora(hora: number): number {
  return Math.min(FRANJAS.length - 1, Math.max(0, Math.floor(hora / 6)));
}

/**
 * Estado de catálogo (soleado/nublado/precipitacion/viento) de UNA franja
 * de UN día — determinista por hash(día,franja), nunca cambia a mitad de
 * franja, nunca `Math.random()`. Distinto de `estadoClimaEnHora`: esto NO
 * resuelve todavía si una "precipitacion" es lluvia o nieve.
 */
export function climaDeFranja(dia: number, franjaIdx: number, estacion: Estacion): string {
  const pesos = (climaJson.pesosPorEstacion as Record<Estacion, Record<string, number>>)[estacion];
  const total = Object.values(pesos).reduce((suma, p) => suma + p, 0);
  if (total <= 0) return climaJson.estados[0];
  const r = (hashEntero(dia * 4 + franjaIdx) % 100000) / 100000 * total;
  let acumulado = 0;
  for (const tipo of climaJson.estados) {
    acumulado += pesos[tipo] ?? 0;
    if (r < acumulado) return tipo;
  }
  return climaJson.estados[climaJson.estados.length - 1];
}

/** Temperatura del mundo (grados aprox.): curva anual (coseno, mínimo mitad de invierno, máximo mitad de verano) + oscilación diaria (coseno, mínimo ~03:00, máximo ~15:00) encima. */
export function temperaturaMundo(diaDelAnio: number, hora: number): number {
  const faseAnual = ((diaDelAnio - climaJson.diaPicoVeranoDelAnio + DIAS_POR_ANIO) % DIAS_POR_ANIO) / DIAS_POR_ANIO * Math.PI * 2;
  const base = climaJson.temperaturaMediaAnualC + climaJson.amplitudAnualC * Math.cos(faseAnual);
  const faseHora = ((hora - 15 + 24) % 24) / 24 * Math.PI * 2;
  return base + (climaJson.amplitudDiariaC / 2) * Math.cos(faseHora);
}

/** "precipitacion" se resuelve a lluvia/nieve según la temperatura dada; el resto de estados pasan tal cual. */
export function tipoConcreto(estado: string, temperaturaC: number): string {
  if (estado !== "precipitacion") return estado;
  return temperaturaC <= climaJson.umbralNieveC ? "nieve" : "lluvia";
}

/** ¿Nevó en esta franja concreta? (precipitacion + temperatura de la franja en la banda de nieve). Para el acumulador de nieve (nieve.ts). */
export function nevoEnFranja(dia: number, franjaIdx: number, estacion: Estacion, diaDelAnio: number): boolean {
  const estado = climaDeFranja(dia, franjaIdx, estacion);
  const tempFranja = temperaturaMundo(diaDelAnio, FRANJAS[franjaIdx].horaRepresentativa);
  return tipoConcreto(estado, tempFranja) === "nieve";
}

/** ¿Nevó en ALGUNA de las 4 franjas de este día? — "sube el nivel si nevó algo ese día" (nieve.ts). */
export function algunaFranjaNevo(dia: number, estacion: Estacion, diaDelAnio: number): boolean {
  for (let f = 0; f < FRANJAS.length; f++) if (nevoEnFranja(dia, f, estacion, diaDelAnio)) return true;
  return false;
}

/** ¿Llovió en ALGUNA de las 4 franjas de este día? — para cultivo.ts ("la lluvia sube el riego al 100", pedido del streamer). */
export function algunaFranjaLlovio(dia: number, estacion: Estacion, diaDelAnio: number): boolean {
  for (let f = 0; f < FRANJAS.length; f++) {
    const estado = climaDeFranja(dia, f, estacion);
    const tempFranja = temperaturaMundo(diaDelAnio, FRANJAS[f].horaRepresentativa);
    if (tipoConcreto(estado, tempFranja) === "lluvia") return true;
  }
  return false;
}

/** Temperatura de la franja "tarde" (representativa del deshielo diario) — nieve.ts la usa para decidir si el nivel de nieve baja ese día. */
export function temperaturaTarde(diaDelAnio: number): number {
  return temperaturaMundo(diaDelAnio, HORA_TARDE);
}

/**
 * Clima + temperatura de un instante exacto (hora fraccional): el TIPO
 * (soleado/lluvia/nieve/...) es el de la franja a la que pertenece esa
 * hora (no cambia dentro de la franja); la TEMPERATURA es la curva
 * continua real de esa hora (no se queda pegada al valor representativo
 * de la franja, para que el frío/calor del cuerpo no dé saltos raros).
 */
export function estadoClimaEnHora(dia: number, hora: number, estacion: Estacion, diaDelAnio: number): EstadoClima {
  const franjaIdx = franjaDeHora(hora);
  const estado = climaDeFranja(dia, franjaIdx, estacion);
  const tempFranja = temperaturaMundo(diaDelAnio, FRANJAS[franjaIdx].horaRepresentativa);
  return { tipo: tipoConcreto(estado, tempFranja), temperaturaC: temperaturaMundo(diaDelAnio, hora) };
}

/** Conveniencia: igual que `estadoClimaEnHora` pero deriva estación/día-del-año ella misma a partir del día de mundo entero — para llamadas que solo tienen `dia`/`hora` a mano (tiempoMundo().dia). */
export function estadoClimaDelDia(dia: number, hora: number): EstadoClima {
  const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
  return estadoClimaEnHora(dia, hora, estacion as Estacion, diaDelAnio);
}

/** Conveniencia: igual que `temperaturaMundo` pero deriva día-del-año ella misma a partir del día de mundo entero. */
export function temperaturaMundoDelDia(dia: number, hora: number): number {
  return temperaturaMundo(estacionYDiaDelAnio(dia).diaDelAnio, hora);
}
