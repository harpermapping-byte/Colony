/**
 * Generación del interior al colocar un edificio (GDD_Construccion §5):
 * se genera UNA VEZ con el generador de interiores y se persiste en el
 * campo `extra` de la construcción — entrar/renderizarlo es OTRO hito.
 *
 * Determinismo: la semilla es EXACTAMENTE "construccion|<propiedadId>|<x>_<y>"
 * (contrato del GDD) — mismo sitio, mismo interior, siempre. Modo
 * `amueblado: "vacio"`: salas vacías listas para que el dueño amueble.
 *
 * El generador es CommonJS sin dependencias: require en runtime con ruta
 * absoluta (el servidor ya lee catálogos hermanos, mismo patrón que
 * mundo/mapaColision). Los catálogos de interiores se cargan una sola vez
 * por proceso — leerlos por colocación sería trabajo repetido inútil.
 */

import * as path from "node:path";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const CARPETA_INTERIORES = path.join(RAIZ_REPO, "interiores", "src");

interface ModuloCatalogo {
  cargarCatalogos(): Record<string, unknown>;
}
interface ModuloEdificio {
  generarEdificio(opciones: {
    tipoEdificioId: string;
    catalogos: Record<string, unknown>;
    semilla: string;
    amueblado: string;
  }): Record<string, unknown>;
}

let catalogosInteriores: Record<string, unknown> | null = null;

export function semillaInterior(propiedadId: string, x: number, y: number): string {
  return `construccion|${propiedadId}|${x}_${y}`;
}

/** Interior generado, serializable tal cual a JSON para guardarlo en `extra`. */
export function generarInteriorEdificio(
  tipoEdificioId: string,
  propiedadId: string,
  x: number,
  y: number
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { cargarCatalogos } = require(path.join(CARPETA_INTERIORES, "catalogo.js")) as ModuloCatalogo;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generarEdificio } = require(path.join(CARPETA_INTERIORES, "edificio.js")) as ModuloEdificio;
  if (!catalogosInteriores) catalogosInteriores = cargarCatalogos();

  const interior = generarEdificio({
    tipoEdificioId,
    catalogos: catalogosInteriores,
    semilla: semillaInterior(propiedadId, x, y),
    amueblado: "vacio",
  });
  // Las salas internas usan Set (tiles/puertas/ventanas) — JSON los perdería
  // como "{}". Se convierten a array AQUÍ, una vez, para que lo guardado en
  // `extra` sea el interior COMPLETO y fiel (contrato §5: generado y
  // persistido, listo para el hito de render).
  return JSON.parse(
    JSON.stringify(interior, (_clave, valor) => (valor instanceof Set ? [...valor] : valor))
  ) as Record<string, unknown>;
}
