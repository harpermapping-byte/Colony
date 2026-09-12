/**
 * Nombre BONITO por tier de asentamiento (docs/GDD_Poblacion_NPCs.md,
 * pedido streamer 2026-09-12: panel de inspección con "ciudad al que
 * pertenece" un NPC) — `ciudades/catalogo/asentamientos.json` no tiene
 * ningún campo de etiqueta legible (comprobado: solo claves vacías por
 * tier), así que esta es la única fuente de un nombre presentable. Los
 * ids de `RegionRoom.tierAsentamiento` son literales del `tier` que ya
 * escribe `indice.json` al hornear (mismos 8 tiers de asentamientos.json).
 */
const NOMBRE_BONITO_TIER: Record<string, string> = {
  aldea_pequena: "Aldea pequeña",
  aldea: "Aldea",
  pueblo: "Pueblo",
  capital: "Capital regional",
  capital_jarl: "Capital del Jarl",
  castillo: "Castillo",
  asentamiento_hostil: "Campamento hostil",
  gran_capital: "Gran metrópoli",
};

/** `tier` desconocido (o "") cae al propio string tal cual — nunca revienta, solo se ve menos bonito. */
export function nombreBonitoDeTier(tier: string): string {
  return NOMBRE_BONITO_TIER[tier] ?? tier;
}
