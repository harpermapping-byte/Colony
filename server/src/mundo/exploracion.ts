/**
 * Niebla de guerra del mapa de mundo (docs/GDD_Mapa_Mundo.md, pedido
 * 2026-08-31): "se va descubriendo alrededor tuyo en un radio", con
 * permanencia (sobrevive a morir/desconectar). Módulo PURO — sin
 * Colyseus/BD — mismo patrón que anatomia.ts/enfermedades.ts: solo
 * números y funciones que RoomExteriorBase aplica sobre el jugador real.
 *
 * Granularidad = SECTOR (mismo tamaño que ya usa el streaming del
 * cliente, `tilesPorSector`) — no casilla a casilla, que sería carísimo
 * de persistir para un mapa de 3200x3200. Cada sector revelado es un
 * número empaquetado (sy*ANCHO_EMPAQUETADO+sx), guardado como array JSON
 * — mismo criterio de blob JSON en TEXT que `extra` de construcciones.
 */

/** Ancho de empaquetado: ningún mapa real tendrá 100000 sectores de ancho. */
const ANCHO_EMPAQUETADO = 100000;

export function empaquetarSector(sx: number, sy: number): number {
  return sy * ANCHO_EMPAQUETADO + sx;
}

export function desempaquetarSector(clave: number): { sx: number; sy: number } {
  return { sx: clave % ANCHO_EMPAQUETADO, sy: Math.floor(clave / ANCHO_EMPAQUETADO) };
}

/** Sector (sx,sy) que contiene la posición (x,y) en casillas. */
export function sectorDePosicion(x: number, y: number, tilesPorSector: number): { sx: number; sy: number } {
  return { sx: Math.floor(x / tilesPorSector), sy: Math.floor(y / tilesPorSector) };
}

/** Radio de revelado alrededor del sector actual, en sectores (no casillas) — "alrededor tuyo en un radio". */
export const RADIO_REVELADO_SECTORES = 2;

/** Claves empaquetadas de todos los sectores dentro de `radio` sectores del (sx,sy) dado, incluido él mismo. */
export function sectoresARevelar(sx: number, sy: number, radio: number = RADIO_REVELADO_SECTORES): number[] {
  const claves: number[] = [];
  for (let dy = -radio; dy <= radio; dy++) {
    for (let dx = -radio; dx <= radio; dx++) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (nx < 0 || ny < 0) continue; // fuera del mapa por ese lado — ANCHO_EMPAQUETADO exige sx/sy >= 0
      claves.push(empaquetarSector(nx, ny));
    }
  }
  return claves;
}

/**
 * Aplica un revelado incremental: dado el set YA revelado y la posición
 * actual, devuelve las claves NUEVAS (aún no reveladas) que hay que
 * añadir — [] si no hay ninguna nueva (caso común, la mayoría de ticks).
 * Pura: quien llama decide si persiste el resultado.
 */
export function nuevasClavesReveladas(reveladoPrevio: ReadonlySet<number>, x: number, y: number, tilesPorSector: number, radio: number = RADIO_REVELADO_SECTORES): number[] {
  const { sx, sy } = sectorDePosicion(x, y, tilesPorSector);
  const candidatas = sectoresARevelar(sx, sy, radio);
  return candidatas.filter((c) => !reveladoPrevio.has(c));
}
