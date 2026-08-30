/**
 * Carga `items/catalogo/items.json` y lo reduce a lo único que hace falta en
 * el servidor para barcos (docs/GDD_Barcos.md, pedido 2026-08-30): plazas y
 * velocidad de cada tipo de barco. Mismo criterio que catalogoMonturas.ts —
 * el resto del catálogo de ítems (huella/peso/apilable...) ya lo lee
 * inventario.ts, cero duplicado aquí.
 */
import * as fs from "fs";
import * as path from "path";

export interface DatosBarco {
  plazas: number;
  /** casillas/seg mientras el capitán lo pilota, SOLO sobre agua. */
  velocidadBarco: number;
}

export type CatalogoBarcos = Record<string, DatosBarco>;

interface EntradaCatalogoItem {
  esBarco?: boolean;
  plazas?: number;
  velocidadBarco?: number;
}

const RUTA_DEFECTO = path.join(__dirname, "..", "..", "..", "items", "catalogo", "items.json");

export function cargarCatalogoBarcos(ruta: string = RUTA_DEFECTO): CatalogoBarcos {
  const raw = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaCatalogoItem>;
  const catalogo: CatalogoBarcos = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_") || !datos || typeof datos !== "object" || !datos.esBarco) continue;
    catalogo[id] = { plazas: Math.max(1, datos.plazas ?? 1), velocidadBarco: datos.velocidadBarco ?? 5 };
  }
  return catalogo;
}
