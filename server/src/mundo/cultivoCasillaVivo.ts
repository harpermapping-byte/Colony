/**
 * Caché de proceso de las casillas de cultivo VIVAS de un mapa
 * (docs/GDD_Carros.md §9.1, Fase 3) — mismo criterio EXACTO que
 * `recolectablesDeMapa()` (mundo/recolectables.ts): un Map por mapaId, el
 * MISMO objeto en cada llamada mientras el proceso viva (una región vacía
 * se autodispone y se recrea desde cero en la siguiente visita, "una
 * aldea sin jugadores cuesta cero"). A diferencia de los recolectables
 * silvestres, aquí SÍ hay persistencia real (`casillas_cultivo` en BD) —
 * `esNuevo` distingue la primera vez (toca hidratar desde BD) de una
 * recarga posterior (reusar tal cual, con el trabajo del jugador ya
 * cargado dentro).
 */
import { EstadoCasillaCultivo } from "./cultivoCasilla";

const cachePorMapa = new Map<string, Map<number, EstadoCasillaCultivo>>();

export function casillasCultivoDeMapa(mapaId: string): { mapa: Map<number, EstadoCasillaCultivo>; esNuevo: boolean } {
  let mapa = cachePorMapa.get(mapaId);
  const esNuevo = !mapa;
  if (!mapa) {
    mapa = new Map();
    cachePorMapa.set(mapaId, mapa);
  }
  return { mapa, esNuevo };
}
