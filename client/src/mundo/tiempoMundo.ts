/**
 * Reloj de mundo del CLIENTE — la misma fórmula determinista que
 * `server/src/mundo/tiempoMundo.ts`, con las constantes compartidas de
 * `assets/mundo/tiempo.json` como única fuente (GDD_Tiempo_Mundo.md).
 *
 * La hora de juego se DERIVA del reloj real (época fija + escala): cero
 * mensajes de red, cero estado que sincronizar — cualquier cliente y el
 * servidor calculan exactamente la misma hora en el mismo instante. El
 * desfase del reloj local de un jugador solo desplaza la ILUMINACIÓN unos
 * segundos, nunca la simulación (esa la manda el servidor con su propio
 * reloj).
 */
import tiempoJson from "../../../assets/mundo/tiempo.json";

const MS_POR_DIA = tiempoJson.minutosRealesPorDia * 60_000;

export interface TiempoMundo {
  dia: number; // días completos desde la época
  hora: number; // 0..24 (fraccional: 13.5 = 13:30)
  esDeDia: boolean;
  estacion: string;
  anio: number;
}

/** Forzado de hora por URL (`?hora=19.5`) — solo para depurar/capturas; no afecta al servidor. */
const horaForzada = (() => {
  const v = new URLSearchParams(location.search).get("hora");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null;
})();

export function tiempoMundo(ahoraMs = Date.now()): TiempoMundo {
  const diasFloat = Math.max(0, ahoraMs - tiempoJson.epocaUnixMs) / MS_POR_DIA;
  const dia = Math.floor(diasFloat);
  const hora = horaForzada ?? (diasFloat - dia) * 24;
  const estaciones = tiempoJson.estaciones;
  return {
    dia,
    hora,
    esDeDia: hora >= tiempoJson.horaAmanecer && hora < tiempoJson.horaAnochecer,
    estacion: estaciones[Math.floor(dia / tiempoJson.diasPorEstacion) % estaciones.length],
    anio: Math.floor(dia / (tiempoJson.diasPorEstacion * estaciones.length)),
  };
}

export const HORA_AMANECER = tiempoJson.horaAmanecer;
export const HORA_ANOCHECER = tiempoJson.horaAnochecer;
