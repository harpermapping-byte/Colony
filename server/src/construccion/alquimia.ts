/**
 * Preparación de pociones — PURA (sin Colyseus/BD/fs), mismo patrón que
 * herreria.ts (docs/GDD_Pociones.md, pedido 2026-09-01): el jugador
 * selecciona ingredientes LIBREMENTE de su inventario (a diferencia de
 * crafteo.ts, aquí NO hay una lista fija de insumos por receta — el
 * resultado sale de qué combinación de ingredientes se metió en el
 * caldero), el servidor tira los dados con matemáticas estrictas.
 *
 * Reglas de negocio pedidas por el streamer (2026-09-01), formalizadas en
 * `CONFIG_ALQUIMIA_DEFECTO` — cada número ahí es una decisión de diseño
 * documentada en docs/GDD_Pociones.md, no magia inventada aquí:
 *   1. Negativo: 10% base + 25% acumulativo por cada ingrediente
 *      `alquimiaCorruptivo` ÚNICO distinto — magnitud 1-5%.
 *   2. Positivo: sin catalizador, "intentos" = nº de ingredientes
 *      `alquimiaCatalizador` distintos usados, cada intento más difícil que
 *      el anterior (probabilidad armónica decreciente) — magnitud 1-3%. Con
 *      catalizador, 25% acumulativo de FORZAR 2 o 3 bonos de golpe. Con 3+
 *      catalizadores distintos, "mezcla avanzada": SIEMPRE 4 bonos, magnitud
 *      5-15%.
 *
 * Los 4 posibles efectos son los 4 campos de StatsEquipo (ataqueFisico/
 * defensaFisica/ataqueMagico/defensaMagica) — encaja con el "hasta 4 bonus
 * simultáneos" de la mezcla avanzada sin inventar un catálogo de efectos
 * nuevo. Cada poción PREPARADA guarda su tirada en la propia instancia
 * (`ItemInstancia.efectoPocion`, inventario.ts) — se consume vía
 * `pocion:beber`, que convierte los efectos en `BuffPocion` con caducidad
 * real (epoch ms), aplicados de forma perezosa (nunca un tick) en
 * `aplicarBuffsPocion`.
 */

import {
  ConfigEstacion,
  SesionEstacion,
  iniciarSesionEstacion,
  avivarEstacion,
  enfriarEstacion,
  finalizarEstacion,
  ResultadoAccionEstacion,
} from "./estacionFuego";

export type StatAlquimia = "ataqueFisico" | "defensaFisica" | "ataqueMagico" | "defensaMagica";

export const POOL_STATS_ALQUIMIA: readonly StatAlquimia[] = ["ataqueFisico", "defensaFisica", "ataqueMagico", "defensaMagica"];

export interface IngredienteAlquimia {
  itemId: string;
  /** copiado de EntradaCatalogoItem.alquimiaCorruptivo por quien llame (Room) — este módulo no toca el catálogo, para poder testear con datos a mano. */
  corruptivo?: boolean;
  catalizador?: boolean;
}

export interface EfectoPocion {
  stat: StatAlquimia;
  /** % con signo — negativo en el efecto de riesgo, positivo en los bonos. */
  magnitudPct: number;
}

export interface ResultadoPocion {
  efectos: EfectoPocion[];
  /** informativo, para UI/logs — no afecta la tirada de nadie más. */
  corruptivosUnicos: number;
  catalizadoresUnicos: number;
  mezclaAvanzada: boolean;
}

export interface ConfigAlquimia {
  probNegativoBase: number;
  probNegativoPorCorruptivo: number;
  magnitudNegativoMin: number;
  magnitudNegativoMax: number;
  probForzadoPorCatalizador: number;
  /** nº de catalizadores ÚNICOS distintos para desbloquear la mezcla avanzada (4 bonos, magnitud alta). */
  catalizadoresParaMezclaAvanzada: number;
  magnitudPositivoMin: number;
  magnitudPositivoMax: number;
  magnitudAvanzadaMin: number;
  magnitudAvanzadaMax: number;
  /**
   * Probabilidad de éxito del intento i-ésimo (1-indexado) sin catalizador
   * forzado = `probExitoIntentoBase / i` — decreciente armónica: cuantos más
   * bonos se "intentan" (nº de catalizadores distintos usados que NO
   * dispararon el forzado), más difícil que cada uno salga. No viene
   * especificada por el streamer con una fórmula exacta ("mayor dificultad
   * matemática calcula el servidor") — esta es la interpretación concreta,
   * documentada y con los números aquí para poder retocarla sin tocar lógica.
   */
  probExitoIntentoBase: number;
  /** duración del buff al beber la poción (epoch ms de vida) — no especificada por el streamer, valor por defecto razonable. */
  duracionBuffMs: number;
}

export const CONFIG_ALQUIMIA_DEFECTO: ConfigAlquimia = {
  probNegativoBase: 0.1,
  probNegativoPorCorruptivo: 0.25,
  magnitudNegativoMin: 1,
  magnitudNegativoMax: 5,
  probForzadoPorCatalizador: 0.25,
  catalizadoresParaMezclaAvanzada: 3,
  magnitudPositivoMin: 1,
  magnitudPositivoMax: 3,
  magnitudAvanzadaMin: 5,
  magnitudAvanzadaMax: 15,
  probExitoIntentoBase: 0.7,
  duracionBuffMs: 10 * 60_000,
};

function contarUnicos(ingredientes: IngredienteAlquimia[], flag: "corruptivo" | "catalizador"): number {
  return new Set(ingredientes.filter((i) => i[flag]).map((i) => i.itemId)).size;
}

/** Fisher-Yates con `rnd` inyectable — mismo criterio de testabilidad que el resto del proyecto (tirarHuida, herreria.ts). */
function barajar<T>(arr: readonly T[], rnd: () => number): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Prepara una poción a partir de los ingredientes metidos en el caldero.
 * Determinista dado `rnd` — mismo criterio de testabilidad que
 * `tirarHuida`/`herreria.ts` (`rnd: () => number = Math.random` en producción).
 */
export function prepararPocion(
  ingredientes: IngredienteAlquimia[],
  rnd: () => number = Math.random,
  cfg: ConfigAlquimia = CONFIG_ALQUIMIA_DEFECTO,
): ResultadoPocion {
  const corruptivosUnicos = contarUnicos(ingredientes, "corruptivo");
  const catalizadoresUnicos = contarUnicos(ingredientes, "catalizador");
  const efectos: EfectoPocion[] = [];

  // 1) Negativo — probabilidad acumulativa por corruptivo, magnitud 1-5%.
  const probNegativo = Math.min(1, cfg.probNegativoBase + cfg.probNegativoPorCorruptivo * corruptivosUnicos);
  if (rnd() < probNegativo) {
    const stat = POOL_STATS_ALQUIMIA[Math.floor(rnd() * POOL_STATS_ALQUIMIA.length)];
    const magnitud = cfg.magnitudNegativoMin + rnd() * (cfg.magnitudNegativoMax - cfg.magnitudNegativoMin);
    efectos.push({ stat, magnitudPct: -magnitud });
  }

  // 2) Positivos — cuántos bonos (n) y en qué rango de magnitud.
  const mezclaAvanzada = catalizadoresUnicos >= cfg.catalizadoresParaMezclaAvanzada;
  let n: number;
  let rangoMin: number;
  let rangoMax: number;

  if (mezclaAvanzada) {
    n = 4;
    rangoMin = cfg.magnitudAvanzadaMin;
    rangoMax = cfg.magnitudAvanzadaMax;
  } else {
    rangoMin = cfg.magnitudPositivoMin;
    rangoMax = cfg.magnitudPositivoMax;
    const probForzado = Math.min(1, cfg.probForzadoPorCatalizador * catalizadoresUnicos);
    if (catalizadoresUnicos > 0 && rnd() < probForzado) {
      n = rnd() < 0.5 ? 2 : 3; // "siempre 2 o 3 de golpe"
    } else {
      n = 0;
      for (let intento = 1; intento <= catalizadoresUnicos; intento++) {
        if (rnd() < cfg.probExitoIntentoBase / intento) n++;
      }
    }
  }
  n = Math.min(n, POOL_STATS_ALQUIMIA.length);

  const statsElegidos = barajar(POOL_STATS_ALQUIMIA, rnd).slice(0, n);
  for (const stat of statsElegidos) {
    const magnitud = rangoMin + rnd() * (rangoMax - rangoMin);
    efectos.push({ stat, magnitudPct: magnitud });
  }

  return { efectos, corruptivosUnicos, catalizadoresUnicos, mezclaAvanzada };
}

export interface BuffPocion {
  stat: StatAlquimia;
  magnitudPct: number;
  /** epoch ms — expirado cuando `Date.now() >= expiraEn`, comprobado perezosamente en `aplicarBuffsPocion` (nunca un tick de servidor). */
  expiraEn: number;
}

/** Convierte el resultado de una poción bebida en buffs con caducidad real — llamado UNA VEZ en `pocion:beber`. */
export function crearBuffsPocion(efectos: EfectoPocion[], ahoraMs: number, cfg: ConfigAlquimia = CONFIG_ALQUIMIA_DEFECTO): BuffPocion[] {
  return efectos.map((e) => ({ stat: e.stat, magnitudPct: e.magnitudPct, expiraEn: ahoraMs + cfg.duracionBuffMs }));
}

export interface StatsConBuffs {
  ataqueFisico: number;
  defensaFisica: number;
  ataqueMagico: number;
  defensaMagica: number;
}

/**
 * Valor de referencia sobre el que se calcula el % de un buff de poción —
 * NUNCA el stat propio del bebedor (ver abajo por qué), un tier 1-2 de arma/
 * armadura real del catálogo (espada_corta ataqueFisico:10, hacha_combate:
 * 20 — pechera_cuero defensaFisica:2.5). Fijo, no depende de nivel/equipo.
 */
export const REFERENCIA_STAT_ALQUIMIA = 20;

/**
 * Aplica los buffs de poción TODAVÍA vivos sobre unas stats base — perezoso:
 * los ya caducados se ignoran aquí mismo, sin que nadie tenga que purgar la
 * lista con un tick. Varios buffs sobre el MISMO stat se SUMAN antes de
 * convertir a bonus plano (un +3% y un -2% en ataqueFisico netean a +1%, no
 * se anulan ni se aplican en cascada).
 *
 * El % se calcula sobre `REFERENCIA_STAT_ALQUIMIA`, NUNCA multiplicando el
 * propio stat del jugador: `defensaFisica`/`ataqueMagico` valen 0 en el caso
 * común (sin armadura puesta / sin oficio de magia) — un "+15%" multiplicado
 * por 0 daría SIEMPRE 0, la poción sería inerte justo en el caso más
 * frecuente. Con una referencia fija, el bonus es un número plano real
 * (ej. magnitudPct=15 -> +3 de ataqueFisico) que se SUMA siempre, tenga o
 * no equipo puesto.
 */
export function aplicarBuffsPocion(base: StatsConBuffs, buffs: BuffPocion[], ahoraMs: number): StatsConBuffs {
  const sumaPorStat = new Map<StatAlquimia, number>();
  for (const b of buffs) {
    if (b.expiraEn <= ahoraMs) continue;
    sumaPorStat.set(b.stat, (sumaPorStat.get(b.stat) ?? 0) + b.magnitudPct);
  }
  const resultado = { ...base };
  for (const stat of POOL_STATS_ALQUIMIA) {
    const pct = sumaPorStat.get(stat);
    if (pct) resultado[stat] = Math.max(0, resultado[stat] + (REFERENCIA_STAT_ALQUIMIA * pct) / 100);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Sesión interactiva (docs/GDD_Pociones.md, pedido 2026-09-01: "mismo
// sistema de activarse que la del herrero") — envuelve estacionFuego.ts
// (gestionar la temperatura del caldero un rato) alrededor del resultado YA
// TIRADO por ingredientes (`prepararPocion`, congelado al iniciar, igual
// que el resto de crafteo congela sus números al arrancar): la mezcla de
// ingredientes decide QUÉ efectos son posibles y su magnitud base (la
// mecánica que pidió el streamer con las matemáticas exactas); mantener el
// caldero en su punto (pureza 0..1) escala esa magnitud entre 40% (gestión
// pésima, nunca 0 — los ingredientes siguen siendo la parte fuerte) y 100%
// (gestión perfecta).

export const CONFIG_ESTACION_ALQUIMIA: ConfigEstacion = {
  temperaturaInicial: 15,
  temperaturaObjetivoMin: 55,
  temperaturaObjetivoMax: 80,
  gananciaCalor: 20,
  perdidaCalor: 15,
  enfriamientoAmbientePorSeg: 3,
  duracionMinimaSeg: 8,
};

/** Suelo del factor de escala por pureza — una gestión pésima del fuego sigue dando esto de los efectos ya tirados por ingredientes, nunca 0. */
export const FACTOR_PUREZA_MINIMO = 0.4;

export interface SesionAlquimia {
  estacion: SesionEstacion;
  /** tirada de `prepararPocion` sobre los ingredientes — congelada al iniciar, la pureza del fuego solo ESCALA su magnitud, nunca cambia qué stats salieron. */
  resultadoBase: ResultadoPocion;
}

export function iniciarSesionAlquimia(
  ingredientes: IngredienteAlquimia[],
  rnd: () => number = Math.random,
  ahoraMs: number = Date.now(),
  cfgAlquimia: ConfigAlquimia = CONFIG_ALQUIMIA_DEFECTO,
  cfgEstacion: ConfigEstacion = CONFIG_ESTACION_ALQUIMIA,
): SesionAlquimia {
  return {
    estacion: iniciarSesionEstacion(cfgEstacion, ahoraMs),
    resultadoBase: prepararPocion(ingredientes, rnd, cfgAlquimia),
  };
}

export function avivarAlquimia(sesion: SesionAlquimia, ahoraMs: number, cfg: ConfigEstacion = CONFIG_ESTACION_ALQUIMIA): ResultadoAccionEstacion {
  return avivarEstacion(sesion.estacion, ahoraMs, cfg);
}

export function enfriarAlquimia(sesion: SesionAlquimia, ahoraMs: number, cfg: ConfigEstacion = CONFIG_ESTACION_ALQUIMIA): ResultadoAccionEstacion {
  return enfriarEstacion(sesion.estacion, ahoraMs, cfg);
}

export interface ResultadoColarPocion {
  ok: boolean;
  motivo?: "fase_incorrecta" | "demasiado_pronto";
  efectos?: EfectoPocion[];
  pureza?: number;
}

/** Termina la sesión ("colar" la poción) — escala la magnitud de `resultadoBase.efectos` por la pureza del fuego, nunca cambia qué stats salieron ni si hubo negativo. */
export function colarPocion(sesion: SesionAlquimia, ahoraMs: number, cfg: ConfigEstacion = CONFIG_ESTACION_ALQUIMIA): ResultadoColarPocion {
  const r = finalizarEstacion(sesion.estacion, ahoraMs, cfg);
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const factor = FACTOR_PUREZA_MINIMO + (1 - FACTOR_PUREZA_MINIMO) * r.pureza!;
  const efectos = sesion.resultadoBase.efectos.map((e) => ({ stat: e.stat, magnitudPct: e.magnitudPct * factor }));
  return { ok: true, efectos, pureza: r.pureza };
}
