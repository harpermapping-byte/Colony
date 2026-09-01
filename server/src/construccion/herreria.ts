/**
 * Minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería, pedido
 * 2026-09-01) — PURA (sin Colyseus/BD/fs), mismo patrón que arenaCombate.ts:
 * el jugador manda intenciones (avivar/golpear/templar) y el SERVIDOR decide
 * el resultado — nunca se confía en un `timing` que mande el cliente, la
 * aguja de ritmo la simula el servidor (`avanzar`) y se evalúa en el
 * instante exacto en que llega cada mensaje.
 *
 * Solo las recetas de herrero de armas/armaduras pasan por aquí
 * (`RecetaCrafteo.minijuego === "herreria"`) — el resto de crafteo del
 * herrero (herramientas, instrumentos...) sigue el camino normal de
 * crafteo.ts (temporizador `terminaEn`, sin interacción). Un resultado
 * PERFECTO (5★) entrega `receta.resultadoPerfecto` en vez de
 * `receta.resultado` — MISMO itemId base pero una variante "bonificada" ya
 * catalogada aparte con más ataqueFisico/defensaFisica fijo (nunca un bonus
 * calculado en caliente: inventario.ts::calcularStatsEquipo lee el stat
 * directo del catálogo por itemId).
 *
 * Resuelto por timestamp cada vez que llega una acción (mismo `dt` perezoso
 * que crafteo.ts/curtido.ts) — NUNCA un tick de servidor.
 */

export type FaseForja = "CALENTAR" | "FORJAR" | "TEMPLAR" | "TERMINADO";

export interface SesionForja {
  recetaId: string;
  fase: FaseForja;
  temperatura: number;
  combustible: number;
  golpes: number;
  golpesPerfectos: number;
  golpesBuenos: number;
  golpesMalos: number;
  segundosSobrecalentado: number;
  segundosFrio: number;
  /** acumulador 0..1 — de aquí sale `resultadoForja` al final. */
  calidad: number;
  /** posición 0..1 de la aguja de ritmo, la simula el servidor (avanzar). */
  cursor: number;
  direccion: 1 | -1;
  /** velocidad de la aguja — se re-sortea en cada golpe (dificultad #1, ver golpearYunque). */
  velocidadCursor: number;
  /** epoch ms de la última vez que se procesó una acción — dt perezoso, nunca tick. */
  ultimaAccionEn: number;
  iniciadaEn: number;
}

export interface ConfigForja {
  golpesObjetivo: number;
  temperaturaInicial: number;
  /** umbral CALENTAR -> FORJAR. */
  temperaturaObjetivoForja: number;
  temperaturaMinimaForja: number;
  temperaturaOptimaMin: number;
  temperaturaOptimaMax: number;
  temperaturaSobrecalentado: number;
  gananciaCalorCalentar: number;
  gananciaCalorForjar: number;
  enfriamientoCalentarPorSeg: number;
  enfriamientoForjarPorSeg: number;
  enfriamientoTemplarPorSeg: number;
  combustibleMax: number;
  temperaturaTemplarMin: number;
  temperaturaTemplarSobrecalentada: number;
}

export const CONFIG_FORJA_DEFECTO: ConfigForja = {
  golpesObjetivo: 12,
  temperaturaInicial: 12,
  temperaturaObjetivoForja: 68,
  temperaturaMinimaForja: 48,
  temperaturaOptimaMin: 62,
  temperaturaOptimaMax: 88,
  temperaturaSobrecalentado: 90,
  gananciaCalorCalentar: 22,
  gananciaCalorForjar: 17,
  enfriamientoCalentarPorSeg: 2.5,
  enfriamientoForjarPorSeg: 7.2,
  enfriamientoTemplarPorSeg: 1.8,
  combustibleMax: 5,
  temperaturaTemplarMin: 55,
  temperaturaTemplarSobrecalentada: 92,
};

export function iniciarSesionForja(recetaId: string, ahoraMs: number = Date.now(), cfg: ConfigForja = CONFIG_FORJA_DEFECTO): SesionForja {
  return {
    recetaId,
    fase: "CALENTAR",
    temperatura: cfg.temperaturaInicial,
    combustible: cfg.combustibleMax,
    golpes: 0,
    golpesPerfectos: 0,
    golpesBuenos: 0,
    golpesMalos: 0,
    segundosSobrecalentado: 0,
    segundosFrio: 0,
    calidad: 0.35,
    cursor: 0.5,
    direccion: 1,
    velocidadCursor: 0.9,
    ultimaAccionEn: ahoraMs,
    iniciadaEn: ahoraMs,
  };
}

/**
 * Avanza `sesion` hasta `ahoraMs` (temperatura + aguja de ritmo) — se llama
 * al PRINCIPIO de cada acción, nunca por su cuenta. Sin tope de dt: a
 * diferencia de un bucle de render (donde un dt grande por un frame
 * atascado desestabilizaría la física), aquí un hueco real de varios
 * segundos entre acciones SÍ debe enfriar la fragua lo que corresponda de
 * verdad — mismo criterio perezoso que crafteo.ts/desgaste.ts, nunca un
 * tick de servidor. `Math.max(0, ...)` solo protege de un dt negativo
 * (mensajes desordenados/reloj).
 */
function avanzar(sesion: SesionForja, ahoraMs: number, cfg: ConfigForja): void {
  const dt = Math.max(0, (ahoraMs - sesion.ultimaAccionEn) / 1000);
  sesion.ultimaAccionEn = ahoraMs;

  if (sesion.fase === "CALENTAR") {
    sesion.temperatura = Math.max(0, sesion.temperatura - cfg.enfriamientoCalentarPorSeg * dt);
  } else if (sesion.fase === "FORJAR") {
    sesion.temperatura = Math.max(0, sesion.temperatura - cfg.enfriamientoForjarPorSeg * dt);
    if (sesion.temperatura > cfg.temperaturaSobrecalentado) sesion.segundosSobrecalentado += dt;
    if (sesion.temperatura < cfg.temperaturaMinimaForja) sesion.segundosFrio += dt;

    sesion.cursor += sesion.direccion * dt * sesion.velocidadCursor;
    if (sesion.cursor >= 1) { sesion.cursor = 1; sesion.direccion = -1; }
    if (sesion.cursor <= 0) { sesion.cursor = 0; sesion.direccion = 1; }
  } else if (sesion.fase === "TEMPLAR") {
    sesion.temperatura = Math.max(0, sesion.temperatura - cfg.enfriamientoTemplarPorSeg * dt);
  }
}

export interface ResultadoAvivar {
  ok: boolean;
  motivo?: "fase_incorrecta" | "sin_combustible";
}

/** Añade calor y consume 1 combustible — transiciona CALENTAR -> FORJAR al alcanzar `temperaturaObjetivoForja`. */
export function avivarFuego(sesion: SesionForja, ahoraMs: number, cfg: ConfigForja = CONFIG_FORJA_DEFECTO): ResultadoAvivar {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "CALENTAR" && sesion.fase !== "FORJAR") return { ok: false, motivo: "fase_incorrecta" };
  if (sesion.combustible <= 0) return { ok: false, motivo: "sin_combustible" };

  sesion.combustible--;
  const ganancia = sesion.fase === "CALENTAR" ? cfg.gananciaCalorCalentar : cfg.gananciaCalorForjar;
  sesion.temperatura = Math.min(100, sesion.temperatura + ganancia);
  if (sesion.fase === "CALENTAR" && sesion.temperatura >= cfg.temperaturaObjetivoForja) sesion.fase = "FORJAR";
  return { ok: true };
}

export interface ResultadoGolpe {
  ok: boolean;
  motivo?: "fase_incorrecta" | "sesion_completa";
  calidad?: "perfecto" | "bueno" | "malo";
}

/**
 * Golpea en el instante `ahoraMs` — la calidad del golpe sale de la posición
 * de `sesion.cursor` EN ESE MOMENTO (el servidor lo simula en `avanzar`,
 * nunca se confía en un timing que mande el cliente) y de si la temperatura
 * está en la ventana óptima.
 *
 * Dos ejes de dificultad para que no salga "perfecto" solo por machacar
 * space a ritmo constante (pedido 2026-09-01: "que fuera algo mas
 * complicado para no salga siempre perfecta"):
 *   1. `velocidadCursor` se re-sortea tras CADA golpe (con `rnd`) y crece
 *      ligeramente con el progreso — no hay un tempo fijo que memorizar.
 *   2. La ventana de "perfecto" se estrecha según avanza la forja (±0.13 en
 *      el primer golpe -> ±0.08 en el último).
 */
export function golpearYunque(
  sesion: SesionForja,
  ahoraMs: number,
  rnd: () => number = Math.random,
  cfg: ConfigForja = CONFIG_FORJA_DEFECTO,
): ResultadoGolpe {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "FORJAR") return { ok: false, motivo: "fase_incorrecta" };
  if (sesion.golpes >= cfg.golpesObjetivo) return { ok: false, motivo: "sesion_completa" };

  sesion.golpes++;
  const distancia = Math.abs(sesion.cursor - 0.5) * 2;
  const progreso = sesion.golpes / cfg.golpesObjetivo;
  const ventanaPerfecta = 0.13 - progreso * 0.05;
  const enTemperaturaOptima = sesion.temperatura >= cfg.temperaturaOptimaMin && sesion.temperatura <= cfg.temperaturaOptimaMax;

  let calidad: "perfecto" | "bueno" | "malo";
  if (enTemperaturaOptima && distancia < ventanaPerfecta) {
    calidad = "perfecto";
    sesion.golpesPerfectos++;
    sesion.calidad += 0.075;
  } else if (sesion.temperatura >= cfg.temperaturaMinimaForja && distancia < 0.34) {
    calidad = "bueno";
    sesion.golpesBuenos++;
    sesion.calidad += 0.035;
  } else {
    calidad = "malo";
    sesion.golpesMalos++;
    sesion.calidad -= 0.07;
  }
  sesion.calidad -= Math.min(0.2, sesion.segundosSobrecalentado * 0.01);
  sesion.calidad -= Math.min(0.2, sesion.segundosFrio * 0.008);
  sesion.calidad = Math.max(0, Math.min(1, sesion.calidad));

  sesion.velocidadCursor = 0.7 + rnd() * 0.5 + progreso * 0.3;

  if (sesion.golpes >= cfg.golpesObjetivo) sesion.fase = "TEMPLAR";
  return { ok: true, calidad };
}

export interface ResultadoTemplar {
  ok: boolean;
  motivo?: "fase_incorrecta";
}

/** Templa en el instante `ahoraMs` — ventana de temperatura, no de timing (la temperatura ya baja sola en TEMPLAR: llegar tarde también penaliza). */
export function templar(sesion: SesionForja, ahoraMs: number, cfg: ConfigForja = CONFIG_FORJA_DEFECTO): ResultadoTemplar {
  avanzar(sesion, ahoraMs, cfg);
  if (sesion.fase !== "TEMPLAR") return { ok: false, motivo: "fase_incorrecta" };

  if (sesion.temperatura >= cfg.temperaturaTemplarMin && sesion.temperatura <= cfg.temperaturaTemplarSobrecalentada) {
    sesion.calidad += 0.08;
  } else if (sesion.temperatura > cfg.temperaturaTemplarSobrecalentada) {
    sesion.calidad -= 0.1;
  } else {
    sesion.calidad -= 0.04;
  }
  sesion.calidad = Math.max(0, Math.min(1, sesion.calidad));
  sesion.fase = "TERMINADO";
  return { ok: true };
}

export interface ResultadoFinalForja {
  estrellas: number;
  perfecta: boolean;
}

/** Solo tiene sentido con `sesion.fase === "TERMINADO"`. Perfecta = 5 estrellas -> desbloquea `receta.resultadoPerfecto`. */
export function resultadoForja(sesion: SesionForja): ResultadoFinalForja {
  const estrellas = Math.max(1, Math.min(5, Math.round(sesion.calidad * 5)));
  return { estrellas, perfecta: estrellas === 5 };
}
