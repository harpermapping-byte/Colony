/**
 * Resolución de modelos 3D por convención de nombre de archivo — a propósito
 * SIN catálogo nuevo. Los catálogos de datos (`baker/catalogo/*.json`,
 * `interiores/catalogo/elementos.json`) ya traen `variantes`/`variantesNombradas`
 * y `colorDebug` para sus placeholders 2D; esta capa solo cambia la EXTENSIÓN
 * de archivo que se busca (.glb en vez de .png) y reutiliza exactamente el
 * mismo árbol de carpetas que documenta `assets/README.md`:
 *
 *   assets/<categoria>/<id>_<NN>.glb        (variante numerada, NN con cero a la izquierda: 01, 02...)
 *   assets/<categoria>/<variantId>.glb      (variante con nombre propio, ej. variantesNombradas)
 *
 * Si el .glb todavía no existe (lo normal mientras se va generando con el
 * taller de vóxeles), se cae a un cubo de color con `colorDebug` — nunca a
 * los PNG antiguos, que quedan como referencia 2D obsoleta hasta que se
 * generen sus equivalentes en 3D.
 */

export type CategoriaAsset = "vegetacion" | "animales" | "rocas" | "interiores" | "personajes" | "edificios";

// "terrenos"/"materiales": texturas 2D tileables (docs/GDD_Bakeador_Texturas.md),
// no modelos — mismo árbol assets/<categoria>/<id>_<NN>.png, pero resueltas
// con resolverUrlTextura (abajo), no resolverUrlModelo (busca .glb).
export type CategoriaTextura = "terrenos" | "materiales";

export interface VarianteNumerada {
  tipo: "numerada";
  indice: number; // 0-based; el archivo usa 1-based con cero a la izquierda
}

export interface VarianteNombrada {
  tipo: "nombrada";
  id: string;
}

export type Variante = VarianteNumerada | VarianteNombrada;

function nombreArchivo(id: string, variante: Variante): string {
  if (variante.tipo === "nombrada") return `${variante.id}.glb`;
  const numero = String(variante.indice + 1).padStart(2, "0");
  return `${id}_${numero}.glb`;
}

export function resolverUrlModelo(categoria: CategoriaAsset, id: string, variante: Variante): string {
  return `/assets/${categoria}/${nombreArchivo(id, variante)}`;
}

function nombreArchivoPNG(id: string, variante: Variante): string {
  if (variante.tipo === "nombrada") return `${variante.id}.png`;
  const numero = String(variante.indice + 1).padStart(2, "0");
  return `${id}_${numero}.png`;
}

export function resolverUrlTextura(categoria: CategoriaTextura, id: string, variante: Variante): string {
  return `/assets/${categoria}/${nombreArchivoPNG(id, variante)}`;
}
