/**
 * Persistencia de volumen/calidad gráfica (docs/GDD_Ajustes.md, pedido
 * streamer 2026-09-09) — `localStorage` plano, mismo criterio que
 * `configTeclas.ts`. game.ts aplica estos valores UNA vez al arrancar
 * (antes de que el jugador toque el panel de Ajustes); el panel los
 * reaplica en caliente y los reguarda cuando el jugador los cambia.
 */

const CLAVE_VOLUMEN = "ajustesVolumen";
const CLAVE_VOLUMEN_MUSICA = "ajustesVolumenMusica";
const CLAVE_CALIDAD = "ajustesCalidadGrafica";

export type CalidadGrafica = "baja" | "media" | "alta";

/**
 * Lee una clave numérica 0-100 con `porDefecto` si nunca se guardó nada.
 * Bug real encontrado verificando el hilo musical de fondo (2026-09-09):
 * `Number(localStorage.getItem(clave))` con la clave AUSENTE da
 * `Number(null) === 0` (no `NaN`) — la validación `crudo>=0 && crudo<=100`
 * lo aceptaba como si fuera un 0 guardado a propósito, así que CUALQUIER
 * volumen de esta pantalla arrancaba muteado en un navegador nuevo en vez
 * de con su valor por defecto real. Afectaba también a
 * `obtenerVolumenGuardado` (instrumentos) desde que existe, sin repro
 * visible antes de tener un segundo bus de audio con autoreproducción que
 * lo hiciera evidente. Distinguir "clave ausente" de "guardado como 0" con
 * `=== null` antes de convertir a número es lo que lo cierra de raíz.
 */
function leerVolumenGuardado(clave: string, porDefecto: number): number {
  const guardado = localStorage.getItem(clave);
  if (guardado === null) return porDefecto;
  const crudo = Number(guardado);
  return Number.isFinite(crudo) && crudo >= 0 && crudo <= 100 ? crudo : porDefecto;
}

export function obtenerVolumenGuardado(): number {
  return leerVolumenGuardado(CLAVE_VOLUMEN, 100);
}

export function guardarVolumen(v: number): void {
  try {
    localStorage.setItem(CLAVE_VOLUMEN, String(v));
  } catch {
    // localStorage puede fallar (modo privado, cuota) — el ajuste sigue aplicándose esta sesión, solo no persiste.
  }
}

/**
 * Volumen del hilo musical de fondo (docs/GDD_Ajustes.md, pedido streamer
 * 2026-09-09) — clave separada de CLAVE_VOLUMEN a propósito: ese es el bus
 * de los instrumentos MIDI que tocan los jugadores, este es la música
 * ambiental del propio juego, cada uno se sube/baja/apaga por separado.
 * Default 40 (no 100): audible de fondo sin tapar el resto del audio, y
 * distinto de cero para que la autoreproducción al entrar tenga efecto la
 * primera vez sin que el jugador tenga que ir a Ajustes a subirlo.
 */
export function obtenerVolumenMusicaGuardado(): number {
  return leerVolumenGuardado(CLAVE_VOLUMEN_MUSICA, 40);
}

export function guardarVolumenMusica(v: number): void {
  try {
    localStorage.setItem(CLAVE_VOLUMEN_MUSICA, String(v));
  } catch {
    // ver comentario de guardarVolumen
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
