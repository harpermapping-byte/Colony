/**
 * Motor de reglas del AJEDREZ (docs/GDD_Mesas_Minijuego.md) — PURA (sin
 * Colyseus/BD), envoltorio fino sobre `chess.js` (MIT, headless, usado SOLO
 * en servidor: autoritativo, como todo el proyecto — el cliente nunca
 * valida una jugada, solo la propone). Aislado en su propio módulo a
 * propósito: un futuro "mesa_damas"/"mesa_blackjack" se resuelve con OTRO
 * módulo igual de pequeño (su propio motor de reglas), sin tocar
 * `mesasJuego.ts` (asientos/turno, genérico) ni el protocolo Colyseus.
 */
import { Chess } from "chess.js";

/** Posición inicial estándar (misma cadena que `chess.js` exporta como DEFAULT_POSITION) — hardcodeada para no acoplar el Schema de Colyseus a chess.js. */
export const FEN_INICIAL_AJEDREZ = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type BandoAjedrez = "blancas" | "negras";
export type GanadorAjedrez = BandoAjedrez | "tablas";

export type ResultadoMovimientoAjedrez =
  | {
      ok: true;
      fen: string;
      terminado: boolean;
      /** Solo si terminado:true. */
      ganador: GanadorAjedrez | null;
      /** A quién le toca DESPUÉS de este movimiento (irrelevante si terminado:true). */
      turno: BandoAjedrez;
    }
  | { ok: false; motivo: string };

/**
 * Aplica un movimiento "de"->"a" (notación de casilla, ej. "e2"->"e4") sobre
 * un FEN dado. Valida TODAS las reglas reales vía chess.js (turno correcto,
 * jaque, enroque, al paso, promoción — "q" por defecto si no se especifica,
 * mismo criterio de casi todos los clientes de ajedrez simples) y detecta
 * el final de partida (jaque mate / tablas por ahogado, material
 * insuficiente, triple repetición o regla de 50 movimientos — todo lo que
 * ya cubre `Chess.isGameOver()`).
 */
export function aplicarMovimientoAjedrez(
  fen: string,
  desde: string,
  hasta: string,
  promocion?: string,
): ResultadoMovimientoAjedrez {
  let partida: Chess;
  try {
    partida = new Chess(fen);
  } catch {
    return { ok: false, motivo: "posición inválida" };
  }

  let movimiento;
  try {
    movimiento = partida.move({ from: desde, to: hasta, promotion: promocion || "q" });
  } catch {
    movimiento = null; // chess.js lanza excepción en jugada ilegal — se trata como "no se pudo mover"
  }
  if (!movimiento) return { ok: false, motivo: "movimiento ilegal" };

  const terminado = partida.isGameOver();
  let ganador: GanadorAjedrez | null = null;
  if (terminado) {
    // partida.turn() tras el movimiento es a quién le tocaría mover ahora —
    // en jaque mate ese bando es el que se quedó SIN movimientos legales
    // (el que PIERDE); cualquier otro motivo de fin (ahogado, material
    // insuficiente, repetición, 50 movimientos) es tablas.
    ganador = partida.isCheckmate() ? (partida.turn() === "w" ? "negras" : "blancas") : "tablas";
  }
  return { ok: true, fen: partida.fen(), terminado, ganador, turno: partida.turn() === "w" ? "blancas" : "negras" };
}
