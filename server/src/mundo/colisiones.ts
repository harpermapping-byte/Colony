/**
 * Colisiones del mundo — lógica PURA (sin Colyseus ni fs) para poder
 * testearla sola. Reglas acordadas (GDD_Mecanicas):
 *
 * - Todo lo sólido usa la MISMA caja sencilla: el jugador es un AABB de
 *   radio fijo en el plano, y cada casilla sólida (terreno intransitable o
 *   pieza de catálogo con `colision: true`) bloquea su casilla entera.
 * - El agua NO es pared: es un MEDIO. Se entra andando, se pasa a nadar,
 *   y en agua profunda se puede bucear bajando niveles (0 superficie,
 *   -1, -2). El medio decide la velocidad, no bloquea el paso.
 * - Los PJ también chocan entre sí: no se bloquean (evita atascos en
 *   puertas), se EMPUJAN — una separación suave por pares.
 *
 * Unidades: casillas (1 casilla = 1 unidad de mundo del cliente).
 */

export const TIPO = {
  TIERRA: 0,
  AGUA: 1, // se nada; bucear hasta nivel -1
  AGUA_PROFUNDA: 2, // se nada; bucear hasta nivel -2
  SOLIDO: 3, // bloquea (terreno intransitable seco o pieza con colision)
} as const;

export interface MundoColision {
  ancho: number; // casillas
  alto: number;
  casillas: Uint8Array; // TIPO.* por casilla (índice y*ancho+x)
  velocidad: Float32Array; // modVelocidad del terreno (1 = normal)
}

/** Radio del AABB de un PJ en casillas (caja sencilla, igual para todos). */
export const RADIO_PJ = 0.35;
const EPS = 1e-3;

export function tipoEn(mundo: MundoColision, x: number, y: number): number {
  const cx = Math.floor(x), cy = Math.floor(y);
  // fuera del mapa = pared (los bordes "abiertos" a otros mapas se
  // resolverán con el cambio de instancia, no dejando salir del array)
  if (cx < 0 || cy < 0 || cx >= mundo.ancho || cy >= mundo.alto) return TIPO.SOLIDO;
  return mundo.casillas[cy * mundo.ancho + cx];
}

function hayIntersecionSolida(mundo: MundoColision, x: number, y: number, radio: number): boolean {
  const x0 = Math.floor(x - radio), x1 = Math.floor(x + radio);
  const y0 = Math.floor(y - radio), y1 = Math.floor(y + radio);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++)
      if (tipoEn(mundo, cx + 0.5, cy + 0.5) === TIPO.SOLIDO) return true;
  return false;
}

/**
 * Mueve un AABB eje a eje ("slide"): si un eje choca, se pega al borde de
 * la PRIMERA casilla sólida en el camino y el otro eje sigue avanzando.
 * El movimiento se trocea en subpasos de <= 0.25 casillas para que un paso
 * grande (lag, teleport, empuje) no atraviese paredes por tunneling.
 * Devuelve la posición final (nunca dentro de un sólido).
 */
const SUBPASO_MAX = 0.25;

export function moverAABB(
  mundo: MundoColision,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radio: number = RADIO_PJ,
): { x: number; y: number } {
  const pasos = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SUBPASO_MAX));
  const px = dx / pasos, py = dy / pasos;
  let bloqueadoX = px === 0, bloqueadoY = py === 0;
  for (let i = 0; i < pasos && (!bloqueadoX || !bloqueadoY); i++) {
    if (!bloqueadoX) {
      let nx = x + px;
      if (hayIntersecionSolida(mundo, nx, y, radio)) {
        // la cara del AABB queda en la frontera de la casilla que bloquea
        nx = px > 0 ? Math.floor(x + px + radio) - radio - EPS : Math.ceil(x + px - radio) + radio + EPS;
        if (hayIntersecionSolida(mundo, nx, y, radio)) nx = x; // esquina rara: quieto
        bloqueadoX = true;
      }
      x = nx;
    }
    if (!bloqueadoY) {
      let ny = y + py;
      if (hayIntersecionSolida(mundo, x, ny, radio)) {
        ny = py > 0 ? Math.floor(y + py + radio) - radio - EPS : Math.ceil(y + py - radio) + radio + EPS;
        if (hayIntersecionSolida(mundo, x, ny, radio)) ny = y;
        bloqueadoY = true;
      }
      y = ny;
    }
  }
  return { x, y };
}

/** El medio en el que está el centro del PJ (para nadar/bucear/velocidad). */
export function medioEn(mundo: MundoColision, x: number, y: number): number {
  return tipoEn(mundo, x, y);
}

/** Nivel de buceo mínimo permitido por el medio (0 = solo superficie). */
export function nivelMinimo(medio: number): number {
  if (medio === TIPO.AGUA_PROFUNDA) return -2;
  if (medio === TIPO.AGUA) return -1;
  return 0;
}

/**
 * Casilla de agua (TIPO.AGUA/AGUA_PROFUNDA) más cercana a (x,y) dentro de
 * `radio` casillas, o null — para pesca (docs/GDD_Pesca.md): ahí cae el
 * cebo y se ancla la boya. Escaneo de vecindad acotado (mismo criterio que
 * `recolectableCercano`), nunca el mapa entero.
 */
export function casillaAguaCercana(mundo: MundoColision, x: number, y: number, radio: number): { x: number; y: number } | null {
  const r = Math.ceil(radio);
  const cx = Math.floor(x), cy = Math.floor(y);
  let mejor: { x: number; y: number } | null = null;
  let mejorDist = radio;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const centroX = cx + dx + 0.5, centroY = cy + dy + 0.5;
      const dist = Math.hypot(centroX - x, centroY - y);
      if (dist > mejorDist) continue;
      const t = tipoEn(mundo, centroX, centroY);
      if (t === TIPO.AGUA || t === TIPO.AGUA_PROFUNDA) {
        mejor = { x: centroX, y: centroY };
        mejorDist = dist;
      }
    }
  }
  return mejor;
}

export interface CuerpoPJ {
  x: number;
  y: number;
}

/**
 * Separación suave PJ-PJ: los pares que se solapan se empujan a partes
 * iguales hasta dejar de solaparse (sin bloquear — dos PJ nunca se
 * atascan mutuamente en un pasillo). O(n²) sobre <= maxClients cuerpos,
 * barato de sobra a 30hz; el resultado se re-valida contra los sólidos.
 */
export function separarPJs(mundo: MundoColision, cuerpos: CuerpoPJ[], radio: number = RADIO_PJ): void {
  const diametro = radio * 2;
  for (let i = 0; i < cuerpos.length; i++) {
    for (let j = i + 1; j < cuerpos.length; j++) {
      const a = cuerpos[i], b = cuerpos[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= diametro || d === 0) continue;
      const empuje = (diametro - d) / 2;
      const ux = dx / d, uy = dy / d;
      const na = moverAABB(mundo, a.x, a.y, -ux * empuje, -uy * empuje, radio);
      const nb = moverAABB(mundo, b.x, b.y, ux * empuje, uy * empuje, radio);
      a.x = na.x; a.y = na.y;
      b.x = nb.x; b.y = nb.y;
    }
  }
}
