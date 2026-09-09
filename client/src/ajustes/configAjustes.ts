/**
 * Persistencia de volumen/calidad gráfica (docs/GDD_Ajustes.md, pedido
 * streamer 2026-09-09) — `localStorage` plano, mismo criterio que
 * `configTeclas.ts`. game.ts aplica estos valores UNA vez al arrancar
 * (antes de que el jugador toque el panel de Ajustes); el panel los
 * reaplica en caliente y los reguarda cuando el jugador los cambia.
 */

const CLAVE_VOLUMEN = "ajustesVolumen";
const CLAVE_CALIDAD = "ajustesCalidadGrafica";

export type CalidadGrafica = "baja" | "media" | "alta";

export function obtenerVolumenGuardado(): number {
  const crudo = Number(localStorage.getItem(CLAVE_VOLUMEN));
  return Number.isFinite(crudo) && crudo >= 0 && crudo <= 100 ? crudo : 100;
}

export function guardarVolumen(v: number): void {
  try {
    localStorage.setItem(CLAVE_VOLUMEN, String(v));
  } catch {
    // localStorage puede fallar (modo privado, cuota) — el ajuste sigue aplicándose esta sesión, solo no persiste.
  }
}

export function obtenerCalidadGuardada(): CalidadGrafica {
  const crudo = localStorage.getItem(CLAVE_CALIDAD);
  return crudo === "baja" || crudo === "media" || crudo === "alta" ? crudo : "alta";
}

export function guardarCalidad(nivel: CalidadGrafica): void {
  try {
    localStorage.setItem(CLAVE_CALIDAD, nivel);
  } catch {
    // ver comentario de guardarVolumen
  }
}
