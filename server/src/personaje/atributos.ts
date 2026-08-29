/**
 * Atributos del jugador — docs/GDD_Personaje.md, lista dada por el streamer
 * (Backlog "Sistema de personaje"): "mejoran según uso/experiencia, no un
 * nivel global — encaja con el patrón ya usado en oficios". Mismo mecanismo
 * exacto que `jugador_oficios`/crafteo.ts: XP por atributo, persistida;
 * nivel SIEMPRE derivado (server/src/progresion/nivel.ts), nunca en sí.
 *
 * v1 solo conecta el disparador de XP donde YA existe una acción real que
 * lo justifique (fundar/hacer crecer un gremio -> liderazgo, hablar con un
 * NPC -> carisma) — fuerza/destreza/inteligencia/sigilo se quedan con nivel
 * 1 por defecto y SIN disparador todavía: dependen de sistemas que no están
 * construidos (combate, sigilo, crafteo con fallos...). Mismo criterio que
 * Crafteo arrancó con una receta representativa por familia, no el árbol
 * entero — aquí se prueba el mecanismo con dos ejemplos reales en vez de
 * inventar un disparador para los cuatro restantes.
 */

export const ATRIBUTOS = ["fuerza", "destreza", "inteligencia", "sigilo", "carisma", "liderazgo"] as const;
export type Atributo = (typeof ATRIBUTOS)[number];

export function esAtributoValido(valor: string): valor is Atributo {
  return (ATRIBUTOS as readonly string[]).includes(valor);
}
