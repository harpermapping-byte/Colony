/**
 * Catálogo CONSTRUIBLE fusionado (GDD_Construccion §3): el menú de
 * construcción se monta LEYENDO los catálogos de interiores, nunca listas
 * propias — cuando crezcan las listas (regla 7 del CLAUDE.md), el
 * constructor ofrece lo nuevo solo, sin tocar este código.
 *
 * Fuentes (require con ruta absoluta: el servidor ya lee catálogos hermanos):
 * - `interiores/catalogo/elementos.json` → muebles, EXCLUYENDO la capa
 *   "estructural" y las entradas con specialModifier de ENEMIGO (un jugador
 *   no coloca bichos; los especiales de nobleza/tesoro sí son muebles).
 * - `interiores/catalogo/exteriores.json` → estructuras exteriores, entero.
 * - `interiores/catalogo/tipos_edificio.json` → solo `construible: true`
 *   (con `huellaExterior`); al colocarse generan interior (§5).
 *
 * Regla de colisión (§3): todo ocupa como SÓLIDO salvo `colision: false`
 * explícito (exteriores) o anchor FLOOR_DECAL (alfombras/círculos rituales,
 * pisables por diseño — es el valor real que usa elementos.json).
 */

import * as path from "node:path";
import { DatosProduccion } from "./produccion";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const CARPETA_CATALOGO = path.join(RAIZ_REPO, "interiores", "catalogo");

export type CategoriaConstruible = "mueble" | "exterior" | "edificio";

export interface EntradaConstruible {
  id: string;
  categoria: CategoriaConstruible;
  /** [ancho, largo] en casillas, SIN rotar (rot impar la intercambia) */
  huella: [number, number];
  /** true = sus casillas se endurecen en la rejilla al colocarse */
  colision: boolean;
  variantes: number;
  /** Producción pasiva (docs/GDD_Produccion.md) — presente en colmena/aserradero. */
  produccion?: DatosProduccion;
  /** Solo tipos_edificio.json: colocable SOLO por el jarl vía plantilla:colocar (radio a la capital), NUNCA por "construir" normal — mecanismo paralelo a `construible`, no una variante suya. */
  plantillaJarl?: boolean;
}

interface EntradaElemento {
  capa?: string;
  specialModifier?: unknown;
  anchorType?: string;
  huella?: [number, number];
  variantes?: number;
}

interface EntradaExterior {
  huella?: [number, number];
  colision?: boolean;
  variantes?: number;
  produccion?: DatosProduccion;
}

interface EntradaTipoEdificio {
  construible?: boolean;
  huellaExterior?: [number, number];
  variantes?: number;
  produccion?: DatosProduccion;
  plantillaJarl?: boolean;
}

function leerCatalogo<T>(nombre: string): Record<string, T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(CARPETA_CATALOGO, nombre)) as Record<string, T>;
}

/** Fusiona los tres catálogos en un Map id → entrada construible. */
export function cargarCatalogoConstruible(): Map<string, EntradaConstruible> {
  const resultado = new Map<string, EntradaConstruible>();

  const elementos = leerCatalogo<EntradaElemento>("elementos.json");
  for (const [id, d] of Object.entries(elementos)) {
    if (id.startsWith("_")) continue; // notas del catálogo
    // el GDD §3 solo veta los specialModifier de enemigo (hoy
    // "ESPECIAL_ENEMIGO_SALVAJE"); nobleza/tesoro son muebles legítimos
    if (d.capa === "estructural") continue;
    if (typeof d.specialModifier === "string" && d.specialModifier.includes("ENEMIGO")) continue;
    if (!d.huella) continue; // sin huella no hay nada que colocar en la rejilla
    resultado.set(id, {
      id,
      categoria: "mueble",
      huella: d.huella,
      // FLOOR_DECAL = alfombra/marca en el suelo: pisable, no endurece
      colision: d.anchorType !== "FLOOR_DECAL",
      variantes: d.variantes ?? 1,
    });
  }

  const exteriores = leerCatalogo<EntradaExterior>("exteriores.json");
  for (const [id, d] of Object.entries(exteriores)) {
    if (id.startsWith("_")) continue;
    if (!d.huella) continue;
    resultado.set(id, {
      id,
      categoria: "exterior",
      huella: d.huella,
      colision: d.colision === true, // su campo manda; sin campo = decorativo
      variantes: d.variantes ?? 1,
      produccion: d.produccion,
    });
  }

  const tiposEdificio = leerCatalogo<EntradaTipoEdificio>("tipos_edificio.json");
  for (const [id, d] of Object.entries(tiposEdificio)) {
    if (id.startsWith("_")) continue;
    // plantillaJarl:true (aserradero) es DELIBERADAMENTE excluido de aquí —
    // solo colocable vía "plantilla:colocar" (cargarCatalogoPlantillas más
    // abajo), NUNCA por el "construir" normal de parcela — dos mecanismos
    // paralelos, no una variante del mismo flag (docs/GDD_Produccion.md).
    if (d.construible !== true || !d.huellaExterior) continue;
    resultado.set(id, {
      id,
      categoria: "edificio",
      huella: d.huellaExterior,
      colision: true, // un edificio siempre bloquea su solar (se entra por portal, futuro)
      variantes: d.variantes ?? 1,
    });
  }

  return resultado;
}

/**
 * Plantillas del jarl (docs/GDD_Produccion.md, pedido 2026-08-29): tipos de
 * edificio con `plantillaJarl: true` (aserradero) — colocable SOLO por el
 * jarl dentro de un radio a la capital, nunca por el "construir" normal de
 * parcela (por eso viven en un Map SEPARADO de cargarCatalogoConstruible,
 * no mezclado — evita que un jugador cualquiera pueda "construir" uno).
 */
export function cargarCatalogoPlantillas(): Map<string, EntradaConstruible> {
  const resultado = new Map<string, EntradaConstruible>();
  const tiposEdificio = leerCatalogo<EntradaTipoEdificio>("tipos_edificio.json");
  for (const [id, d] of Object.entries(tiposEdificio)) {
    if (id.startsWith("_")) continue;
    if (d.plantillaJarl !== true || !d.huellaExterior) continue;
    resultado.set(id, {
      id,
      categoria: "edificio",
      huella: d.huellaExterior,
      colision: true,
      variantes: d.variantes ?? 1,
      produccion: d.produccion,
      plantillaJarl: true,
    });
  }
  return resultado;
}
