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
  /** Destino real del portal (asentamiento anidado, hub...) — presente desde
   * 2026-09-12 en los portales `tipo:"exterior"` que hornea
   * `baker/src/instanciasPOI.js` (docs/GDD_Sistema_Puertas.md, "puerta
   * física clicable"); opcional porque un mapa horneado ANTES de esa fecha
   * no lo trae. El cliente no necesita interpretarlo (el servidor ya sabe
   * a dónde lleva `portal:usar`) — solo sirve para decidir SI este portal
   * cuenta como "entrada a una instancia" clicable, junto con `puertaX/Y`. */
  destino?: { tipo: "region" | "hub"; mapaId?: string };
  /** Coordenadas CONTINUAS del arco/puerta física real (2026-09-12) — a
   * diferencia de `x,y` (la casilla de PORTAL, empujada fuera de la muralla
   * en un asentamiento), esto es el centro real de la estructura visible
   * que el jugador ve y sobre la que se pinta la etiqueta "Entrar <Nombre>".
   * Opcional: solo lo traen los portales `tipo:"exterior"` de un asentamiento
   * (aldea/ciudad/campamento); para "edificio"/"mazmorra" sueltos `x,y` YA
   * es la puerta real, así que no hace falta duplicarlo aquí. */
  puertaX?: number;
  puertaY?: number;
  /** Nombre legible del destino ("Aldea Agricola", "Capital Regional"...),
   * derivado del id de catálogo del POI por `baker/src/instanciasPOI.js`
   * (2026-09-12) — nunca traducido a mano, mismo criterio que el resto del
   * proyecto ("las listas crecen, el código no"). Solo presente si el mapa
   * se horneó con este campo; sin él, sin etiqueta clicable pero la tecla F
   * sigue funcionando igual. */
  nombreDestino?: string;
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

/** Farola/foco fijo del bake de ciudades (ciudades/src/index.js, capa "luces"). */
export interface LuzMapa {
  x: number;
  y: number;
  id: string;
  radio: number;
  color: string;
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
  luces?: LuzMapa[];
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
  // Opcional de verdad: los bakes "solo terreno" (mazmorras/src/generarArena.js
  // para arenas de combate, baker/src/generar_mapas_prueba_barcos.js para los
  // mapas de prueba 100% agua) nunca la escriben — bug real encontrado
  // verificando visualmente docs/GDD_Combate.md §9.6 (mar_01 crasheaba el
  // sector entero al faltar aquí, ver sectorVisual.ts::crearTerrenoSector).
  elevacion?: string;
  tamano: number;
  objetos: ObjetoBakeado[];
  pois?: unknown[];
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
