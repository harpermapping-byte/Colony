/**
 * Durabilidad de lo EQUIPADO durante combate (docs/GDD_Combate.md, pedido
 * 2026-09-03: "conectalo obviamente tambien con armas" — arma Y armadura,
 * no solo armadura como sugería la propuesta original).
 *
 * Hasta 2026-09-03 este módulo trackeaba el desgaste en un Map de PROCESO
 * propio (keyed por nombre de jugador) porque `equiparItem`/`desequiparItem`
 * (inventario.ts) no tenían dónde guardar la durabilidad real de la
 * instancia mientras estaba equipada — workaround honesto, mismo criterio
 * que `combate/registroArenas.ts`, pero efímero (se perdía en cada reinicio
 * del servidor) y sin persistencia en BD. Ese hueco ya se cerró de raíz:
 * `InventarioJugador.equipoDurabilidad` (inventario.ts) es ahora la fuente
 * de verdad real, capturada por `equiparItem`/restaurada por
 * `desequiparItem` y persistida en la tabla `equipo` (bd.ts, columna
 * `durabilidad`) exactamente igual que el resto del equipo.
 *
 * Este módulo se queda solo como capa de conveniencia: reusa las mismas
 * funciones PURAS de `desgaste.ts` (`registrarUso`/`aplicarDanoArmadura`)
 * pero operando directamente sobre `inv.equipo`+`inv.equipoDurabilidad` del
 * `InventarioJugador` real de la sesión (`this.inventarioJugador(sessionId)`
 * en RoomExteriorBase/ArenaCombateRoom) en vez de un Map propio — sin
 * estado interno, sin nada que se pierda al reiniciar el proceso, sin dos
 * fuentes de verdad para lo mismo. Como esas funciones puras esperan una
 * `ItemInstancia` completa (no solo un número), se construye una temporal
 * por slot con la durabilidad ya trackeada y se escribe el resultado de
 * vuelta a `equipoDurabilidad` — igual que si la instancia real siguiera
 * viva mientras está puesta.
 */

import { CatalogoItems, EntradaCatalogoItem, InventarioJugador, ItemInstancia } from "./inventario";
import { aplicarDanoArmadura, registrarUso, tieneDurabilidad } from "./desgaste";

/** Instancia temporal para el slot `slot`, con la durabilidad ya trackeada en `inv.equipoDurabilidad` (o a tope si es la primera vez que se toca). `ultimoUso: ahoraMs` = cero desgaste por inactividad de por medio (mientras está equipada no hay reloj propio que cerrar, ver inventario.ts::desequiparItem). */
function instanciaTemporalDe(inv: InventarioJugador, slot: string, itemId: string, entrada: EntradaCatalogoItem, ahoraMs: number): ItemInstancia {
  return {
    id: -1,
    itemId,
    cantidad: 1,
    x: 0,
    y: 0,
    rot: 0,
    durabilidad: inv.equipoDurabilidad[slot] ?? entrada.durabilidadMax,
    ultimoUso: ahoraMs,
  };
}

/**
 * Aplica el desgaste de UN combate ya resuelto (docs/GDD_Combate.md) sobre
 * lo que el jugador de `inv` lleva equipado — llamar UNA vez por jugador al
 * terminar, con los contadores acumulados de `CombateUnidad`
 * (`golpesDados`/`danoAbsorbido`), mismo sitio que `consumirMunicionDeSesion`
 * (`ArenaCombateRoom.onCombateResuelto`):
 *   - `golpesDados` > 0 → `registrarUso` sobre el arma en `manoPrincipal`.
 *   - `danoAbsorbido` > 0 → `aplicarDanoArmadura` repartido entre TODAS las
 *     demás piezas equipadas con durabilidad (armadura real).
 * Muta `inv.equipoDurabilidad` in place — el guardado normal de la sesión
 * (`persistirInventarioPorSesion`/`onLeave` → `guardarInventarioYEquipoDe`)
 * es quien lo persiste después, sin tocar la BD aparte aquí (mismo criterio
 * exacto que `consumirMunicionDeSesion`). No-op si el jugador no tiene nada
 * equipado con durabilidad en el slot correspondiente — nunca lanza.
 */
export function aplicarDesgasteCombate(
  inv: InventarioJugador,
  catalogo: CatalogoItems,
  golpesDados: number,
  danoAbsorbido: number,
  ahoraMs: number,
): void {
  if (golpesDados > 0) {
    const armaId = inv.equipo.manoPrincipal;
    const entrada = armaId ? catalogo[armaId] : undefined;
    if (armaId && entrada && tieneDurabilidad(entrada)) {
      const instancia = instanciaTemporalDe(inv, "manoPrincipal", armaId, entrada, ahoraMs);
      registrarUso(instancia, entrada, ahoraMs, golpesDados);
      inv.equipoDurabilidad.manoPrincipal = instancia.durabilidad!;
    }
  }
  if (danoAbsorbido > 0) {
    const piezas: Array<{ slot: string; instancia: ItemInstancia; entrada: EntradaCatalogoItem }> = [];
    for (const [slot, itemId] of Object.entries(inv.equipo)) {
      if (slot === "manoPrincipal" || !itemId) continue; // el arma ya se trató arriba — esto es solo armadura
      const entrada = catalogo[itemId];
      if (!entrada || !tieneDurabilidad(entrada)) continue;
      piezas.push({ slot, instancia: instanciaTemporalDe(inv, slot, itemId, entrada, ahoraMs), entrada });
    }
    aplicarDanoArmadura(piezas, danoAbsorbido, ahoraMs);
    for (const { slot, instancia } of piezas) inv.equipoDurabilidad[slot] = instancia.durabilidad!;
  }
}
