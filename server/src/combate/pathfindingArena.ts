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

/**
 * BFS acotado por `mp` (puntos de movimiento restantes, coste 1 por paso
 * incluida diagonal — mismo criterio Chebyshev que el alcance) — devuelve
 * el conjunto de casillas alcanzables (sin contar la de origen), evitando
 * obstáculos y casillas ocupadas por otra unidad. 64/100 casillas máximo:
 * trivial en coste, se recalcula en cada `combate:mover`/cambio de turno,
 * nunca cacheado (la ocupación cambia cada turno).
 */
export function casillasAlcanzables(arena: Arena, origen: Casilla, mp: number, ocupadas: Set<string> = new Set()): Set<string> {
  const alcanzables = new Set<string>();
  if (mp <= 0) return alcanzables;
  let frontera: Casilla[] = [origen];
  const visitado = new Set<string>([clave(origen)]);
  for (let paso = 0; paso < mp; paso++) {
    const siguiente: Casilla[] = [];
    for (const c of frontera) {
      for (const [dx, dy] of VECINOS_8) {
        const vec: Casilla = { gx: c.gx + dx, gy: c.gy + dy };
        const k = clave(vec);
        if (visitado.has(k) || esObstaculo(arena, vec.gx, vec.gy) || ocupadas.has(k)) continue;
        visitado.add(k);
        alcanzables.add(k);
        siguiente.push(vec);
      }
    }
    frontera = siguiente;
    if (frontera.length === 0) break;
  }
  return alcanzables;
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
