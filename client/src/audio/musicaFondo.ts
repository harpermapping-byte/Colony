/**
 * Hilo musical de fondo (docs/GDD_Ajustes.md, pedido streamer 2026-09-09:
 * "añadir de momento un hilo musical de fondo... que yo cambie y añada el
 * audio que quiero reproducir... que se autoreproduzca nada más entrar
 * (siempre y cuando no tenga en ajustes quitado volumen)").
 *
 * Bus de audio INDEPENDIENTE del de `instrumentos.ts` (ese es el volumen de
 * los instrumentos MIDI que tocan los jugadores; este es la música
 * ambiental del propio juego) — un `<audio>` normal en bucle, no Tone.js
 * (no hay ninguna razón para pasar por Web Audio/síntesis aquí, es
 * reproducción directa de un archivo). Mismo criterio que `instrumentos.ts`
 * para el volumen: este módulo no lee `localStorage` por su cuenta, el
 * valor guardado (`configAjustes.ts`) se lo pasa quien lo llama.
 *
 * RUTA_MUSICA apunta a un PLACEHOLDER generado por código (ver
 * `client/public/audio/LEEME_MUSICA.md`) — para poner la música real,
 * sustituye ese archivo y, si hace falta, esta constante.
 */
const RUTA_MUSICA = "/audio/musica_fondo.wav";

let audio: HTMLAudioElement | null = null;

function obtenerAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(RUTA_MUSICA);
    audio.loop = true;
  }
  return audio;
}

/**
 * Intenta arrancar la música al entrar al juego, con el volumen 0-100 ya
 * guardado en Ajustes. Si el navegador bloquea el autoplay por su política
 * de gesto de usuario (frecuente si esta llamada no cae dentro de la misma
 * tanda de eventos que un clic reciente), se reintenta UNA vez en la
 * primera interacción real (clic o tecla) en cualquier parte de la página —
 * nunca se insiste más allá de eso ni se muestra ningún aviso, es un
 * fallback silencioso.
 */
export function intentarAutoreproducir(volumen0a100: number): void {
  if (volumen0a100 <= 0) return; // apagada en Ajustes: ni se crea el <audio>
  const el = obtenerAudio();
  el.volume = Math.min(100, volumen0a100) / 100;
  el.play().catch(() => {
    const reintentar = () => { el.play().catch(() => {}); };
    window.addEventListener("pointerdown", reintentar, { once: true });
    window.addEventListener("keydown", reintentar, { once: true });
  });
}

/**
 * Aplica un volumen 0-100 ya en marcha (llamado desde el slider de
 * Ajustes). 0 = pausa de verdad (no solo silencio — "quitarlo" de la
 * petición original, ahorra CPU de un archivo en bucle muteado sin
 * sentido); >0 = vuelve a reproducir si estaba pausada — mover el slider ES
 * un gesto de usuario real, así que esto también sirve de segunda
 * oportunidad si el autoplay inicial se bloqueó.
 */
export function fijarVolumenMusica(volumen0a100: number): void {
  const v = Math.max(0, Math.min(100, volumen0a100));
  const el = obtenerAudio();
  el.volume = v / 100;
  if (v === 0) el.pause();
  else if (el.paused) el.play().catch(() => {});
}

/**
 * Referencia al `<audio>` interno, SOLO para depuración/verificación (no se
 * inserta en el DOM — `new Audio()` no lo necesita para sonar — así que no
 * es localizable con un `document.querySelector` normal). `null` si todavía
 * no se ha llamado a `intentarAutoreproducir`/`fijarVolumenMusica`.
 */
export function elementoAudioParaDebug(): HTMLAudioElement | null {
  return audio;
}
