/**
 * Atributos del jugador — docs/GDD_Personaje.md. Mismo mecanismo exacto que
 * `jugador_oficios`/crafteo.ts: XP por atributo, persistida; nivel SIEMPRE
 * derivado (server/src/progresion/nivel.ts), nunca en sí.
 *
 * Lista revisada 2026-08-30, dos pasadas:
 * 1. `liderazgo` sale (un único disparador real) y entran `resistencia` y
 *    `comercio` — ambos con varios disparadores reales.
 * 2. **`sigilo` se retira entero** (pedido explícito: sin ningún sistema de
 *    sigilo en el servidor que lo justifique, ni disparador ni bonus, no
 *    tenía sentido mantenerlo como atributo "de adorno") y **`comercio` se
 *    fusiona dentro de `carisma`** (pedido explícito) — un único atributo
 *    social que cubre hablar con NPCs, fundar gremios Y regatear en el
 *    mercado, en vez de dos atributos con la misma "esencia social".
 *
 * Lista final: fuerza, destreza, inteligencia, resistencia, carisma (5).
 */

export const ATRIBUTOS = ["fuerza", "destreza", "inteligencia", "resistencia", "carisma"] as const;
export type Atributo = (typeof ATRIBUTOS)[number];

export function esAtributoValido(valor: string): valor is Atributo {
  return (ATRIBUTOS as readonly string[]).includes(valor);
}

const NIVEL_MAX_ATRIBUTO = 10; // mismo tope que UMBRALES_NIVEL_ATRIBUTO (progresion/nivel.ts)

/**
 * Bono de velocidad de SPRINT por nivel de resistencia (pedido streamer
 * 2026-09-07: "no se si vinculamos que correr podrias ir mas rapido
 * dependiendo de tu nivel de habilidad, si no configuralo") — gap real
 * confirmado leyendo el código: `RoomExteriorBase.ts` ya otorga XP de
 * resistencia por correr/andar/recibir golpes (`XP_RESISTENCIA_POR_*`) pero
 * `VEL_CORRER`/`VEL_ANDAR` eran constantes fijas, la XP nunca se traducía en
 * NADA jugable — mismo patrón lineal ya usado por
 * `oficios.ts::bonusVelocidadCrafteoPorNivelOficio` (0% en nivel 1, tope en
 * nivel 10). Solo afecta al SPRINT (sensación real de "correr más rápido
 * cuanto más entrenado"), nunca a VEL_ANDAR (el paseo normal no debería
 * volverse una carrera de atributos) ni a medios que ya sustituyen la
 * velocidad entera (montura/barco/carro/nadar/bucear).
 */
export function bonusVelocidadCorrerPorNivelResistencia(nivel: number): number {
  return 1 + (0.2 * (Math.max(1, Math.min(NIVEL_MAX_ATRIBUTO, nivel)) - 1)) / (NIVEL_MAX_ATRIBUTO - 1);
}
