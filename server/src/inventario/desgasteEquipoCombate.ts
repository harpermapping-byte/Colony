/**
 * Durabilidad de lo EQUIPADO durante combate (docs/GDD_Combate.md, pedido
 * 2026-09-03: "conectalo obviamente tambien con armas" — arma Y armadura,
 * no solo armadura como sugería la propuesta original).
 *
 * Hueco real que arrastraba el sistema de equipo desde que se construyó
 * (confirmado leyendo el código, no hipotético): `equiparItem`
 * (inventario.ts) saca la `ItemInstancia` del contenedor al equiparse y
 * solo deja el `itemId` en `SlotsEquipo` — la durabilidad real de ESA
 * instancia concreta se pierde en el acto, porque no hay dónde guardarla:
 * la tabla `equipo` de BD (`bd.ts::guardarEquipo/cargarEquipo`, los DOS
 * backends) solo tiene `jugador_id/slot/item_id`, sin columna de
 * durabilidad. Arreglar eso de raíz es una migración de esquema en dos
 * backends de BD — fuera de alcance de esta pasada (cambio grande, se
 * propone aparte si el streamer lo pide).
 *
 * Mientras tanto, este módulo trackea el desgaste de lo equipado en un Map
 * de PROCESO — mismo criterio que `combate/registroArenas.ts` ("las rooms
 * corren en el MISMO proceso, un Map en memoria compartido por todo el
 * módulo basta, sin mensajería nueva") — pero, a diferencia de
 * `registroArenas.ts`, keyed por NOMBRE de jugador (estable entre
 * reconexiones/cambios de room) en vez de `sessionId` (cambia en cada
 * room nueva, INCLUIDA la arena de combate — que es justo donde hace falta
 * que el desgaste sobreviva el salto room de origen → arena → vuelta).
 *
 * Efímero solo si el PROCESO se reinicia (igual que cualquier registro en
 * memoria del proyecto, ver `buffsPocionPorSesion`) — a diferencia de esos
 * buffs, este SÍ sobrevive a que el jugador se desconecte y vuelva, porque
 * la clave es su nombre, no su sesión. Lo que NO hace: persistir a BD, ni
 * arrancar con el desgaste real que ya tuviera un arma equipada ANTES de
 * que este sistema existiera (arranca a plena durabilidad la primera vez
 * que se necesita) — huecos honestos, documentados también en
 * docs/GDD_Combate.md.
 */

import { CatalogoItems, ItemInstancia, SlotsEquipo } from "./inventario";
import { PiezaEquipada, aplicarDanoArmadura, registrarUso, tieneDurabilidad } from "./desgaste";

const porJugador = new Map<string, Map<string, ItemInstancia>>();

/**
 * Instancia trackeada de lo que `nombreJugador` lleva puesto en `slot` —
 * la crea a plena durabilidad la primera vez que hace falta (no hay valor
 * previo real que recuperar, ver nota de arriba) o si el `itemId` cambió
 * desde la última vez (se equipó algo distinto). `undefined` si el ítem no
 * tiene `durabilidadMax` (nunca se desgasta) o no existe en catálogo.
 */
function instanciaEquipadaDe(nombreJugador: string, slot: string, itemId: string, catalogo: CatalogoItems, ahoraMs: number): ItemInstancia | undefined {
  const entrada = catalogo[itemId];
  if (!entrada || !tieneDurabilidad(entrada)) return undefined;
  let porSlot = porJugador.get(nombreJugador);
  if (!porSlot) {
    porSlot = new Map();
    porJugador.set(nombreJugador, porSlot);
  }
  let instancia = porSlot.get(slot);
  if (!instancia || instancia.itemId !== itemId) {
    instancia = { id: -1, itemId, cantidad: 1, x: 0, y: 0, rot: 0, durabilidad: entrada.durabilidadMax, ultimoUso: ahoraMs };
    porSlot.set(slot, instancia);
  }
  return instancia;
}

/**
 * Durabilidad ACTUAL trackeada de `nombreJugador` en `slot` — `undefined` si
 * nunca se llegó a trackear nada ahí (no tiene nada equipado con
 * durabilidad, o nunca participó en un combate que lo desgastara). Solo
 * lectura, para inspección/tests — el desgaste real lo aplica
 * `aplicarDesgasteCombate`.
 */
export function durabilidadEquipadaDe(nombreJugador: string, slot: string): number | undefined {
  return porJugador.get(nombreJugador)?.get(slot)?.durabilidad;
}

/**
 * Aplica el desgaste de UN combate ya resuelto (docs/GDD_Combate.md) sobre
 * lo que `nombreJugador` lleva equipado — llamar UNA vez por jugador al
 * terminar, con los contadores acumulados de `CombateUnidad`
 * (`golpesDados`/`danoAbsorbido`), mismo sitio que
 * `consumirMunicionDeSesion` (`ArenaCombateRoom.onCombateResuelto`):
 *   - `golpesDados` > 0 → `registrarUso` sobre el arma en `manoPrincipal`.
 *   - `danoAbsorbido` > 0 → `aplicarDanoArmadura` repartido entre TODAS las
 *     demás piezas equipadas con durabilidad (armadura real).
 * No-op si el jugador no tiene nada equipado con durabilidad en el slot
 * correspondiente — nunca lanza.
 */
export function aplicarDesgasteCombate(
  nombreJugador: string,
  equipo: SlotsEquipo,
  catalogo: CatalogoItems,
  golpesDados: number,
  danoAbsorbido: number,
  ahoraMs: number,
): void {
  if (golpesDados > 0) {
    const armaId = equipo.manoPrincipal;
    if (armaId) {
      const instancia = instanciaEquipadaDe(nombreJugador, "manoPrincipal", armaId, catalogo, ahoraMs);
      const entrada = catalogo[armaId];
      if (instancia && entrada) registrarUso(instancia, entrada, ahoraMs, golpesDados);
    }
  }
  if (danoAbsorbido > 0) {
    const piezas: PiezaEquipada[] = [];
    for (const [slot, itemId] of Object.entries(equipo)) {
      if (slot === "manoPrincipal" || !itemId) continue; // el arma ya se trató arriba — esto es solo armadura
      const instancia = instanciaEquipadaDe(nombreJugador, slot, itemId, catalogo, ahoraMs);
      const entrada = catalogo[itemId];
      if (instancia && entrada) piezas.push({ instancia, entrada });
    }
    aplicarDanoArmadura(piezas, danoAbsorbido, ahoraMs);
  }
}
