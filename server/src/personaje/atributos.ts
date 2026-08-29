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
