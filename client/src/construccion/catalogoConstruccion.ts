/**
 * Lista de lo CONSTRUIBLE por el jugador — montada LEYENDO los catálogos
 * reales de interiores (regla del GDD_Construccion §3: el menú nunca tiene
 * listas propias; cuando los catálogos crezcan, esto crece solo). Mismo
 * mecanismo de import-al-bundle que `render3d/catalogoVisual.ts`.
 *
 * Filtros del contrato (§3):
 * - Muebles (`elementos.json`): todo lo que NO sea `capa: "estructural"` ni
 *   `specialModifier` de enemigo (los tesoros/nobleza sí se pueden colocar).
 * - Exteriores (`exteriores.json`): todo el catálogo.
 * - Edificios (`tipos_edificio.json`): solo `construible: true` con
 *   `huellaExterior` — al colocarse el SERVIDOR genera su interior (§5).
 *
 * Colisión (§3): lo construido es sólido salvo `colision: false` explícito
 * o anchor `FLOOR_DECAL` (alfombras/bancales pisables).
 */
import elementosJson from "../../../interiores/catalogo/elementos.json";
import exterioresJson from "../../../interiores/catalogo/exteriores.json";
import tiposEdificioJson from "../../../interiores/catalogo/tipos_edificio.json";

export type CategoriaConstruible = "mueble" | "exterior" | "edificio";

export interface Construible {
  id: string;
  categoria: CategoriaConstruible;
  huella: [number, number]; // [ancho, largo] SIN rotar, en casillas
  colorDebug: string;
  colision: boolean;
  /** Proyecto especial del jarl (docs/Backlog_Mecanicas_Futuras.md): el
   * SERVIDOR ya rechaza colocarlo si no eres el jarl o no es parcela
   * especial (mismo motivo que cualquier otra colocación inválida, mostrado
   * en el panel de estado) — el menú todavía NO lo oculta a un jugador
   * normal (pendiente de que el cliente sepa si el jugador local es jarl,
   * ver docs/GDD_Construccion.md §1bis). */
  proyectoJarl?: boolean;
  /** Plantilla del jarl (docs/GDD_Produccion.md) — presente SOLO en `PLANTILLAS_JARL`, NUNCA en `CONSTRUIBLES` (aserradero y compañía se excluyen del menú normal, ver `construirLista`). */
  plantillaJarl?: boolean;
  /** Agricultura (docs/GDD_Agricultura.md) — presente en bancal_cultivo/maceta_*: se le puede plantar una semilla (mensajes `cultivo:*`). */
  plantable?: boolean;
  /** Cocina (docs/GDD_Cocina.md) — presente en hoguera_campamento/cuenco_cocina/cazuela_cocina/olla_cocina. */
  cocina?: { esVasija: boolean; capacidad?: number; vasija?: string; hierveAgua?: boolean };
  /** Nombre bonito de catálogo (items/catalogo/nombreBonito.js) — para etiquetar menús/UI sin ir a buscarlo aparte. */
  nombre?: string;
  /** Instrumentos musicales interactivos (docs/GDD_Instrumentos.md) — tipo corto ("tambor"/"laud"/"flauta"/"campana") que game.ts usa para elegir animación/sonido; presente SOLO en las 4 entradas de elementos.json con `instrumento`. */
  instrumento?: string;
  /** Producción pasiva (docs/GDD_Produccion.md) — `requiereTrabajador` es lo único que necesita el menú de interacción (contratar/despedir trabajador, poner a trabajar al compañero) para decidir si ofrece esas opciones. */
  produccion?: { requiereTrabajador?: boolean };
  /** Cama (docs/GDD_Personaje.md §3.6) — el menú de interacción ofrece "Tumbarse" (dormir:iniciar). */
  esCama?: boolean;
  /** Sentarse (pedido 2026-08-31) — el menú de interacción ofrece "Sentarse" (sentar:iniciar). */
  esSilla?: boolean;
  /** Cofre/arcón (docs/GDD_Produccion.md §3ter) — el menú de interacción ofrece "Abrir" (cofre:consultar). */
  esContenedor?: boolean;
}

// Alturas placeholder por categoría (la caja `colorDebug` hasta que exista
// el `.glb` real). El 2.1 de edificio es el mismo de los solares urbanos
// extruidos del bakeador de ciudades (sectorVisual.ts) — coherencia visual.
export const ALTURA_CATEGORIA: Record<CategoriaConstruible, number> = {
  mueble: 0.8,
  exterior: 1.2,
  edificio: 2.1,
};

interface EntradaBruta {
  capa?: string;
  specialModifier?: string;
  huella?: [number, number];
  huellaExterior?: [number, number];
  colorDebug?: string;
  colision?: boolean;
  anchorType?: string;
  construible?: boolean;
  proyectoJarl?: boolean;
  plantillaJarl?: boolean;
  plantable?: { multiplicadorCosecha: number };
  cocina?: { esVasija: boolean; capacidad?: number; vasija?: string; hierveAgua?: boolean };
  nombre?: string;
  instrumento?: string;
  produccion?: { requiereTrabajador?: boolean };
  esCama?: boolean;
  esSilla?: boolean;
  esContenedor?: boolean;
  [k: string]: unknown;
}

// Magenta "canta a la vista" = id sin color en catálogo (mismo criterio que
// catalogoVisual.ts). Los tipos de edificio no declaran colorDebug aún, así
// que llevan un pardo de obra fijo hasta que el catálogo lo traiga.
const COLOR_DESCONOCIDO = "#b05ad8";
const COLOR_EDIFICIO = "#8d7d63";

function comoTabla(json: unknown): Record<string, EntradaBruta> {
  const tabla: Record<string, EntradaBruta> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (k.startsWith("_") || typeof v !== "object" || v === null) continue;
    tabla[k] = v as EntradaBruta;
  }
  return tabla;
}

function esColisionable(entrada: EntradaBruta): boolean {
  return entrada.colision !== false && entrada.anchorType !== "FLOOR_DECAL";
}

function construirLista(): Construible[] {
  const lista: Construible[] = [];

  for (const [id, e] of Object.entries(comoTabla(elementosJson))) {
    if (e.capa === "estructural") continue;
    if (e.specialModifier === "ESPECIAL_ENEMIGO_SALVAJE") continue;
    if (!e.huella) continue; // sin huella no hay nada que colocar
    lista.push({
      id,
      categoria: "mueble",
      huella: [e.huella[0], e.huella[1]],
      colorDebug: e.colorDebug || COLOR_DESCONOCIDO,
      colision: esColisionable(e),
      nombre: e.nombre,
      instrumento: e.instrumento,
      esCama: e.esCama,
      esSilla: e.esSilla,
      esContenedor: e.esContenedor,
    });
  }

  for (const [id, e] of Object.entries(comoTabla(exterioresJson))) {
    if (!e.huella) continue;
    lista.push({
      id,
      categoria: "exterior",
      huella: [e.huella[0], e.huella[1]],
      colorDebug: e.colorDebug || COLOR_DESCONOCIDO,
      colision: esColisionable(e),
      proyectoJarl: e.proyectoJarl,
      plantable: !!e.plantable,
      cocina: e.cocina,
      produccion: e.produccion,
    });
  }

  for (const [id, e] of Object.entries(comoTabla(tiposEdificioJson))) {
    if (e.construible !== true || !e.huellaExterior) continue;
    lista.push({
      id,
      categoria: "edificio",
      huella: [e.huellaExterior[0], e.huellaExterior[1]],
      colorDebug: e.colorDebug || COLOR_EDIFICIO,
      colision: true, // un edificio siempre es sólido
      proyectoJarl: e.proyectoJarl,
    });
  }

  return lista;
}

/**
 * Plantillas del jarl (docs/GDD_Produccion.md, generalizado 2026-08-31 a los
 * proyectos especiales — docs/GDD_Ciudad_Capital.md §5ter): tipos de edificio
 * con `plantillaJarl: true` (aserradero, producción exterior) O
 * `proyectoJarl: true` (proyectos especiales) — MISMO filtro que
 * `cargarCatalogoPlantillas` del servidor. Lista APARTE de `CONSTRUIBLES`
 * (`construirLista` ya los excluye ahí vía `construible !== true`): solo el
 * colocador de plantillas jarl-only (`colocadorPlantillas.ts`) los ofrece,
 * nunca el menú normal de construcción de un jugador cualquiera.
 */
function construirListaPlantillas(): Construible[] {
  const lista: Construible[] = [];
  for (const [id, e] of Object.entries(comoTabla(tiposEdificioJson))) {
    if (!e.huellaExterior) continue;
    if (e.plantillaJarl !== true && e.proyectoJarl !== true) continue;
    lista.push({
      id,
      categoria: "edificio",
      huella: [e.huellaExterior[0], e.huellaExterior[1]],
      colorDebug: e.colorDebug || COLOR_EDIFICIO,
      colision: true,
      plantillaJarl: e.plantillaJarl === true,
      proyectoJarl: e.proyectoJarl === true,
      nombre: e.nombre,
      produccion: e.produccion,
    });
  }
  return lista;
}

/** Todo lo construible, en orden de catálogo. */
export const CONSTRUIBLES: Construible[] = construirLista();

/** Todo lo colocable SOLO por el jarl vía `colocadorPlantillas.ts` (aserradero + proyectos especiales). */
export const PLANTILLAS_JARL: Construible[] = construirListaPlantillas();

/** Agrupado por categoría para pintar el panel (mantiene el orden de catálogo). */
export const CONSTRUIBLES_POR_CATEGORIA: Map<CategoriaConstruible, Construible[]> = (() => {
  const mapa = new Map<CategoriaConstruible, Construible[]>();
  for (const c of CONSTRUIBLES) {
    if (!mapa.has(c.categoria)) mapa.set(c.categoria, []);
    mapa.get(c.categoria)!.push(c);
  }
  return mapa;
})();

const POR_ID = new Map<string, Construible>(CONSTRUIBLES.map((c) => [c.id, c]));
const POR_ID_PLANTILLA = new Map<string, Construible>(PLANTILLAS_JARL.map((c) => [c.id, c]));

/** Entrada construible por id (undefined si el id no está en los catálogos). */
export function obtenerConstruible(id: string): Construible | undefined {
  return POR_ID.get(id);
}

/**
 * Como `obtenerConstruible`, pero busca TAMBIÉN en `PLANTILLAS_JARL`
 * (aserradero, fundición...) — necesario para el menú de interacción
 * (docs/GDD_Produccion.md §3bis) sobre una construcción que un jugador
 * puede poseer (una plantilla comprada) aunque no viva en el menú normal de
 * construir.
 */
export function obtenerConstruibleOPlantilla(id: string): Construible | undefined {
  return POR_ID.get(id) ?? POR_ID_PLANTILLA.get(id);
}

/**
 * Huella tras rotar `rot` (0..3, pasos de 90° horario): en rot impar el
 * rectángulo se tumba y queda [largo, ancho] — mismo convenio que guarda el
 * servidor en DB (GDD §2: "huella rotada = [h,w] en rot impar").
 */
export function huellaRotada(huella: [number, number], rot: number): [number, number] {
  return rot % 2 === 1 ? [huella[1], huella[0]] : [huella[0], huella[1]];
}
