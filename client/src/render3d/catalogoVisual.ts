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
import decoracionJson from "../../../ciudades/catalogo/decoracion.json";
import tiposEdificioJson from "../../../interiores/catalogo/tipos_edificio.json";
import huellasJson from "../../../ciudades/catalogo/huellas.json";

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
// deco urbana de los mapas de ciudad (t:"m") — catálogo propio del bakeador
// de ciudades con colorDebug/dimensiones/colision/luz por pieza
const decoracion = comoTabla(decoracionJson);
// edificios de ciudad (t:"e"): el catálogo no trae colorDebug propio (es de
// interiores/, pensado para el editor 2D) — el placeholder de fachada usa el
// mismo color por riqueza que ya pinta ciudades/src/index.js en su overview.png
const tiposEdificio = comoTabla(tiposEdificioJson);
const COLOR_RIQUEZA: Record<string, string> = { humilde: "#8a6a4a", modesta: "#a3762e", noble: "#7a3e8a" };

const COLOR_DESCONOCIDO = "#b05ad8"; // magenta apagado: canta a la vista = id sin entrada de catálogo

export function colorTerreno(id: string): string {
  return terrenos[id]?.colorDebug || COLOR_DESCONOCIDO;
}

const TABLA_POR_TIPO: Record<"v" | "r" | "a" | "m", Record<string, EntradaCatalogo>> = {
  v: vegetacion,
  r: rocas,
  a: animales,
  m: decoracion,
};

export function colorObjeto(tipo: "v" | "r" | "a" | "m" | "e", id: string): string {
  if (tipo === "e") {
    const riqueza = tiposEdificio[id]?.riqueza as string | undefined;
    return (riqueza && COLOR_RIQUEZA[riqueza]) || COLOR_DESCONOCIDO;
  }
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
 * mecánica futura, el bakeador solo deja dónde aparece). Edificios ("e"):
 * la huella del CATÁLOGO (huellas.json) — el ancho×largo REAL de la
 * instancia (con el jitter de ciudades/) llega en `obj.w`/`obj.h` y
 * `crearPropsSector` lo usa en vez de esto cuando está disponible; esta
 * función solo cubre el caso sin datos de instancia (fallback defensivo).
 */
export function dimensionesObjeto(tipo: "v" | "r" | "a" | "m" | "e", id: string): DimensionesPlaceholder {
  if (tipo === "e") {
    const huellas = huellasJson as unknown as { porTipo: Record<string, [number, number]>; porRiqueza: Record<string, [number, number]> };
    const info = tiposEdificio[id];
    const [ancho, largo] = huellas.porTipo[id] || huellas.porRiqueza[(info?.riqueza as string) || "humilde"] || [7, 6];
    const plantasAltas = (info?.rangoPlantasAltas as [number, number] | undefined)?.[0] ?? 0;
    return { ancho, alto: 2.7 * (1 + plantasAltas), profundo: largo };
  }
  if (tipo === "m") {
    // la deco urbana declara sus dimensiones reales en su catálogo
    const dims = decoracion[id]?.dimensiones as [number, number, number] | undefined;
    if (dims) return { ancho: dims[0], alto: dims[1], profundo: dims[2] };
    return { ancho: 0.7, alto: 0.7, profundo: 0.7 };
  }
  if (tipo === "v") {
    const cat = vegetacion[id]?.categoriaRecurso || "";
    if (cat.startsWith("madera")) return { ancho: 0.55, alto: 2.3, profundo: 0.55 };
    return { ancho: 0.6, alto: 0.5, profundo: 0.6 };
  }
  if (tipo === "r") return { ancho: 0.8, alto: 0.5, profundo: 0.8 };
  return { ancho: 0.5, alto: 0.7, profundo: 0.5 };
}
