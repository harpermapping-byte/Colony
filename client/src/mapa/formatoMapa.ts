/**
 * Tipos y decodificación del formato de mapa bakeado — espejo EXACTO de lo
 * que escribe `baker/src/exportar.js` (la fuente de verdad del formato es el
 * bakeador; si el formato cambia allí, este archivo es el único del cliente
 * que hay que tocar).
 *
 * - `indice.json`: metadatos del mapa + `leyendaTerreno` (la lista de ids de
 *   terreno; el string de terreno de cada chunk codifica cada casilla como
 *   UN carácter base36 que es el índice en esta lista).
 * - `sector_XXX_YYY.json`: chunks del sector, cada uno con su string de
 *   terreno/elevación y sus objetos (vegetación/rocas/fauna) ya colocados
 *   por el bakeador con posición/variante/rotación/escala resueltas.
 */

/** Puerta/portón bakeado — espejo de server/src/mundo/mapaColision.ts
 * `Portal` (docs/GDD_Sistema_Puertas.md). */
export interface PortalMapa {
  tipo: "exterior" | "interior";
  x: number;
  y: number;
  edificio?: string;
  tipoEdificioId?: string;
}

/** Módulo vectorial de la muralla de un mapa de ciudad (ciudades/src/generar.js
 * `modulosMuralla`) — recto/torre/puerta con material (piedra/empalizada).
 * El terreno ya extruye la muralla casilla a casilla (sectorVisual.ts); este
 * dato solo hace falta para diferenciar torres y puertas de un tramo recto. */
export interface ModuloMuralla {
  tipo: "recto" | "torre" | "puerta";
  x: number;
  y: number;
  rot: number;
  material: string;
}

export interface IndiceMapa {
  version: number;
  nombre: string;
  semilla: string;
  anchoChunks: number;
  altoChunks: number;
  tamanoChunk: number;
  tamanoSectorChunks: number;
  leyendaTerreno: string[];
  ciudad?: { x: number; y: number };
  portales?: PortalMapa[];
  muralla?: { poligono: [number, number][]; modulos: ModuloMuralla[] };
}

/** Objeto colocado por el bakeador dentro de un chunk (claves cortas del export). */
export interface ObjetoBakeado {
  i: string; // id de catálogo (especie/roca/animal/tipoEdificio)
  t: "v" | "r" | "a" | "m" | "e"; // vegetacion | rocas | animales | deco urbana | edificio (ciudades)
  va: number; // índice de variante (0-based)
  ro: number; // rotación en grados
  es: number; // escala
  x: number; // casilla local del chunk
  y: number;
  w?: number; // solo t:"e" — ancho real de la huella en casillas (con el jitter de ciudades/)
  h?: number; // solo t:"e" — largo real de la huella en casillas
  dx?: number; // solo t:"e" — parte fraccionaria [0,1) del centro real (x,y son la casilla entera)
  dy?: number;
}

export interface ChunkBakeado {
  terreno: string; // tamano*tamano caracteres base36 → índice en leyendaTerreno
  elevacion: string;
  tamano: number;
  objetos: ObjetoBakeado[];
  pois: unknown[];
}

export interface SectorBakeado {
  sectorX: number;
  sectorY: number;
  chunks: Record<string, ChunkBakeado>; // clave "cx_cy" (coordenada GLOBAL de chunk)
}

/** Id de terreno de la casilla (x,y) local del chunk, decodificando el string base36. */
export function terrenoEn(chunk: ChunkBakeado, leyenda: string[], x: number, y: number): string {
  const c = chunk.terreno[y * chunk.tamano + x];
  return leyenda[parseInt(c, 36)] ?? leyenda[0];
}
