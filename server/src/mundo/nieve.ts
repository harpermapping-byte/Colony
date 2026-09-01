/**
 * Acumulador de nieve del SERVIDOR — misma fórmula que
 * `client/src/mundo/nieve.ts`, `assets/mundo/clima.json` como única
 * fuente (docs/GDD_Clima.md, pasada 2026-09-01). Nivel GLOBAL 0..
 * `nivelMaximoNieve` (un entero para todo el mapa exterior, no por
 * casilla) — sin guardar estado en ningún sitio: se DERIVA recorriendo
 * hacia atrás `ventanaFoldDiasNieve` días desde el día pedido, mismo
 * criterio "cálculo perezoso" que el resto del proyecto.
 *
 * Regla por día (`docs/GDD_Clima.md`): sube 1 el día en que ALGUNA franja
 * nevó; baja 1 el día en que NINGUNA franja nevó Y la temperatura de la
 * franja "tarde" supera `umbralDeshieloC`; se mantiene igual en cualquier
 * otro caso (frío pero sin nevar ese día concreto) — así si vuelve a
 * nevar, el nivel sigue subiendo desde donde se quedó, no desde 0.
 *
 * Por qué una ventana acotada y no todo el historial desde la época: el
 * nivel nunca sube/baja más de 1 por día y tiene tope, así que cualquier
 * arranque anterior a `nivelMaximoNieve` días de diferencia da el mismo
 * resultado — 45 días de margen (medio invierno) es sobra de sobra y
 * mantiene el cálculo barato (recomputado cada vez que se pide, sin caché).
 */
import * as climaJson from "../../../assets/mundo/clima.json";
import { estacionYDiaDelAnio } from "./tiempoMundo";
import { algunaFranjaNevo, temperaturaTarde, type Estacion } from "./clima";

export const NIVEL_MAXIMO_NIEVE = climaJson.nivelMaximoNieve;

/** Nivel de nieve acumulada (0..NIVEL_MAXIMO_NIEVE) para un día de mundo dado. Determinista, sin estado. */
export function nivelNieve(dia: number): number {
  let nivel = 0;
  const inicio = Math.max(0, dia - (climaJson.ventanaFoldDiasNieve - 1));
  for (let d = inicio; d <= dia; d++) {
    const { estacion, diaDelAnio } = estacionYDiaDelAnio(d);
    if (algunaFranjaNevo(d, estacion as Estacion, diaDelAnio)) {
      nivel = Math.min(climaJson.nivelMaximoNieve, nivel + 1);
    } else if (temperaturaTarde(diaDelAnio) > climaJson.umbralDeshieloC) {
      nivel = Math.max(0, nivel - 1);
    }
  }
  return nivel;
}

/** Cuánto frena la nieve acumulada en tierra (1 = sin nieve, más lento cuanto más nivel) — "a más capas de nieve más lento te mueves", pedido del streamer. Lineal, tope en el nivel máximo del catálogo. */
export function multiplicadorVelocidadPorNieve(nivel: number): number {
  return Math.max(0.4, 1 - nivel * 0.15);
}
