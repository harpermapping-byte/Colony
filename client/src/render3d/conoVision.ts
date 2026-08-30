/**
 * Cono de visión en interiores (docs/Backlog_Mecanicas_Futuras.md, "Cono/
 * campo de visión real en interiores"): con la cámara isométrica ORTOGRÁFICA
 * y FIJA del juego (worldScene.ts::posicionarCamaraIsometrica, siempre a
 * offset (+distancia,+distancia,+distancia) de su objetivo → mira en
 * dirección constante (-1,-1,-1)), las paredes ESTE (X máxima de la sala) y
 * SUR (Z máxima) son SIEMPRE las que dan a cámara — igual para CUALQUIER
 * sala del edificio, no depende de la posición del jugador (a diferencia de
 * una cámara que rotase con él). Lo que SÍ depende del jugador es DÓNDE se
 * aplica ese recorte: solo en la sala que pisa, y en cascada a través de una
 * puerta en su pared NORTE u OESTE (las que se quedan de fondo, visibles)
 * hacia la sala contigua — un hueco en la pared este/sur no necesita este
 * cálculo, esa pared ya no se pinta nunca (interiorVisual.ts la omite
 * siempre que hay puerta, siga o no siga la sala en el set de "visibles").
 *
 * Mismo principio que cita el backlog: "en proyección en paralelo/isométrica
 * sin fuga de perspectiva, la silueta de lo visible a través de un hueco es
 * idéntica a la silueta del propio hueco, sea cual sea la profundidad" — al
 * ser SIEMPRE la misma dirección de cámara, esto se reduce a "¿hay un camino
 * de puertas norte/oeste desde la sala del jugador hasta esta sala?", sin
 * necesitar raycasting real ni depender de la profundidad.
 *
 * v1, granularidad de SALA completa: revela la sala vecina entera (no
 * recorta solo la porción visible de una sala grande a través de un hueco
 * estrecho) — mismo alcance mínimo que ya señalaba GDD_Sistema_Puertas.md
 * "Qué falta" para la oclusión de paredes. Recorte sub-sala queda para más
 * adelante si hace falta.
 */

export type Lado = "norte" | "sur" | "este" | "oeste";

export interface SalaRect {
  offsetX: number;
  offsetY: number;
  ancho: number;
  largo: number;
}

export interface PuertaConexion {
  x: number;
  y: number;
}

/** Índice de la sala cuyo rectángulo contiene la casilla (x,y), o -1 si ninguna (pasillo/hueco de puerta). */
export function salaEnPosicion(salas: SalaRect[], x: number, y: number): number {
  for (let i = 0; i < salas.length; i++) {
    const s = salas[i];
    if (x >= s.offsetX && x < s.offsetX + s.ancho && y >= s.offsetY && y < s.offsetY + s.largo) return i;
  }
  return -1;
}

/** Coordenadas (x si norte, y si oeste) de la sala donde su lado norte/oeste tiene una puerta de conexión real. */
function coordsConPuerta(sala: SalaRect, lado: "norte" | "oeste", puertas: PuertaConexion[]): number[] {
  const coords: number[] = [];
  if (lado === "norte") {
    const filaHueco = sala.offsetY - 1;
    for (let x = sala.offsetX; x < sala.offsetX + sala.ancho; x++) {
      if (puertas.some((p) => p.x === x && p.y === filaHueco)) coords.push(x);
    }
  } else {
    const colHueco = sala.offsetX - 1;
    for (let y = sala.offsetY; y < sala.offsetY + sala.largo; y++) {
      if (puertas.some((p) => p.x === colHueco && p.y === y)) coords.push(y);
    }
  }
  return coords;
}

/** Sala vecina al otro lado de una puerta norte/oeste de `sala` en la coordenada dada, o -1 si no hay ninguna sala ahí. */
function vecinoPorNorteOOeste(salas: SalaRect[], sala: SalaRect, lado: "norte" | "oeste", coord: number): number {
  if (lado === "norte") {
    const filaHueco = sala.offsetY - 1;
    for (let i = 0; i < salas.length; i++) {
      const v = salas[i];
      if (v.offsetY + v.largo === filaHueco && coord >= v.offsetX && coord < v.offsetX + v.ancho) return i;
    }
  } else {
    const colHueco = sala.offsetX - 1;
    for (let i = 0; i < salas.length; i++) {
      const v = salas[i];
      if (v.offsetX + v.ancho === colHueco && coord >= v.offsetY && coord < v.offsetY + v.largo) return i;
    }
  }
  return -1;
}

/**
 * BFS desde la sala del jugador, cruzando SOLO puertas norte/oeste (las de
 * las paredes que se quedan de fondo) — el set resultante son las salas cuyas
 * paredes este/sur hay que ocultar para que el jugador pueda ver dentro.
 */
export function salasVisibles(salas: SalaRect[], puertas: PuertaConexion[], indiceJugador: number): Set<number> {
  const visibles = new Set<number>();
  if (indiceJugador < 0 || indiceJugador >= salas.length) return visibles;
  const cola = [indiceJugador];
  visibles.add(indiceJugador);
  while (cola.length > 0) {
    const i = cola.shift()!;
    const sala = salas[i];
    for (const lado of ["norte", "oeste"] as const) {
      for (const coord of coordsConPuerta(sala, lado, puertas)) {
        const vecino = vecinoPorNorteOOeste(salas, sala, lado, coord);
        if (vecino >= 0 && !visibles.has(vecino)) {
          visibles.add(vecino);
          cola.push(vecino);
        }
      }
    }
  }
  return visibles;
}

/** ¿Debe ocultarse esta pared para que se vea dentro de la sala? Solo este/sur, y solo si la sala está en el set de "visibles". */
export function paredOculta(salaIndex: number, lado: Lado, visibles: Set<number>): boolean {
  return (lado === "este" || lado === "sur") && visibles.has(salaIndex);
}
