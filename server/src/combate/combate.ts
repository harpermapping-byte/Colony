/**
 * Vida / Ataque / Defensa — reglas puras de combate (docs/GDD_Mecanicas.md
 * §5.4, pedido 2026-08-30). Sin acoplar a Colyseus ni a BD: esto es solo la
 * fórmula, testeada sola — los distintos gestores (fauna salvaje, jugadores)
 * la usan para aplicar daño/curación sobre SU propio estado.
 *
 * Reglas de diseño (pedidas explícitamente, no negociables sin volver a
 * preguntar al streamer):
 * - Los ANIMALES no tienen defensa: su única resistencia es la vida máxima.
 *   Encajan en esta misma fórmula pasando `defensa: 0` siempre.
 * - Jugadores y NPCs humanoides SÍ tienen defensa (equipo/atributos/magia).
 * - Reducción de daño simple: `daño = max(1, ataque - defensa)` — nunca
 *   menos de 1, para que un golpe siempre haga algo aunque la defensa sea
 *   muy alta (evita el caso degenerado "inmortal por armadura").
 * - Jugadores: SIN regeneración automática en combate — solo comida (fuera
 *   de combate) o pociones/magia curan. Animales y NPCs: la vida queda fija
 *   tras el combate, no se regeneran solos — solo un jugador curándolos a
 *   propósito (objeto/magia) la sube.
 * Esta última regla (nadie se cura solo con el tiempo) es la razón de que
 * NO haya aquí ninguna función de "tick"/regeneración periódica — curar es
 * siempre un evento explícito (`curar`), nunca algo que pase por sí solo.
 */

export interface Estadisticas {
  vida: number;
  vidaMax: number;
  ataque: number;
  /** Los animales siempre valen 0 aquí — no tienen estadística de defensa. */
  defensa: number;
}

/** Base obligatoria de todo jugador nuevo (pedido explícito: "100 HP"). Se
 * modifica en vivo por equipo/atributos/magia — esto es solo el punto de partida. */
export const VIDA_BASE_JUGADOR = 100;

/** A puño limpio, sin ningún arma equipada. */
export const ATAQUE_BASE_JUGADOR = 3;

/** Sin armadura equipada, un jugador no reduce nada de daño todavía. */
export const DEFENSA_BASE_JUGADOR = 0;

/**
 * Reducción de daño simple y directa: la defensa resta del ataque, nunca
 * por debajo de 1. Para un animal defendiéndose, quien llama pasa
 * `defensa: 0` (los animales no tienen esa estadística) — con eso el daño
 * recibido es exactamente el ataque del atacante, tal cual pide el diseño.
 */
export function calcularDanio(ataque: number, defensa: number): number {
  return Math.max(1, Math.round(ataque - defensa));
}

/** Nunca deja la vida fuera de [0, vidaMax]. Devuelve un objeto nuevo (no muta). */
export function aplicarDanio(stats: Estadisticas, danio: number): Estadisticas {
  return { ...stats, vida: Math.max(0, stats.vida - Math.max(0, danio)) };
}

export function estaMuerto(stats: Pick<Estadisticas, "vida">): boolean {
  return stats.vida <= 0;
}

/** Curación explícita (objeto/magia) — nunca pasa de vidaMax. Devuelve un objeto nuevo. */
export function curar(stats: Estadisticas, cantidad: number): Estadisticas {
  return { ...stats, vida: Math.min(stats.vidaMax, stats.vida + Math.max(0, cantidad)) };
}

/** Estadísticas de un animal a partir de su entrada de catálogo — sin defensa, nunca. */
export function estadisticasAnimal(datos: { vidaMaxima: number; ataque: number }): Estadisticas {
  return { vida: datos.vidaMaxima, vidaMax: datos.vidaMaxima, ataque: datos.ataque, defensa: 0 };
}

/** Un jugador recién creado — equipo/atributos/magia lo modifican DESPUÉS, esto es solo el punto de partida. */
export function estadisticasJugadorBase(): Estadisticas {
  return {
    vida: VIDA_BASE_JUGADOR,
    vidaMax: VIDA_BASE_JUGADOR,
    ataque: ATAQUE_BASE_JUGADOR,
    defensa: DEFENSA_BASE_JUGADOR,
  };
}
