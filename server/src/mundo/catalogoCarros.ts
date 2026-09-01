/**
 * Carga `items/catalogo/items.json` y lo reduce a lo único que hace falta en
 * el servidor para carros (docs/GDD_Carros.md §7, pedido 2026-09-03/04):
 * categoría, capota, asientos, peso y nivel de ingeniero de cada tipo de
 * carro. Mismo criterio exacto que catalogoBarcos.ts/catalogoMonturas.ts —
 * el resto del catálogo de ítems (huella/durabilidad...) ya lo lee
 * inventario.ts, cero duplicado aquí.
 */
import * as fs from "fs";
import * as path from "path";

export interface DatosCarro {
  categoria: string;
  capotado: boolean;
  /** solo tiene sentido en categoria "personas" — 1 en el resto (aperos/cisterna/jaula/materiales de fase 1, sin pasajeros). */
  asientos: number;
  /** peso del carro VACÍO — comparado contra pesoMaximoArnes del arnés puesto (docs/GDD_Carros.md §3). */
  peso: number;
  nivelIngenieroMinimo: number;
}

export type CatalogoCarros = Record<string, DatosCarro>;

interface EntradaCatalogoItem {
  tipo?: string;
  categoria?: string;
  capotado?: boolean;
  asientos?: number;
  peso?: number;
  nivelIngenieroMinimo?: number;
}

const RUTA_DEFECTO = path.join(__dirname, "..", "..", "..", "items", "catalogo", "items.json");

export function cargarCatalogoCarros(ruta: string = RUTA_DEFECTO): CatalogoCarros {
  const raw = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaCatalogoItem>;
  const catalogo: CatalogoCarros = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_") || !datos || typeof datos !== "object" || datos.tipo !== "carro") continue;
    catalogo[id] = {
      categoria: datos.categoria ?? "personas",
      capotado: !!datos.capotado,
      asientos: Math.max(1, datos.asientos ?? 1),
      peso: datos.peso ?? 0,
      nivelIngenieroMinimo: datos.nivelIngenieroMinimo ?? 2,
    };
  }
  return catalogo;
}
