/**
 * Títulos sociales por rol de Twitch (docs/GDD_Twitch.md, docs/GDD_Mecanicas.md
 * §5.11: "perks COSMÉTICOS y sociales... nunca ventaja de poder"). Módulo
 * PURO — sin Colyseus/tmi.js, testeado solo. `resolverRol`/`tituloDe` son las
 * dos funciones que usa `gestorTwitch.ts`.
 *
 * Jerarquía si un jugador cumple varias condiciones a la vez (el título más
 * "alto" gana, no se acumulan): jarl/admin > moderador > sub > seguidor.
 *
 * NOTA de alcance (pedido 2026-08-30, interpretación mía marcada al streamer
 * para confirmar): "sub tier 2/3" no tiene título propio distinto de tier 1
 * en esta pasada — todo sub (1/2/3) es "Cortesano" por igual. Si el streamer
 * quiere un título distinto por tier, es una entrada más en `TITULOS` abajo,
 * sin tocar el resto del mecanismo.
 */
import { RolChat, RolResuelto } from "./tipos";

export const TITULOS: Record<Exclude<RolResuelto, "ninguno">, string> = {
  jarl: "", // caso especial: el nombre del STREAMER, no un título fijo — ver tituloDe()
  moderador: "Arguiñano",
  sub: "Cortesano",
  seguidor: "Condellano",
};

/**
 * Resuelve el rol más alto que cumple este chatter. `esJarl` viene de
 * `esJarlGlobal(nombre)` (construccion.ts, JARL_NOMBRES env) — la MISMA
 * comprobación que ya usa el resto del proyecto para "quién es admin".
 * `esSeguidor` es `undefined` cuando todavía no se ha podido comprobar
 * (pendiente de scope de Twitch, ver GDD §5) — se trata como "no" sin
 * romper nada, nunca se inventa un seguidor que no se ha confirmado.
 */
export function resolverRol(rol: RolChat, esJarl: boolean, esSeguidor: boolean | undefined): RolResuelto {
  if (esJarl) return "jarl";
  if (rol.esMod) return "moderador";
  if (rol.esSub) return "sub";
  if (esSeguidor) return "seguidor";
  return "ninguno";
}

/** Título a mostrar sobre el PJ — cadena vacía = sin título (ni seguidor ni nada, pedido literal). */
export function tituloDe(rolResuelto: RolResuelto, nombreStreamer: string): string {
  if (rolResuelto === "ninguno") return "";
  if (rolResuelto === "jarl") return nombreStreamer;
  return TITULOS[rolResuelto];
}
