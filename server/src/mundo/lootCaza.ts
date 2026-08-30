/**
 * Loot de caza (docs/GDD_Caza.md, pedido 2026-08-30) — qué entra en el
 * `Cadaver.contenedor` al morir un animal (carne/tendones/tripas, SIEMPRE,
 * automático) y qué da desollarlo aparte con un cuchillo (piel + 5% de
 * cabeza-trofeo, verbo separado — ver `server/src/mundo/cadaveres.ts` y el
 * manejador `cadaver:desollar` en RoomExteriorBase.ts). Módulo PURO — sin
 * fs/BD/Colyseus, mismo patrón que `reproduccionFauna.ts`/`cadaveres.ts`.
 *
 * Escala por `categoriaVida` (docs/GDD_Mecanicas.md §5.4, ya cubre las 187
 * especies del bake sin excepción — mismo dato que ya usa vida/ataque de
 * combate) en vez de por especie individual: "un jabalí da más carne que un
 * conejo" sin tener que mantener una tabla de 187 entradas a mano.
 */
import { CategoriaVidaAnimal, EstadisticasCombateAnimal } from "./catalogoCombateFauna";
import { agregarItem, CatalogoItems, Contenedor } from "../inventario/inventario";

interface CantidadesLootCaza {
  carne: number;
  tendones: number;
  tripas: number;
  piel: number;
  trofeo: "cabeza_trofeo_pequena" | "cabeza_trofeo_mediana" | "cabeza_trofeo_grande";
}

// Placeholder de balance (mismo criterio que el resto del proyecto) — más
// categoriaVida, más carne/tendones/tripas/piel. `trofeo` decide qué tier de
// cabeza sale con la probabilidad fija PROBABILIDAD_TROFEO al desollar.
const TABLA_LOOT_CAZA: Record<CategoriaVidaAnimal, CantidadesLootCaza> = {
  cria: { carne: 1, tendones: 1, tripas: 1, piel: 1, trofeo: "cabeza_trofeo_pequena" },
  pequeno: { carne: 2, tendones: 1, tripas: 1, piel: 1, trofeo: "cabeza_trofeo_pequena" },
  mediano: { carne: 4, tendones: 2, tripas: 2, piel: 2, trofeo: "cabeza_trofeo_mediana" },
  grande: { carne: 7, tendones: 3, tripas: 3, piel: 3, trofeo: "cabeza_trofeo_grande" },
  alfa: { carne: 12, tendones: 5, tripas: 5, piel: 5, trofeo: "cabeza_trofeo_grande" },
};

/** 5% de probabilidad, pedido explícito del streamer — fija, no varía por categoría. */
export const PROBABILIDAD_TROFEO = 0.05;

const ITEM_TENDONES = "tendones";
const ITEM_TRIPAS = "tripas";

/**
 * Rellena el cadáver recién creado con carne/tendones/tripas (SIEMPRE, al
 * morir — no hace falta desollar para esto). La piel NO se reparte aquí:
 * solo sale de `pielDeDesollado`, verbo aparte con cuchillo+oficio.
 * Silencioso ante `sin_hueco` (contenedor 4x3 casi nunca se llena con esto
 * solo) — no hay dónde avisar a nadie en este punto, el animal ya murió.
 */
export function rellenarLootCaza(
  contenedor: Contenedor,
  catalogo: CatalogoItems,
  especie: EstadisticasCombateAnimal,
): void {
  const cantidades = TABLA_LOOT_CAZA[especie.categoriaVida];
  if (especie.categoriaRecursoCarne) agregarItem(contenedor, catalogo, especie.categoriaRecursoCarne, cantidades.carne);
  agregarItem(contenedor, catalogo, ITEM_TENDONES, cantidades.tendones);
  agregarItem(contenedor, catalogo, ITEM_TRIPAS, cantidades.tripas);
}

export interface ResultadoDesollar {
  pielItemId: string | null;
  pielCantidad: number;
  trofeoItemId: string | null;
}

/**
 * Qué da desollar un cadáver de esta especie: piel según `categoriaRecursoPiel`
 * (ausente = animal sin piel útil, p.ej. algo puramente acuático sin catalogar
 * así — `pielItemId: null`) y una tirada de trofeo aparte, independiente.
 * `rnd` inyectado (por defecto `Math.random`) para poder testear el 5% sin
 * aleatoriedad real — esto es evento EN VIVO, no bake, así que no usa el PRNG
 * determinista por semilla de `azar.js` (ese es solo para el bakeador offline).
 */
export function pielDeDesollado(especie: EstadisticasCombateAnimal, rnd: () => number = Math.random): ResultadoDesollar {
  const cantidades = TABLA_LOOT_CAZA[especie.categoriaVida];
  const pielItemId = especie.categoriaRecursoPiel ?? null;
  const trofeoItemId = rnd() < PROBABILIDAD_TROFEO ? cantidades.trofeo : null;
  return { pielItemId, pielCantidad: pielItemId ? cantidades.piel : 0, trofeoItemId };
}
