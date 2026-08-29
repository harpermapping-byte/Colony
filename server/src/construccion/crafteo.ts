/**
 * Crafteo final (docs/GDD_Crafteo.md §5-6) — PURA (sin Colyseus/BD/fs), capa
 * ACTIVA sobre el refinamiento pasivo de produccion.ts: el jugador dispara
 * la acción en su mesa, consume de SU inventario, tarda un tiempo (nunca
 * tick — se resuelve comparando `terminaEn` contra `ahoraMs` cuando el
 * jugador vuelve a tocar, mismo espíritu perezoso que el resto del
 * proyecto), y el nivel de oficio (derivado de XP, nunca persistido en sí)
 * decide qué recetas puede intentar.
 */

// La curva de nivel por XP se comparte con docs/GDD_Personaje.md (nivel de
// atributo, mismo mecanismo) — vive en server/src/progresion/nivel.ts;
// re-exportada aquí TAL CUAL para no romper los imports/tests existentes de
// `nivelDeXp` desde este módulo.
export { nivelDeXp } from "../progresion/nivel";
import { nivelDeXp } from "../progresion/nivel";

export interface RecetaCrafteo {
  id: string;
  oficio: string;
  /** ids de objeto (EntradaConstruible) válidos como estación para esta receta. */
  mesas: string[];
  nivelMinimo: number;
  /**
   * Plano requerido (docs/GDD_Crafteo.md §7: cómo se consigue un plano
   * sigue sin diseñar/implementar) — campo aditivo ya en el schema para
   * cuando exista ese mecanismo; v1 NO lo comprueba (ver validarCrafteo).
   */
  planoRequerido?: string;
  insumos: { itemId: string; cantidad: number }[];
  resultado: { itemId: string; cantidad: number };
  tiempoBaseSeg: number;
}

export type ResultadoValidacionCrafteo = { ok: true } | { ok: false; motivo: string };

/**
 * Todas las condiciones de docs/GDD_Crafteo.md §0 salvo el plano (ver nota
 * en `RecetaCrafteo.planoRequerido`): mesa correcta + nivel de oficio +
 * insumos en el inventario del jugador.
 */
export function validarCrafteo(
  receta: RecetaCrafteo,
  objetoMesa: string,
  xpOficio: number,
  inventario: { itemId: string; cantidad: number }[],
): ResultadoValidacionCrafteo {
  if (!receta.mesas.includes(objetoMesa)) return { ok: false, motivo: "esta no es la mesa correcta para esta receta" };
  if (nivelDeXp(xpOficio) < receta.nivelMinimo) return { ok: false, motivo: "nivel de oficio insuficiente" };
  for (const insumo of receta.insumos) {
    const enInventario = inventario.find((i) => i.itemId === insumo.itemId)?.cantidad ?? 0;
    if (enInventario < insumo.cantidad) return { ok: false, motivo: `te falta ${insumo.itemId}` };
  }
  return { ok: true };
}

export interface EstadoCrafteo {
  recetaId: string;
  /** epoch ms en que termina — calculado UNA VEZ al iniciar (tiempoBaseSeg / factorVelocidadPorEnergia), nunca recalculado mientras está en curso. */
  terminaEn: number;
}

/** `true` cuando el crafteo en curso ya puede recogerse — comparación pura, sin tick. */
export function crafteoListo(estado: EstadoCrafteo, ahoraMs: number): boolean {
  return ahoraMs >= estado.terminaEn;
}
