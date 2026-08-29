/**
 * Atributos del jugador — docs/GDD_Personaje.md. Mismo mecanismo exacto que
 * `jugador_oficios`/crafteo.ts: XP por atributo, persistida; nivel SIEMPRE
 * derivado (server/src/progresion/nivel.ts), nunca en sí.
 *
 * Lista revisada 2026-08-30 (pedido explícito): `liderazgo` sale (un único
 * disparador real, `gremio:fundar`, sin más acciones que lo justifiquen) y
 * entran `resistencia` y `comercio` — ambos con al menos 2 disparadores
 * reales ya conectados (ver §3.2 de docs/GDD_Personaje.md), más útiles que
 * un atributo que solo podía subir fundando un gremio una vez.
 *
 * Cada atributo tiene VARIAS formas reales de subir (pedido explícito:
 * "que cada atributo tenga varias formas de sacar exp") — nunca un
 * disparador inventado para rellenar hueco: si un atributo no tiene
 * ninguna acción real que lo justifique todavía (sigilo — no existe ningún
 * sistema de sigilo en el servidor), se queda sin disparador en vez de
 * fabricar uno falso.
 */

export const ATRIBUTOS = ["fuerza", "destreza", "inteligencia", "resistencia", "sigilo", "carisma", "comercio"] as const;
export type Atributo = (typeof ATRIBUTOS)[number];

export function esAtributoValido(valor: string): valor is Atributo {
  return (ATRIBUTOS as readonly string[]).includes(valor);
}
