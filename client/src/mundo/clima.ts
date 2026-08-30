/**
 * Clima del CLIENTE — misma fórmula determinista que
 * `server/src/mundo/clima.ts`, con `assets/mundo/clima.json` como única
 * fuente (docs/GDD_Clima.md, pedido 2026-08-30). Cero red: un estado de
 * clima por DÍA de mundo (`tiempoMundo().dia`), elegido por hash del día —
 * nunca `Math.random()`. Cliente y servidor calculan el MISMO clima en el
 * mismo día sin sincronizar nada — igual que ya hace `tiempoMundo()` con la hora.
 */
import climaJson from "../../../assets/mundo/clima.json";

export type Estacion = "primavera" | "verano" | "otono" | "invierno";

export interface EstadoClima {
  tipo: string; // uno de climaJson.estados
  temperaturaC: number;
}

/** Hash entero determinista (mismo criterio que combate/seleccionArena.ts del servidor, adaptado a un número en vez de un string). */
function hashDia(dia: number): number {
  let h = dia | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Un estado de clima por día, elegido por peso según la estación (docs/GDD_Clima.md) — determinista, nunca cambia a mitad de día. */
export function climaDelDia(dia: number, estacion: Estacion): string {
  const pesos = (climaJson.pesosPorEstacion as Record<Estacion, Record<string, number>>)[estacion];
  const total = Object.values(pesos).reduce((suma, p) => suma + p, 0);
  if (total <= 0) return climaJson.estados[0];
  const r = (hashDia(dia) % 100000) / 100000 * total;
  let acumulado = 0;
  for (const tipo of climaJson.estados) {
    acumulado += pesos[tipo] ?? 0;
    if (r < acumulado) return tipo;
  }
  return climaJson.estados[climaJson.estados.length - 1];
}

/** Temperatura del mundo (grados aproximados) — curva simple: mínimo de madrugada (~03:00), máximo a media tarde (~15:00), sobre la base de la estación. */
export function temperaturaMundo(estacion: Estacion, hora: number): number {
  const base = (climaJson.temperaturaBasePorEstacion as Record<Estacion, number>)[estacion];
  const fase = ((hora - 15 + 24) % 24) / 24 * Math.PI * 2;
  return base + (climaJson.amplitudTermicaDiaria / 2) * Math.cos(fase);
}

/** Conveniencia: clima + temperatura de un momento, a partir de día/estación/hora ya resueltos por tiempoMundo(). */
export function estadoClima(dia: number, estacion: Estacion, hora: number): EstadoClima {
  return { tipo: climaDelDia(dia, estacion), temperaturaC: temperaturaMundo(estacion, hora) };
}
