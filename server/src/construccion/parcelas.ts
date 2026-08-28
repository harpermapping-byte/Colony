/**
 * Parcelas — dato estático del mapa (GDD_Construccion §1).
 *
 * Carga `<rutaMapa>/parcelas.json` (formato de runs [y, x0, x1] pintado por la
 * herramienta admin de `parcelas/`) y construye el índice de pertenencia
 * casilla→parcelaId con clave NUMÉRICA `y*anchoMapa + x` (regla 4 del
 * CLAUDE.md: nada de strings en consultas por casilla — el validador de
 * construcción pregunta por cada casilla de cada huella).
 *
 * Tolerante a la ausencia del archivo: un mapa sin parcelas.json (el demo,
 * un entorno de pruebas) simplemente no tiene parcelas y nadie construye.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Parcela {
  asentamiento: string;
  nombre: string;
  /** filas incluidas como [y, x0, x1], ambos extremos inclusive */
  runs: [number, number, number][];
  casillas: number;
  topeProps: number;
}

export interface IndiceParcelas {
  /** ancho del mapa con el que se calculó la clave numérica */
  anchoMapa: number;
  parcelas: Map<string, Parcela>;
  /** clave y*anchoMapa+x → parcelaId (solo casillas dentro de alguna parcela) */
  indice: Map<number, string>;
}

interface ArchivoParcelas {
  version: number;
  mapa: string;
  parcelas: Record<string, Parcela>;
}

export function cargarParcelas(rutaMapa: string | undefined, anchoMapa: number): IndiceParcelas {
  const resultado: IndiceParcelas = { anchoMapa, parcelas: new Map(), indice: new Map() };
  if (!rutaMapa) return resultado;
  const ruta = path.join(rutaMapa, "parcelas.json");
  if (!fs.existsSync(ruta)) return resultado; // sin archivo = sin parcelas, no es error

  const datos = JSON.parse(fs.readFileSync(ruta, "utf8")) as ArchivoParcelas;
  for (const [id, parcela] of Object.entries(datos.parcelas || {})) {
    resultado.parcelas.set(id, parcela);
    for (const [y, x0, x1] of parcela.runs) {
      for (let x = x0; x <= x1; x++) {
        resultado.indice.set(y * anchoMapa + x, id);
      }
    }
  }
  return resultado;
}

/** Parcela que contiene la casilla (x,y), o undefined si es tierra de nadie. */
export function parcelaEn(parcelas: IndiceParcelas, x: number, y: number): string | undefined {
  return parcelas.indice.get(y * parcelas.anchoMapa + x);
}

/** Runs de la parcela (para mandarlos al cliente y pintar bordes). */
export function runsDe(parcelas: IndiceParcelas, parcelaId: string): [number, number, number][] {
  return parcelas.parcelas.get(parcelaId)?.runs ?? [];
}

/** Tope de construcciones de la parcela (0 si no existe: nadie construye en la nada). */
export function topeDe(parcelas: IndiceParcelas, parcelaId: string): number {
  return parcelas.parcelas.get(parcelaId)?.topeProps ?? 0;
}
