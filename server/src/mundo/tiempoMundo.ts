/**
 * Reloj de mundo del SERVIDOR — la misma fórmula determinista que
 * `client/src/mundo/tiempoMundo.ts`, con las constantes compartidas de
 * `assets/mundo/tiempo.json` como única fuente (GDD_Tiempo_Mundo.md).
 *
 * La hora se DERIVA del reloj real: no hay estado, no hay tick propio, no
 * se manda nada por red. El servidor la consulta cuando la necesita
 * (rutinas de NPC, respawn perezoso...) y cada cliente calcula la suya
 * idéntica para la iluminación. La AUTORIDAD de cualquier efecto de juego
 * es siempre esta copia del servidor.
 */
import * as tiempoJson from "../../../assets/mundo/tiempo.json";

const MS_POR_DIA = tiempoJson.minutosRealesPorDia * 60_000;

export interface TiempoMundo {
  dia: number;
  hora: number; // 0..24 fraccional
  esDeDia: boolean;
  estacion: string;
  anio: number;
}

// Forzado de hora para tests/depuración (espejo del ?hora= del cliente):
// HORA_FORZADA=13.5 congela la hora de juego del proceso entero. Nunca en
// producción — es la palanca para probar rutinas sin esperar al reloj.
const horaForzada = (() => {
  const n = Number(process.env.HORA_FORZADA);
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
