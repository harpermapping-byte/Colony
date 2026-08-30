/**
 * Stats/loot compartidos de una tropa bandida vivida en combate real
 * (docs/GDD_Faccion_Bandidos.md §7bis/§7ter) — dos consumidores hoy:
 * InteriorRoom (guarnición quieta dentro del cuartel `campamento_hostil`) y
 * RegionRoom (patrulla de reclutas que camina fuera, §7ter). Un solo sitio
 * para no repetir las mismas tres tablas en cada room.
 */
import { RangoTropa } from "../datos/bd";

// Vida/ataque/defensa por rango, escalados por el nivelEquipo REAL del
// asentamiento (1=garrote/túnica, 2=cota/espada, 3=placas/hacha) — la
// primera vez que subir de nivel de equipo se nota jugando, no solo en una
// fila de SQLite. Placeholder de balance, mismo criterio que el resto de
// números de referencia del proyecto.
export const STATS_POR_RANGO: Record<RangoTropa, { vida: number; ataque: number; defensa: number }> = {
  recluta: { vida: 25, ataque: 5, defensa: 1 },
  guardia: { vida: 50, ataque: 9, defensa: 4 },
  lider: { vida: 90, ataque: 15, defensa: 7 },
};
export const FACTOR_POR_NIVEL_EQUIPO: Record<number, number> = { 1: 1, 2: 1.3, 3: 1.6 };

// Loot al morir una tropa (cadáver looteable, docs/GDD_Caza.md — mismo
// mecanismo que un animal, "cadaver:lootear"): materiales YA existentes en
// el catálogo, nada nuevo que inventar — escala con el rango, no con el
// nivelEquipo (el equipo real que llevaba puesto no se puede lootear
// todavía, ver docs/GDD_Faccion_Bandidos.md §7bis "fuera de esta pasada").
export const LOOT_POR_RANGO: Record<RangoTropa, { itemId: string; cantidad: number }[]> = {
  recluta: [{ itemId: "madera_dura", cantidad: 1 }],
  guardia: [{ itemId: "madera_dura", cantidad: 2 }, { itemId: "piedra_tallada", cantidad: 1 }],
  lider: [{ itemId: "piedra_tallada", cantidad: 2 }, { itemId: "hierro", cantidad: 2 }],
};
