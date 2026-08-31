/**
 * Catálogo de enemigos (personajes/catalogo/enemigos.json) — compartido
 * entre DungeonRoom (mazmorras normales: elige por temasEnemigo del punto
 * de spawn bakeado) e InteriorRoom (cuartel bandido, docs/GDD_Faccion_Bandidos.md
 * §7bis: elige siempre por el tema fijo "bandido"). Extraído de DungeonRoom
 * para no duplicar el mismo require+selección ponderada en las dos rooms.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enemigos: Record<string, { temasEnemigo: string[]; pesoSpawn?: number; esBoss?: boolean; tipoRig?: string }> = require("../../../personajes/catalogo/enemigos.json");

// Debe coincidir con el nº de variantes con el que se corrió
// personajes/src/exportar_enemigos.js al generar assets/enemigos/pool.json
// (el aspecto se generó offline, una vez — el servidor solo elige el índice).
export const VARIANTES_POR_ENEMIGO = 3;

export function elegirEnemigoDeTema(temas: string[], soloBosses: boolean): string | null {
  const candidatos = Object.entries(enemigos).filter(
    ([, def]) => !!def.esBoss === soloBosses && (def.temasEnemigo || []).some((t) => temas.includes(t)),
  );
  if (candidatos.length === 0) return null;
  const pesoTotal = candidatos.reduce((s, [, def]) => s + (def.pesoSpawn ?? 10), 0);
  let r = Math.random() * pesoTotal;
  for (const [id, def] of candidatos) {
    r -= def.pesoSpawn ?? 10;
    if (r <= 0) return id;
  }
  return candidatos[candidatos.length - 1][0];
}

/** ¿Este enemigoId es humanoide (tipoRig "npc") y no animal? Pedido 2026-08-31: el loot procedural de jefe solo aplica a bosses humanoides. */
export function esEnemigoHumanoide(enemigoId: string): boolean {
  return enemigos[enemigoId]?.tipoRig === "npc";
}
