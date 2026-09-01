/**
 * Sesión genérica de "gestionar el fuego/calor un rato y luego terminar" —
 * PURA (sin Colyseus/BD/fs), extraída de herreria.ts para REUTILIZARSE tal
 * cual en cualquier estación que necesite el mismo "mismo sistema de
 * activarse" (pedido 2026-09-01: pociones en el caldero, cocina en la
 * vasija al fuego) sin duplicar el motor de temperatura/dt perezoso.
 *
 * A diferencia de herreria.ts (fases con golpes discretos y ventana de
 * timing), esto es más simple: el jugador mantiene la temperatura dentro de
 * una ventana objetivo con avivar/enfriar durante un rato, y al terminar
 * (`finalizarEstacion`) la CALIDAD sale de qué fracción de ese tiempo
 * estuvo de verdad dentro de la ventana — "pureza" 0..1, que quien llame
 * usa para escalar SU PROPIO resultado (alquimia.ts multiplica magnitudes,
 * cocina.ts multiplicaría aportes) — este módulo no sabe nada de pociones
 * ni de comida, solo de temperatura y tiempo.
 */

export type FaseEstacion = "TRABAJANDO" | "TERMINADO";

export interface SesionEstacion {
  fase: FaseEstacion;
  temperatura: number;
  /** segundos acumulados con la temperatura DENTRO de la ventana objetivo. */
  segundosEnVentana: number;
  /** segundos acumulados totales desde que empezó — perezoso, no un tick. */
  segundosTotales: number;
  ultimaAccionEn: number;
  iniciadaEn: number;
}

export interface ConfigEstacion {
  temperaturaInicial: number;
  temperaturaObjetivoMin: number;
  temperaturaObjetivoMax: number;
  gananciaCalor: number;
  perdidaCalor: number;
  enfriamientoAmbientePorSeg: number;
  /** no se puede llamar `finalizarEstacion` con éxito antes de esto — evita "colar" al primer segundo con pureza artificialmente alta por poca muestra. */
  duracionMinimaSeg: number;
}

export function iniciarSesionEstacion(cfg: ConfigEstacion, ahoraMs: number = Date.now()): SesionEstacion {
  return {
    fase: "TRABAJANDO",
    temperatura: cfg.temperaturaInicial,
    segundosEnVentana: 0,
    segundosTotales: 0,
    ultimaAccionEn: ahoraMs,
    iniciadaEn: ahoraMs,
  };
}

/** Grano del muestreo de "¿está en ventana ahora mismo?" dentro de avanzar() — no es un tick de servidor (todo se calcula de una vez, síncrono, dentro de esta única llamada), solo evita que un hueco largo entre acciones (varios segundos) se compute como "todo dentro" o "todo fuera" en bloque cuando la temperatura cruzó la ventana a media que enfriaba. */
const PASO_MUESTREO_SEG = 0.25;

/** Avanza tiempo/temperatura hasta `ahoraMs` — se llama al PRINCIPIO de cada acción, nunca por su cuenta (mismo criterio que herreria.ts: sin tope de dt, un hueco real SÍ enfría lo que corresponda de verdad). */
function avanzar(sesion: SesionEstacion, ahoraMs: number, cfg: ConfigEstacion): void {
  const dtTotal = Math.max(0, (ahoraMs - sesion.ultimaAccionEn) / 1000);
  sesion.ultimaAccionEn = ahoraMs;
  if (sesion.fase !== "TRABAJANDO" || dtTotal <= 0) return;

  let restante = dtTotal;
  while (restante > 0) {
    const paso = Math.min(PASO_MUESTREO_SEG, restante);
    sesion.temperatura = Math.max(0, sesion.temperatura - cfg.enfriamientoAmbientePorSeg * paso);
    sesion.segundosTotales += paso;
    if (sesion.temperatura >= cfg.temperaturaObjetivoMin && sesion.temperatura <= cfg.temperaturaObjetivoMax) {
      sesion.segundosEnVentana += paso;
    }
    restante -= paso;
  }
}

export interface ResultadoAccionEstacion {
  ok: boolean;
  motivo?: "fase_incorrecta";
}

export function avivarEstacion(sesion: SesionEstacion, ahoraMs: number, cfg: ConfigEstacion): ResultadoAccionEstacion {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "TRABAJANDO") return { ok: false, motivo: "fase_incorrecta" };
  sesion.temperatura = Math.min(100, sesion.temperatura + cfg.gananciaCalor);
  return { ok: true };
}

export function enfriarEstacion(sesion: SesionEstacion, ahoraMs: number, cfg: ConfigEstacion): ResultadoAccionEstacion {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "TRABAJANDO") return { ok: false, motivo: "fase_incorrecta" };
  sesion.temperatura = Math.max(0, sesion.temperatura - cfg.perdidaCalor);
  return { ok: true };
}

export interface ResultadoFinalizarEstacion {
  ok: boolean;
  motivo?: "fase_incorrecta" | "demasiado_pronto";
  /** 0..1 — fracción del tiempo total que la temperatura estuvo en la ventana objetivo. */
  pureza?: number;
}

/** Termina la sesión (colar/servir/destilar) y calcula la pureza — a partir de aquí la sesión ya no acepta más acciones de temperatura. */
export function finalizarEstacion(sesion: SesionEstacion, ahoraMs: number, cfg: ConfigEstacion): ResultadoFinalizarEstacion {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "TRABAJANDO") return { ok: false, motivo: "fase_incorrecta" };
  if (sesion.segundosTotales < cfg.duracionMinimaSeg) return { ok: false, motivo: "demasiado_pronto" };
  sesion.fase = "TERMINADO";
  const pureza = sesion.segundosTotales > 0 ? Math.max(0, Math.min(1, sesion.segundosEnVentana / sesion.segundosTotales)) : 0;
  return { ok: true, pureza };
}
