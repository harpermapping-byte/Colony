/**
 * Patrón de suelo horneado por casilla (pedido streamer 2026-09-11: "¿creamos
 * texturas de bioma para el suelo?" — tras comparar con
 * `client/test/texturaSueloComparacion.ts` las 3 técnicas posibles, eligió
 * la "B": mismo sistema de SIEMPRE (un único canvas/textura por sector,
 * `NearestFilter`, sin UV repetido por GPU) pero con más resolución por
 * casilla y un patrón de motas/detalle en vez de un color sólido plano —
 * "la prueba B es lo que hay que hacer, a lo mejor algo más de detalle con
 * más casillas".
 *
 * Escrito como función PURA sobre un `Uint8ClampedArray` (CERO llamadas de
 * canvas 2D, ni un solo `fillRect`) para poder testearla en Node y, sobre
 * todo, porque `sectorVisual.ts` ya demostró que miles de llamadas de
 * canvas por sector son un tirón real (ver la cabecera de
 * `crearTerrenoSector`) — aquí el volumen de píxeles es mayor todavía (más
 * resolución por casilla), así que ni se plantea usar canvas para generarlo.
 *
 * Los parches se generan una vez por (familia, color base, variante, tamaño)
 * y se cachean a nivel de MÓDULO (no por sector): el mismo puñado de ids de
 * terreno se repite en TODOS los sectores del mapa, así que tras el primer
 * sector materializado, cualquier sector nuevo solo copia bytes ya
 * calculados — nunca vuelve a generar el patrón.
 */

export type FamiliaPatronTerreno = "cesped" | "tierra" | "camino" | "roca" | "arena" | "nieve";

// Nº de variantes por (familia, color) — mismo criterio "unas pocas
// variantes elegidas por semilla" que ya usa el resto del proyecto (fauna,
// edificios...): suficiente para que el patrón no se note repetido casilla
// a casilla, sin disparar el número de parches a cachear.
export const NUM_VARIANTES_PATRON = 4;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Semilla determinista por casilla del MUNDO (no del sector: así la
 * variante de una casilla no cambia si se recalcula el sector, ni salta al
 * cruzar de sector). SIEMPRE no-negativo (`>>> 0` final): un `^` de JS
 * devuelve un int32 CON signo — sin este último `>>> 0`, `% NUM_VARIANTES`
 * en el llamador podía dar un índice negativo (`array[-2]` es `undefined`
 * en JS, no un error de rango) y reventaba `copiarParcheEnBuffer` al
 * intentar copiar un parche inexistente — bug real encontrado con el
 * benchmark de rendimiento contra un sector real antes de integrar esto en
 * producción.
 */
export function hashCasilla(gx: number, gy: number, sal: number): number {
  return (((gx * 374761393 + gy * 668265263 + sal * 2246822519) >>> 0) ^ 0x9e3779b9) >>> 0;
}

function mezclar(r: number, g: number, b: number, factor: number, hacia255: boolean): [number, number, number] {
  const destino = hacia255 ? 255 : 0;
  return [r + (destino - r) * factor, g + (destino - g) * factor, b + (destino - b) * factor];
}

/** Genera un parche `tam`x`tam` (RGBA, sin transparencia) NUEVO — usar `obtenerParcheTerreno` en el camino caliente, esto es la generación pura sin caché. */
export function generarParcheTerreno(
  familia: FamiliaPatronTerreno,
  colorBase: readonly [number, number, number],
  tam: number,
  semilla: number,
): Uint8ClampedArray {
  const datos = new Uint8ClampedArray(tam * tam * 4);
  const rng = mulberry32(semilla);
  const [br, bg, bb] = colorBase;
  const poner = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= tam || y >= tam) return;
    const i = (y * tam + x) * 4;
    datos[i] = r; datos[i + 1] = g; datos[i + 2] = b; datos[i + 3] = 255;
  };

  // base moteada (mismo recurso barato en las 6 familias, la diferencia
  // real está en los detalles que se añaden encima).
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const variacion = (rng() - 0.5) * 0.12;
      const [r, g, b] = mezclar(br, bg, bb, Math.abs(variacion), variacion >= 0);
      poner(x, y, r, g, b);
    }
  }

  if (familia === "cesped") {
    // briznas: trazos verticales cortos más claros
    const brizas = Math.max(2, Math.round(tam * 0.6));
    for (let i = 0; i < brizas; i++) {
      const bx = Math.floor(rng() * tam);
      const by = Math.floor(rng() * tam);
      const largo = 1 + Math.floor(rng() * Math.max(1, tam * 0.25));
      const [r, g, b] = mezclar(br, bg, bb, 0.22, true);
      for (let k = 0; k < largo; k++) poner(bx, by + k, r, g, b);
    }
    // florecillas aisladas, poco frecuentes
    const flores = Math.round(tam * tam * 0.01);
    const coloresFlor: [number, number, number][] = [[255, 255, 255], [232, 200, 66], [212, 66, 66]];
    for (let i = 0; i < flores; i++) {
      const [r, g, b] = coloresFlor[Math.floor(rng() * coloresFlor.length)];
      poner(Math.floor(rng() * tam), Math.floor(rng() * tam), r, g, b);
    }
  } else if ((familia === "tierra" || familia === "camino") && tam >= 4) {
    // guijarros: blobs de 2x2 más oscuros — con PX_POR_TILE_SUELO=2 (el
    // valor real de producción, ver sectorVisual.ts) un blob 2x2 cubriría
    // la casilla ENTERA (siempre en la misma esquina, `rng()*max(1,tam-1)`
    // con tam=2 da SIEMPRE 0) — un cuadriculado binario en vez de guijarros
    // sueltos, confirmado con una captura real del canvas de producción
    // antes de este guard (`client/test/patronSueloAisladoCaptura.mjs`).
    // Por debajo de este umbral se queda solo el moteado base de arriba.
    const guijarros = Math.max(1, Math.round(tam * tam * 0.02));
    for (let i = 0; i < guijarros; i++) {
      const gx = Math.floor(rng() * Math.max(1, tam - 1));
      const gy = Math.floor(rng() * Math.max(1, tam - 1));
      const [r, g, b] = mezclar(br, bg, bb, 0.3 + rng() * 0.2, false);
      poner(gx, gy, r, g, b); poner(gx + 1, gy, r, g, b);
      poner(gx, gy + 1, r, g, b); poner(gx + 1, gy + 1, r, g, b);
    }
  } else if (familia === "roca" && tam >= 4) {
    // mampostería: rejilla de juntas más oscuras, offset a hiladas alternas
    // — mismo motivo que "tierra"/"camino" arriba, una junta a tam<4 tapa
    // la casilla entera en vez de leerse como líneas de sillería.
    const junta = Math.max(1, Math.round(tam / 8));
    const [r, g, b] = mezclar(br, bg, bb, 0.35, false);
    for (let hilada = 0; hilada * (tam / 4) < tam; hilada++) {
      const y0 = Math.round(hilada * (tam / 4));
      for (let x = 0; x < tam; x++) for (let dy = 0; dy < junta; dy++) poner(x, y0 + dy, r, g, b);
      const offsetX = (hilada % 2) * Math.round(tam / 4);
      for (let vx = offsetX; vx < tam; vx += Math.round(tam / 2)) {
        for (let dx = 0; dx < junta; dx++) for (let dy = 0; dy < Math.round(tam / 4); dy++) poner(vx + dx, y0 + dy, r, g, b);
      }
    }
  } else if (familia === "arena") {
    // motas finas dispersas, más claras u oscuras que la base — grano de arena
    const motas = Math.max(1, Math.round(tam * tam * 0.05));
    for (let i = 0; i < motas; i++) {
      const factor = rng() * 0.25;
      const [r, g, b] = mezclar(br, bg, bb, factor, rng() > 0.5);
      poner(Math.floor(rng() * tam), Math.floor(rng() * tam), r, g, b);
    }
  } else if (familia === "nieve") {
    // destellos casi blancos dispersos, sin briznas ni flores
    const destellos = Math.max(1, Math.round(tam * tam * 0.04));
    for (let i = 0; i < destellos; i++) {
      const [r, g, b] = mezclar(br, bg, bb, 0.4 + rng() * 0.3, true);
      poner(Math.floor(rng() * tam), Math.floor(rng() * tam), r, g, b);
    }
  }
  return datos;
}

const cacheParchesTerreno = new Map<string, Uint8ClampedArray>();

/** Igual que `generarParcheTerreno` pero cacheado a nivel de módulo por (familia, color, tam, variante). NO es el camino caliente de `crearTerrenoSector` (construir la clave de texto por CASILLA sería tan caro como el propio parche) — ver `obtenerParchesTerreno`, pensada para resolverse una única vez por id de terreno presente en el sector. */
export function obtenerParcheTerreno(
  familia: FamiliaPatronTerreno,
  colorBase: readonly [number, number, number],
  tam: number,
  variante: number,
): Uint8ClampedArray {
  const clave = `${familia}:${colorBase[0]},${colorBase[1]},${colorBase[2]}:${tam}:${variante}`;
  let parche = cacheParchesTerreno.get(clave);
  if (!parche) {
    parche = generarParcheTerreno(familia, colorBase, tam, hashCasilla(variante, 0, 7));
    cacheParchesTerreno.set(clave, parche);
  }
  return parche;
}

/**
 * Las `NUM_VARIANTES_PATRON` variantes de un (familia, color, tam) de una
 * vez, cacheadas a nivel de módulo — pensada para resolverse UNA VEZ POR ID
 * DE TERRENO (hay unas pocas decenas en todo el catálogo, ver
 * `familiaPatronTerreno`), nunca por casilla: construir una clave de texto
 * y consultar un `Map` 100.000+ veces por sector (una vez por casilla) medía
 * más caro que el propio parche (comprobado con un benchmark real contra
 * `assets/mapas/principal/`, ver `docs/GDD_Motor_3D_Props.md`) — el
 * llamador cachea el resultado por id con una clave barata (el propio id,
 * ya un string corto reutilizado) y solo indexa el array por casilla.
 */
const cacheParchesTerrenoPorId = new Map<string, Uint8ClampedArray[]>();
export function obtenerParchesTerreno(
  familia: FamiliaPatronTerreno,
  colorBase: readonly [number, number, number],
  tam: number,
): Uint8ClampedArray[] {
  const clave = `${familia}:${colorBase[0]},${colorBase[1]},${colorBase[2]}:${tam}`;
  let parches = cacheParchesTerrenoPorId.get(clave);
  if (!parches) {
    parches = [];
    for (let v = 0; v < NUM_VARIANTES_PATRON; v++) {
      parches.push(generarParcheTerreno(familia, colorBase, tam, hashCasilla(v, 0, 7)));
    }
    cacheParchesTerrenoPorId.set(clave, parches);
  }
  return parches;
}

const cacheParchesSolidos = new Map<string, Uint8ClampedArray>();

/** Parche `tam`x`tam` de un único color RGBA plano — para lo que a propósito NO lleva patrón todavía (agua/hielo, ver `familiaPatronTerreno`), cacheado igual que los parches con patrón. */
export function obtenerParcheSolido(r: number, g: number, b: number, a: number, tam: number): Uint8ClampedArray {
  const clave = `${r},${g},${b},${a}:${tam}`;
  let parche = cacheParchesSolidos.get(clave);
  if (!parche) {
    parche = new Uint8ClampedArray(tam * tam * 4);
    for (let i = 0; i < tam * tam; i++) {
      const j = i * 4;
      parche[j] = r; parche[j + 1] = g; parche[j + 2] = b; parche[j + 3] = a;
    }
    cacheParchesSolidos.set(clave, parche);
  }
  return parche;
}

/** Copia un parche `tam`x`tam` dentro de un buffer RGBA más grande, en la casilla (tileX,tileY) — una llamada a `.set()` por fila (memcpy nativo), nunca un bucle de píxel a píxel. */
export function copiarParcheEnBuffer(
  destino: Uint8ClampedArray,
  anchoDestinoPx: number,
  tileX: number,
  tileY: number,
  parche: Uint8ClampedArray,
  tam: number,
): void {
  const baseX = tileX * tam;
  const baseY = tileY * tam;
  for (let y = 0; y < tam; y++) {
    const offDestino = ((baseY + y) * anchoDestinoPx + baseX) * 4;
    const offParche = y * tam * 4;
    destino.set(parche.subarray(offParche, offParche + tam * 4), offDestino);
  }
}
