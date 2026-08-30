/**
 * Crecimiento de bosques — pedido del streamer 2026-08-30: cada árbol
 * adulto tiene un radio y una probabilidad (según especie) de "tirar
 * semilla" y hacer nacer un arbolito joven cerca, que en un número de días
 * de mundo (según especie) se convierte en árbol adulto. Al talar un árbol
 * también se obtienen semillas plantables — mismo mecanismo de crecimiento
 * que el brote silvestre, solo cambia quién lo puso ahí.
 *
 * Módulo PURO (sin Colyseus/BD/fs/Math.random directo) — mismo criterio
 * que reproduccionFauna.ts: la integración en vivo (activar sectores cerca
 * de jugadores) vive en bosqueSector.ts/bosquesVivos.ts. Cálculo perezoso:
 * nada de esto corre en un tick de fondo, solo se resuelve al reactivar un
 * sector, comparando `tiempoMundo().dia` contra lo persistido.
 */

export interface EspecieArbol {
  /** Casillas alrededor del árbol adulto donde puede nacer un brote nuevo. */
  radioPropagacion: number;
  /** Probabilidad de que ESTE árbol concreto propague en la resolución actual — UNA
   * tirada por árbol adulto elegible, nunca una por cada día transcurrido (mismo
   * criterio que reproduccionFauna.ts: evita que un hueco de tiempo largo dispare
   * una explosión de brotes). */
  probabilidadPropagacion: number;
  /** Días de mundo desde que se planta/nace un brote hasta que madura a adulto. */
  diasMaduracion: number;
}

/** ¿Ya maduró un brote joven plantado/nacido en `diaPlantado`? */
export function tocaMadurar(diaPlantado: number, diasMaduracion: number, ahora: number): boolean {
  return ahora - diaPlantado >= diasMaduracion;
}

/** Tirada de propagación de un árbol adulto elegible — `rnd` inyectado para tests deterministas. */
export function intentaPropagar(especie: EspecieArbol, rnd: () => number = Math.random): boolean {
  return rnd() < especie.probabilidadPropagacion;
}

/** Punto al azar dentro del radio de propagación del árbol padre, redondeado a casilla entera. */
export function puntoAleatorioEnRadio(
  cx: number,
  cy: number,
  radio: number,
  rnd: () => number = Math.random,
): { x: number; y: number } {
  const angulo = rnd() * Math.PI * 2;
  const distancia = rnd() * radio;
  return { x: Math.round(cx + Math.cos(angulo) * distancia), y: Math.round(cy + Math.sin(angulo) * distancia) };
}
