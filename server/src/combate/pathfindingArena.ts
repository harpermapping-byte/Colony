/**
 * Rejilla NxN de una arena de combate (docs/GDD_Combate.md §1-2) — módulo
 * puro, sin Colyseus. La arena es un recorte de la MISMA rejilla del mapa
 * (nunca geometría nueva); aquí solo vive la aritmética de movimiento sobre
 * ESE recorte, en coordenadas locales `gx/gy` (0..ancho-1 / 0..alto-1).
 */

export interface Arena {
  ancho: number;
  alto: number;
  /** 1 casilla por byte, índice `gy * ancho + gx` — 1 = obstáculo, 0 = libre. */
  obstaculos: Uint8Array;
  /**
   * Coste en PA de ENTRAR en cada casilla (índice `gy * ancho + gx`), pedido
   * streamer: "2 PA si la casilla es terreno difícil/agua". Ausente o vacío
   * = todo cuesta 1 (compatibilidad con la autosimulación §7 y cualquier
   * arena sin datos de terreno reales, p.ej. la de prueba de los tests).
   */
  costes?: Uint8Array;
}

export interface Casilla {
  gx: number;
  gy: number;
}

export function esObstaculo(arena: Arena, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= arena.ancho || gy >= arena.alto) return true;
  return arena.obstaculos[gy * arena.ancho + gx] === 1;
}

/** Distancia Chebyshev (8 direcciones, la que usa alcance/movimiento en rejilla táctica — diagonal cuenta 1, no 1.41). */
export function distanciaChebyshev(a: Casilla, b: Casilla): number {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
}

function clave(c: Casilla): string {
  return `${c.gx},${c.gy}`;
}

const VECINOS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Coste en PA de ENTRAR en `destino` (1 por defecto, o lo que diga `arena.costes` — pedido streamer: "2 PA si la casilla es terreno difícil/agua"). */
function costeDeEntrar(arena: Arena, destino: Casilla): number {
  if (!arena.costes) return 1;
  const c = arena.costes[destino.gy * arena.ancho + destino.gx];
  return c > 0 ? c : 1;
}

/**
 * Dijkstra acotado por `pa` (Puntos de Acción restantes — recurso ÚNICO de
 * turno, docs/GDD_Combate.md §9.3, 8 direcciones incluida diagonal, mismo
 * criterio Chebyshev que el alcance) — coste real por casilla vía
 * `arena.costes` en vez del BFS uniforme de antes (1 paso = 1 PA siempre).
 * Devuelve el coste mínimo para ENTRAR en cada casilla alcanzable (sin
 * contar el origen), evitando obstáculos y casillas ocupadas por otra
 * unidad. Tablero máximo ~900 casillas (30x30): un Dijkstra sin cola de
 * prioridad (escaneo lineal del mínimo) es trivial en coste aquí, se
 * recalcula en cada `combate:mover`/cambio de turno, nunca cacheado (la
 * ocupación cambia cada turno).
 */
function distanciasDesde(arena: Arena, origen: Casilla, pa: number, ocupadas: Set<string>): Map<string, number> {
  const distancias = new Map<string, number>([[clave(origen), 0]]);
  if (pa <= 0) { distancias.delete(clave(origen)); return distancias; }
  const pendiente = new Set<string>([clave(origen)]);
  while (pendiente.size > 0) {
    let mejorClave = "";
    let mejorDist = Infinity;
    for (const k of pendiente) {
      const d = distancias.get(k)!;
      if (d < mejorDist) { mejorDist = d; mejorClave = k; }
    }
    pendiente.delete(mejorClave);
    const [gx, gy] = mejorClave.split(",").map(Number);
    for (const [dx, dy] of VECINOS_8) {
      const vec: Casilla = { gx: gx + dx, gy: gy + dy };
      const k = clave(vec);
      if (esObstaculo(arena, vec.gx, vec.gy) || ocupadas.has(k)) continue;
      const nuevoCoste = mejorDist + costeDeEntrar(arena, vec);
      if (nuevoCoste > pa) continue;
      const actual = distancias.get(k);
      if (actual === undefined || nuevoCoste < actual) {
        distancias.set(k, nuevoCoste);
        pendiente.add(k);
      }
    }
  }
  distancias.delete(clave(origen));
  return distancias;
}

/** Casillas alcanzables con `pa` (ver `distanciasDesde`) — mismo criterio que antes, ahora consciente de coste de terreno. */
export function casillasAlcanzables(arena: Arena, origen: Casilla, pa: number, ocupadas: Set<string> = new Set()): Set<string> {
  return new Set(distanciasDesde(arena, origen, pa, ocupadas).keys());
}

/**
 * Coste real (en PA) de ir de `origen` a `destino`, o `null` si no es
 * alcanzable con `pa` como mucho — usa el MISMO Dijkstra que
 * `casillasAlcanzables` (coherentes entre sí). Lo usa `combate:mover` para
 * descontar el PA gastado de verdad, no una aproximación en línea recta.
 */
export function costeCasilla(arena: Arena, origen: Casilla, destino: Casilla, pa: number, ocupadas: Set<string> = new Set()): number | null {
  if (origen.gx === destino.gx && origen.gy === destino.gy) return 0;
  return distanciasDesde(arena, origen, pa, ocupadas).get(clave(destino)) ?? null;
}

/** Un paso codicioso hacia `objetivo` (8 direcciones), evitando obstáculos — usado por la IA automática (§7), no por el `combate:mover` interactivo (ese usa `casillasAlcanzables` + el punto exacto que pide el jugador). */
export function pasoHacia(arena: Arena, desde: Casilla, objetivo: Casilla): Casilla {
  const dx = Math.sign(objetivo.gx - desde.gx);
  const dy = Math.sign(objetivo.gy - desde.gy);
  if (dx === 0 && dy === 0) return desde;
  const candidatos: Casilla[] = [
    { gx: desde.gx + dx, gy: desde.gy + dy }, // diagonal directa
    { gx: desde.gx + dx, gy: desde.gy },
    { gx: desde.gx, gy: desde.gy + dy },
  ];
  for (const c of candidatos) {
    if (!esObstaculo(arena, c.gx, c.gy)) return c;
  }
  return desde; // atrapado — se queda quieto este paso
}
