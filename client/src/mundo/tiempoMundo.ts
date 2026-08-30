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
// Calendario (docs/GDD_Clima.md, pedido 2026-08-30): 12 meses de
// `diasPorMes` días = 1 estación son 3 meses — derivado aquí, nunca
// duplicado como número suelto en tiempo.json.
const DIAS_POR_ESTACION = tiempoJson.diasPorMes * 3;
const DIAS_POR_ANIO = DIAS_POR_ESTACION * tiempoJson.estaciones.length;

export interface TiempoMundo {
  dia: number; // días completos desde la época
  hora: number; // 0..24 (fraccional: 13.5 = 13:30)
  esDeDia: boolean;
  estacion: string;
  /** mes del año, 1..12 (docs/GDD_Clima.md) — 3 meses por estación. */
  mes: number;
  anio: number;
}

/** Forzado de hora por URL (`?hora=19.5`) — solo para depurar/capturas; no afecta al servidor. */
const horaForzada = (() => {
  const v = new URLSearchParams(location.search).get("hora");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null;
})();

/** Forzado de día por URL (`?dia=95`, docs/GDD_Clima.md) — salta a una estación/clima concretos sin esperar el reloj real; mismo criterio que `?hora=`, solo depuración/capturas. */
const diaForzado = (() => {
  const v = new URLSearchParams(location.search).get("dia");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
})();

export function tiempoMundo(ahoraMs = Date.now()): TiempoMundo {
  const diasFloat = Math.max(0, ahoraMs - tiempoJson.epocaUnixMs) / MS_POR_DIA;
  const dia = diaForzado ?? Math.floor(diasFloat);
  const hora = horaForzada ?? (diasFloat - Math.floor(diasFloat)) * 24;
  const estaciones = tiempoJson.estaciones;
  const diaDelAnio = dia % DIAS_POR_ANIO;
  return {
    dia,
    hora,
    esDeDia: hora >= tiempoJson.horaAmanecer && hora < tiempoJson.horaAnochecer,
    estacion: estaciones[Math.floor(diaDelAnio / DIAS_POR_ESTACION) % estaciones.length],
    mes: Math.floor(diaDelAnio / tiempoJson.diasPorMes) + 1,
    anio: Math.floor(dia / DIAS_POR_ANIO),
  };
}

export const HORA_AMANECER = tiempoJson.horaAmanecer;
export const HORA_ANOCHECER = tiempoJson.horaAnochecer;
