/**
 * Comercio con NPCs tendero (docs/GDD_Economia.md, pedido 2026-08-30) —
 * catálogo de "tienda general" v1: qué vende y qué compra CUALQUIER NPC
 * con oficio "tendero", precios fijos. Deliberadamente genérico y
 * pequeño — el streamer pidió dejar "qué compra/vende cada uno" para
 * más adelante; esto es el catálogo de partida que hace el sistema
 * funcionar de verdad hoy, ajustable sin tocar el protocolo `npc:*`.
 */

/** Lo que el tendero VENDE — el jugador paga estos Farycoins por unidad. */
export const NPC_TENDERO_VENTA: Record<string, number> = {
  antorcha_portatil: 5,
  racion_viaje: 3,
  sal: 2,
  hierba_curativa: 4,
};

/** Cuántas unidades repone de golpe cada vez que se agota (stock "infinito" perezoso, sin tick de fondo). */
export const REPOSICION_STOCK_NPC = 20;

/** Lo que el tendero COMPRA — paga estos Farycoins por unidad, con SU PROPIO saldo (puede quedarse sin dinero). */
export const NPC_TENDERO_COMPRA: Record<string, number> = {
  hierro: 2,
  lana: 1,
  cuero_curtido: 2,
  piel_basta: 1,
  trigo: 1,
  miel: 2,
  fruta: 1,
  baya: 1,
};
