/**
 * Consulta visual sobre los catálogos de datos que YA existen — colores
 * (`colorDebug`) y dimensiones aproximadas de placeholder por id de
 * catálogo. NO es un catálogo nuevo: importa los JSON reales del bakeador
 * (`baker/catalogo/*.json`) al bundle, así el cliente usa exactamente los
 * mismos colores de referencia que el visor del bakeador y el editor de
 * interiores, sin duplicar ninguna tabla a mano.
 *
 * Las dimensiones de placeholder son heurísticas mínimas por tipo (los
 * catálogos de exteriores no declaran altura — el `.glb` real de cada pieza
 * traerá la suya de serie y esta heurística deja de aplicarle).
 */
import terrenosJson from "../../../baker/catalogo/terrenos.json";
import vegetacionJson from "../../../baker/catalogo/vegetacion.json";
import rocasJson from "../../../baker/catalogo/rocas.json";
import animalesJson from "../../../baker/catalogo/animales.json";

interface EntradaCatalogo {
  colorDebug?: string;
  categoriaRecurso?: string;
  [k: string]: unknown;
}

function comoTabla(json: unknown): Record<string, EntradaCatalogo> {
  const tabla: Record<string, EntradaCatalogo> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (k.startsWith("_") || typeof v !== "object" || v === null) continue;
    tabla[k] = v as EntradaCatalogo;
  }
  return tabla;
}

const terrenos = comoTabla(terrenosJson);
const vegetacion = comoTabla(vegetacionJson);
const rocas = comoTabla(rocasJson);
const animales = comoTabla(animalesJson);

const COLOR_DESCONOCIDO = "#b05ad8"; // magenta apagado: canta a la vista = id sin entrada de catálogo

export function colorTerreno(id: string): string {
  return terrenos[id]?.colorDebug || COLOR_DESCONOCIDO;
}

const TABLA_POR_TIPO: Record<"v" | "r" | "a", Record<string, EntradaCatalogo>> = {
  v: vegetacion,
  r: rocas,
  a: animales,
};

export function colorObjeto(tipo: "v" | "r" | "a", id: string): string {
  return TABLA_POR_TIPO[tipo][id]?.colorDebug || COLOR_DESCONOCIDO;
}

export interface DimensionesPlaceholder {
  ancho: number;
  alto: number;
  profundo: number;
}

/**
 * Tamaño de placeholder por tipo+id. Vegetación: los árboles (madera_*) son
 * altos y estrechos; el resto de flora es matorral bajo. Rocas: bloque bajo
 * y ancho. Animales: caja media (marcador de spawn — la fauna viva es
 * mecánica futura, el bakeador solo deja dónde aparece).
 */
export function dimensionesObjeto(tipo: "v" | "r" | "a", id: string): DimensionesPlaceholder {
  if (tipo === "v") {
    const cat = vegetacion[id]?.categoriaRecurso || "";
    if (cat.startsWith("madera")) return { ancho: 0.55, alto: 2.3, profundo: 0.55 };
    return { ancho: 0.6, alto: 0.5, profundo: 0.6 };
  }
  if (tipo === "r") return { ancho: 0.8, alto: 0.5, profundo: 0.8 };
  return { ancho: 0.5, alto: 0.7, profundo: 0.5 };
}
