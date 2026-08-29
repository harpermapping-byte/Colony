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
import { ParcelaReservada } from "../mundo/mapaColision";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const RUTA_GEOMETRIA_CIUDADES = path.join(RAIZ_REPO, "ciudades", "src", "geometria.js");

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

/**
 * Construcción-en-regiones (docs/GDD_Ciudad_Capital.md §3bis): convierte los
 * huecos `parcelasReservadas` que YA exporta el bake de `ciudades/` (hoy solo
 * el tier `capital_jarl`) en un `IndiceParcelas` con la MISMA forma que
 * `cargarParcelas` — así `construccion.ts` (validarColocacion/aplicarColocacion)
 * no necesita saber que esta parcela viene de un rectángulo rotado en vez de
 * runs pintados a mano en `parcelas/gui/servidor.js`.
 *
 * Cada reserva es un rectángulo con rotación LIBRE (no solo 0/90°, a
 * diferencia de la huella de un mueble) — se rasteriza con la MISMA función
 * `rasterizarRectRotado` que ya usa `ciudades/src/generar.js` para colocarla
 * en el bake (require() en runtime de un módulo offline, mismo patrón que
 * `economiaAsentamientos.ts` con `exportarAsentamiento.js`), así la parcela
 * cubre EXACTAMENTE las mismas casillas que el bakeador dejó libres — nunca
 * una aproximación axis-aligned que pudiera invadir la calle de al lado.
 */
export function cargarParcelasDeReservas(
  reservas: ParcelaReservada[],
  asentamiento: string,
  anchoMapa: number,
  altoMapa: number,
  topeProps: number,
): IndiceParcelas {
  const resultado: IndiceParcelas = { anchoMapa, parcelas: new Map(), indice: new Map() };
  if (!reservas?.length) return resultado;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rasterizarRectRotado } = require(RUTA_GEOMETRIA_CIUDADES) as {
    rasterizarRectRotado: (
      cx: number, cy: number, semiAncho: number, semiAlto: number, angulo: number,
      ancho: number, alto: number, pintar: (x: number, y: number) => void,
    ) => void;
  };

  reservas.forEach((r, i) => {
    const id = `${asentamiento}:${r.tipo}_${String(i).padStart(3, "0")}`;
    // min/max por fila en vez de asumir un único run: rasterizarRectRotado
    // pinta casilla a casilla, y aunque un rectángulo convexo a cualquier
    // ángulo SIEMPRE corta una fila en un único tramo contiguo, acumular
    // min/max es tan barato como asumirlo y no depende de ese razonamiento.
    const filas = new Map<number, { x0: number; x1: number }>();
    rasterizarRectRotado(r.x, r.y, r.ancho / 2, r.largo / 2, r.rot, anchoMapa, altoMapa, (x, y) => {
      const fila = filas.get(y);
      if (!fila) filas.set(y, { x0: x, x1: x });
      else { fila.x0 = Math.min(fila.x0, x); fila.x1 = Math.max(fila.x1, x); }
    });
    if (filas.size === 0) return; // reserva degenerada (fuera de rango): se ignora, no bloquea el resto

    const runs: [number, number, number][] = [...filas.entries()]
      .sort(([a], [b]) => a - b)
      .map(([y, { x0, x1 }]) => [y, x0, x1]);
    const casillas = runs.reduce((suma, [, x0, x1]) => suma + (x1 - x0 + 1), 0);

    resultado.parcelas.set(id, { asentamiento, nombre: id, runs, casillas, topeProps });
    for (const [y, x0, x1] of runs) {
      for (let x = x0; x <= x1; x++) resultado.indice.set(y * anchoMapa + x, id);
    }
  });

  return resultado;
}
