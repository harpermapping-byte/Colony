/**
 * Tipos compartidos de la integración con Twitch (docs/GDD_Twitch.md,
 * pedido 2026-08-30). Sin dependencia de Colyseus/tmi.js aquí — solo el
 * vocabulario que comparten los módulos puros (titulos.ts, catalogoEventos.ts)
 * y el orquestador (gestorTwitch.ts).
 */

/** Roles de Twitch que YA llegan en cada mensaje de chat (badges de IRC) — sin OAuth adicional. */
export interface RolChat {
  esMod: boolean;
  esVip: boolean;
  esSub: boolean;
  /** 1/2/3 si esSub, 0 si no. */
  tierSub: 0 | 1 | 2 | 3;
}

/** Rol resuelto para asignar título — incluye jarl/admin (config del proyecto) y seguidor (pendiente, ver GDD §5). */
export type RolResuelto = "jarl" | "moderador" | "sub" | "seguidor" | "ninguno";
