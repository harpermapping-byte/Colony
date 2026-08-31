/**
 * A* EN VIVO para el NPC transportista (docs/GDD_Produccion.md, pedido
 * 2026-08-29) — llamado UNA VEZ al firmar un contrato de transporte, nunca
 * en el tick (regla dura de agentes.ts: "nada de A* en vivo" se refiere a
 * A* REPETIDO por tick, no a A* en absoluto — mismo criterio ya aplicado a
 * "generar el interior de un edificio una vez al colocarse").
 *
 * `aEstrella` (ciudades/src/geometria.js) es agnóstica de la rejilla: solo
 * pide ancho/alto + una función de coste por casilla — mismo patrón
 * require()-en-runtime que ya usa server/src/construccion/parcelas.ts para
 * `rasterizarRectRotado` del mismo módulo.
 */

import * as path from "node:path";
import { MundoColision, TIPO } from "./colisiones";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const RUTA_GEOMETRIA_CIUDADES = path.join(RAIZ_REPO, "ciudades", "src", "geometria.js");

export interface Punto {
  x: number;
  y: number;
}

/**
 * Camino entre dos puntos sobre la rejilla de colisión EN VIVO de la room
 * (mundo/mapaColision.ts) — tierra transitable = coste 1, agua/sólido =
 * bloqueado. `null` si no hay camino (islas separadas por agua, por ejemplo).
 */
/**
 * Un punto de origen/destino REAL suele ser la propia casilla ocupada de una
 * construcción (colisión=true: el mueble/edificio endurece su huella) — si
 * se le pasa tal cual a `aEstrella`, esa casilla es SÓLIDA (coste Infinity),
 * el A* nunca la alcanza y acaba explorando el mapa VIVO entero (3200x3200,
 * "find-min" O(n) por iteración) antes de rendirse: un cuelgue práctico, no
 * un fallo. Encontrado 2026-08-31 depurando transporte→cofre. Igual que
 * `casillaPisableMasCercana` (mundo/mapaColision.ts, mundo/interiorColision.ts):
 * anillo creciente hasta la primera casilla no sólida, radio acotado porque
 * solo hace falta salir de la propia huella (edificios reales siempre tienen
 * tierra alrededor).
 */
function casillaTransitableCercana(mundo: MundoColision, x: number, y: number, radioMax = 12): Punto {
  if (mundo.casillas[y * mundo.ancho + x] !== TIPO.SOLIDO) return { x, y };
  for (let r = 1; r <= radioMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // solo el anillo
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mundo.ancho || ny >= mundo.alto) continue;
        if (mundo.casillas[ny * mundo.ancho + nx] !== TIPO.SOLIDO) return { x: nx, y: ny };
      }
    }
  }
  return { x, y }; // rodeada de sólido a 12 casillas: no debería pasar en un edificio real
}

export function calcularCaminoRuntime(mundo: MundoColision, origen: Punto, destino: Punto): Punto[] | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { aEstrella } = require(RUTA_GEOMETRIA_CIUDADES) as {
    aEstrella: (
      ancho: number, alto: number, inicio: Punto, fin: Punto,
      costeDe: (x: number, y: number) => number,
    ) => Punto[] | null;
  };

  const costeDe = (x: number, y: number): number => {
    const idx = y * mundo.ancho + x;
    if (mundo.casillas[idx] === TIPO.SOLIDO) return Infinity;
    // agua transitable a pie (nadando) cuesta más que tierra — el
    // transportista PREFIERE rodear, no bloqueado del todo (mismo espíritu
    // que el coste de pendiente del A* offline de baker/, "rodea lo caro").
    if (mundo.casillas[idx] === TIPO.AGUA || mundo.casillas[idx] === TIPO.AGUA_PROFUNDA) return 6;
    return 1 / (mundo.velocidad[idx] || 1); // camino/adoquín (modVelocidad>1) sale más barato: lo prefiere
  };

  const ox = Math.floor(origen.x), oy = Math.floor(origen.y);
  const dx = Math.floor(destino.x), dy = Math.floor(destino.y);
  if (ox < 0 || oy < 0 || ox >= mundo.ancho || oy >= mundo.alto) return null;
  if (dx < 0 || dy < 0 || dx >= mundo.ancho || dy >= mundo.alto) return null;

  const inicio = casillaTransitableCercana(mundo, ox, oy);
  const fin = casillaTransitableCercana(mundo, dx, dy);

  const camino = aEstrella(mundo.ancho, mundo.alto, inicio, fin, costeDe);
  if (!camino) return null;
  // reintroduce las puntas originales (la propia huella del edificio) si el
  // snap las movió, para que el paseo visual del NPC siga naciendo/muriendo
  // exactamente en la construcción, no en la casilla vecina.
  if (inicio.x !== ox || inicio.y !== oy) camino.unshift({ x: ox, y: oy });
  if (fin.x !== dx || fin.y !== dy) camino.push({ x: dx, y: dy });
  return camino;
}
