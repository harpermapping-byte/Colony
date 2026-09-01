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
// Calendario (docs/GDD_Clima.md, pedido 2026-08-30): 12 meses de
// `diasPorMes` días = 1 estación son 3 meses — derivado aquí, nunca
// duplicado como número suelto en tiempo.json.
const DIAS_POR_ESTACION = tiempoJson.diasPorMes * 3;
const DIAS_POR_ANIO = DIAS_POR_ESTACION * tiempoJson.estaciones.length;

export interface TiempoMundo {
  dia: number;
  hora: number; // 0..24 fraccional
  esDeDia: boolean;
  estacion: string;
  /** mes del año, 1..12 (docs/GDD_Clima.md) — 3 meses por estación. */
  mes: number;
  anio: number;
}

// Forzado de hora para tests/depuración (espejo del ?hora= del cliente):
// HORA_FORZADA=13.5 congela la hora de juego del proceso entero. Nunca en
// producción — es la palanca para probar rutinas sin esperar al reloj.
const horaForzada = (() => {
  const n = Number(process.env.HORA_FORZADA);
  return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null;
})();

// Forzado de día para tests/depuración (espejo del ?dia= del cliente,
// docs/GDD_Clima.md): DIA_FORZADO=95 congela estación/mes/clima del
// proceso entero. Nunca en producción.
const diaForzado = (() => {
  const n = Number(process.env.DIA_FORZADO);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
})();

/** Estación + día-dentro-del-año de un día de mundo cualquiera — extraído para que `clima.ts`/`nieve.ts` puedan recorrer días PASADOS (acumulador de nieve) sin duplicar esta cuenta. */
export function estacionYDiaDelAnio(dia: number): { estacion: string; diaDelAnio: number } {
  const diaDelAnio = ((dia % DIAS_POR_ANIO) + DIAS_POR_ANIO) % DIAS_POR_ANIO;
  return {
    estacion: tiempoJson.estaciones[Math.floor(diaDelAnio / DIAS_POR_ESTACION) % tiempoJson.estaciones.length],
    diaDelAnio,
  };
}

export { DIAS_POR_ANIO };

export function tiempoMundo(ahoraMs = Date.now()): TiempoMundo {
  const diasFloat = Math.max(0, ahoraMs - tiempoJson.epocaUnixMs) / MS_POR_DIA;
  const dia = diaForzado ?? Math.floor(diasFloat);
  const hora = horaForzada ?? (diasFloat - Math.floor(diasFloat)) * 24;
  const { estacion, diaDelAnio } = estacionYDiaDelAnio(dia);
  return {
    dia,
    hora,
    esDeDia: hora >= tiempoJson.horaAmanecer && hora < tiempoJson.horaAnochecer,
    estacion,
    mes: Math.floor(diaDelAnio / tiempoJson.diasPorMes) + 1,
    anio: Math.floor(dia / DIAS_POR_ANIO),
  };
}
