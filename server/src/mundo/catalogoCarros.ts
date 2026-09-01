/**
 * Carga `items/catalogo/items.json` y lo reduce a lo único que hace falta en
 * el servidor para carros (docs/GDD_Carros.md §7, pedido 2026-09-03/04):
 * categoría, capota, asientos, peso y nivel de ingeniero de cada tipo de
 * carro, más la capacidad de carga según su categoría (§8, Fase 2). Mismo
 * criterio exacto que catalogoBarcos.ts/catalogoMonturas.ts — el resto del
 * catálogo de ítems (huella/durabilidad...) ya lo lee inventario.ts, cero
 * duplicado aquí.
 */
import * as fs from "fs";
import * as path from "path";

export interface DatosCarro {
  categoria: string;
  capotado: boolean;
  /** solo tiene sentido en categoria "personas" — 1 en el resto (aperos/cisterna/jaula/materiales/muebles, sin pasajeros). */
  asientos: number;
  /** peso del carro VACÍO — comparado contra pesoMaximoArnes del arnés puesto (docs/GDD_Carros.md §3). */
  peso: number;
  nivelIngenieroMinimo: number;
  /** docs/GDD_Carros.md §8.2 — SOLO categoria "materiales": tamaño de la rejilla Tetris de carga. */
  capacidadContenedor?: { ancho: number; alto: number };
  /** docs/GDD_Carros.md §8.3 — SOLO categoria "muebles": capacidad total por `tamanoTransporte` (no por unidad). */
  capacidadMuebles?: number;
  /** docs/GDD_Carros.md §8.4 — SOLO categoria "animales": nº de mascotas propias que caben en la jaula. */
  capacidadJaula?: number;
  /** docs/GDD_Carros.md §8.5 — SOLO categoria "liquidos": volumen máximo de la cisterna. */
  capacidadLiquidoMl?: number;
}

export type CatalogoCarros = Record<string, DatosCarro>;

interface EntradaCatalogoItem {
  tipo?: string;
  categoria?: string;
  capotado?: boolean;
  asientos?: number;
  peso?: number;
  nivelIngenieroMinimo?: number;
  capacidadContenedor?: { ancho: number; alto: number };
  capacidadMuebles?: number;
  capacidadJaula?: number;
  capacidadLiquidoMl?: number;
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
      capacidadContenedor: datos.capacidadContenedor,
      capacidadMuebles: datos.capacidadMuebles,
      capacidadJaula: datos.capacidadJaula,
      capacidadLiquidoMl: datos.capacidadLiquidoMl,
    };
  }
  return catalogo;
}
