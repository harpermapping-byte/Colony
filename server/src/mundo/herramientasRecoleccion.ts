/**
 * Gating de herramienta por tier al recolectar del mundo (docs/GDD_Profesiones.md
 * §0, pedido 2026-08-30: "el gating real... queda pendiente"). `RecolectableVivo.itemId`
 * (mundo/recolectables.ts) es literalmente el `categoriaRecurso` del bake
 * (ver mapaColision.ts) — así que esta tabla mapea esa MISMA cadena a qué
 * oficio+tier de herramienta hace falta para poder cogerlo.
 *
 * Tiers asignados por rareza real del recurso (densidadBase en
 * baker/catalogo/vegetacion.json/rocas.json, más común = tier más bajo),
 * usando como ancla los ejemplos que dio el streamer en sus descripciones
 * de herramientas ("Tier 1: roca, carbón y cobre... Tier 4: gemas brutas y
 * minerales exóticos"). Solo cubre recolectables SALVAJES (bake exterior);
 * la agricultura de parcela (`cultivo`, categorías "semilla"/"fruta_cultivada")
 * es un sistema aparte y no pasa por aquí.
 */

import { Contenedor, CatalogoItems, ItemInstancia } from "../inventario/inventario";
import { estaRoto } from "../inventario/desgaste";

export interface RequisitoHerramienta {
  oficio: string;
  tier: number;
}

export const CATEGORIA_HERRAMIENTA_RECOLECCION: Record<string, RequisitoHerramienta> = {
  // carpintero — madera
  madera_blanda: { oficio: "carpintero", tier: 1 },
  madera_abedul: { oficio: "carpintero", tier: 1 },
  madera_dura: { oficio: "carpintero", tier: 2 },
  madera_sauce: { oficio: "carpintero", tier: 3 },
  madera_carbonizada: { oficio: "carpintero", tier: 3 },
  madera_palmera: { oficio: "carpintero", tier: 4 },

  // picapedrero — roca/mineral
  arcilla: { oficio: "picapedrero", tier: 1 },
  turba: { oficio: "picapedrero", tier: 1 },
  piedra_comun: { oficio: "picapedrero", tier: 1 },
  carbon: { oficio: "picapedrero", tier: 1 },
  cobre: { oficio: "picapedrero", tier: 2 },
  hierro: { oficio: "picapedrero", tier: 2 },
  cuarzo: { oficio: "picapedrero", tier: 2 },
  sal: { oficio: "picapedrero", tier: 2 },
  plomo: { oficio: "picapedrero", tier: 3 },
  azufre: { oficio: "picapedrero", tier: 3 },
  plata: { oficio: "picapedrero", tier: 3 },
  estano: { oficio: "picapedrero", tier: 3 },
  oro: { oficio: "picapedrero", tier: 4 },
  platino: { oficio: "picapedrero", tier: 4 },
  gema: { oficio: "picapedrero", tier: 4 },
  // Las 5 gemas preciosas (docs/GDD_Crafteo.md, cierre 2026-09-08) ya NO
  // comparten la categoriaRecurso genérica "gema" (esa se queda solo para
  // "geoda", la más común de las 6) — mismo tier 4 que "gema", cada una
  // ahora da su propio itemId real en vez de colapsar todas al mismo.
  amatista: { oficio: "picapedrero", tier: 4 },
  esmeralda: { oficio: "picapedrero", tier: 4 },
  rubi: { oficio: "picapedrero", tier: 4 },
  zafiro: { oficio: "picapedrero", tier: 4 },
  diamante: { oficio: "picapedrero", tier: 4 },

  // curandero — hierbas/hongos medicinales o tóxicos
  hierba_aromatica: { oficio: "curandero", tier: 1 },
  hierba_venenosa: { oficio: "curandero", tier: 2 },
  hierba_curativa: { oficio: "curandero", tier: 2 },
  flor_medicinal: { oficio: "curandero", tier: 3 },
  hongo_medicinal: { oficio: "curandero", tier: 4 },

  // molinero — comida/fibra silvestre (agricultura+ganadería+molienda ya fusionadas)
  fibra_vegetal: { oficio: "molinero", tier: 1 },
  cereal_silvestre: { oficio: "molinero", tier: 1 },
  hoja: { oficio: "molinero", tier: 1 },
  alga: { oficio: "molinero", tier: 2 },
  baya: { oficio: "molinero", tier: 2 },
  coral: { oficio: "molinero", tier: 2 },
  raiz_comestible: { oficio: "molinero", tier: 3 },
  hierba_comestible: { oficio: "molinero", tier: 3 },
  fruto_seco: { oficio: "molinero", tier: 3 },
  fruta: { oficio: "molinero", tier: 4 },
  hongo_comestible: { oficio: "molinero", tier: 4 },
  // miel SALVAJE (panal_salvaje, baker/catalogo/vegetacion.json, pedido
  // streamer 2026-09-09: "panal de abejas del cual con click puedes sacar
  // miel") — mismo itemId "miel" que ya produce la colmena construible
  // (server/src/construccion/produccion.ts, camino totalmente aparte), dos
  // fuentes del mismo recurso real. Tier 3: más raro que baya (den. común)
  // pero no tan escaso como fruta/hongo_comestible.
  miel: { oficio: "molinero", tier: 3 },

  // "hierba" (baker/catalogo/vegetacion.json::hierba_corta, pedido streamer
  // 2026-09-12: "eso puede cualquiera") — DELIBERADAMENTE AUSENTE de esta
  // tabla: es la ÚNICA categoriaRecurso del bake exterior sin requisito de
  // herramienta/oficio, "a mano" de verdad, a diferencia de TODAS las demás
  // hierbas/fibras de arriba (fibra_vegetal, hierba_aromatica...) que sí
  // exigen una herramienta de oficio equipada. No añadir una entrada aquí
  // sin que el streamer lo pida explícitamente — sería exactamente el
  // comportamiento contrario al pedido.
};

/**
 * itemId literal del recurso "hierba" (categoriaRecurso del bake, ver
 * comentario de arriba) — constante compartida para que `RoomExteriorBase`
 * no repita el string a mano en la comprobación de recolección en área.
 */
export const ID_RECURSO_HIERBA = "hierba";

/**
 * "Azada equipada" (docs/GDD_Bakeador_Exteriores.md, 2026-09-12: "con azada
 * click sobre una recolectar pero coge varias alrededor") — por PREFIJO de
 * id, no un id fijo (`azada_hierro` es la única hoy, pero cualquier azada
 * de tier futuro debería activar la misma cosecha en área sin tocar este
 * archivo, mismo criterio ya usado para prefijos de convención en el resto
 * del proyecto, p.ej. `pocion_alquimica_*`).
 */
export function esAzada(itemId: string | undefined): boolean {
  return !!itemId && itemId.startsWith("azada");
}

/**
 * Reaparición tras recolectar (docs/GDD_Bosques.md/GDD_Profesiones.md,
 * pedido 2026-08-30: "unificar recolectar con árboles" — los árboles YA
 * tienen su propio sistema de semilla/propagación, que se queda tal cual;
 * esto es SOLO para hierbas/rocas: un timer simple, reaparece en el MISMO
 * sitio). Reusa el `tier` ya asignado por rareza real (más raro = tarda
 * más) en vez de inventar una tabla de rareza nueva.
 */
const TIEMPO_RESPAWN_MS_POR_TIER: Record<number, number> = {
  1: 5 * 60 * 1000,
  2: 15 * 60 * 1000,
  3: 30 * 60 * 1000,
  4: 60 * 60 * 1000,
};

/** Milisegundos hasta que un recolectable de esta `categoriaRecurso` vuelve a estar disponible en el mismo sitio — `undefined` si la categoría no está en la tabla (no debería pasar para nada que pase por `requisitoDeCategoria`). */
export function tiempoRespawnMsDeCategoria(categoriaRecurso: string): number | undefined {
  const requisito = CATEGORIA_HERRAMIENTA_RECOLECCION[categoriaRecurso];
  if (!requisito) return undefined;
  return TIEMPO_RESPAWN_MS_POR_TIER[requisito.tier];
}

/** `undefined` = recurso sin requisito de herramienta (p.ej. cadáveres/objetos sueltos, o categorías no listadas). */
export function requisitoDeCategoria(categoriaRecurso: string): RequisitoHerramienta | undefined {
  return CATEGORIA_HERRAMIENTA_RECOLECCION[categoriaRecurso];
}

/**
 * Mejor herramienta del inventario que cumple `requisito` (familiaMaterial
 * "herramienta_<oficio>", tier >= el exigido, sin estar rota) — si hay
 * varias válidas, la de tier más alto (para no gastar por error la buena
 * cuando basta con la básica, aunque hoy da igual: ninguna se destruye,
 * solo se desgasta con `registrarUso`).
 */
export function mejorHerramientaPara(
  contenedor: Contenedor,
  catalogoItems: CatalogoItems,
  requisito: RequisitoHerramienta,
): ItemInstancia | undefined {
  const familiaBuscada = `herramienta_${requisito.oficio}`;
  let mejor: ItemInstancia | undefined;
  let mejorTier = -1;
  for (const it of contenedor.items) {
    const entrada = catalogoItems[it.itemId];
    if (!entrada || entrada.familiaMaterial !== familiaBuscada) continue;
    const tier = entrada.tier ?? 0;
    if (tier < requisito.tier) continue;
    if (estaRoto(it, entrada)) continue;
    if (tier > mejorTier) {
      mejor = it;
      mejorTier = tier;
    }
  }
  return mejor;
}

/**
 * Cuánto falta (ms, 0 = ya se puede) para el próximo `coger` gateado por
 * herramienta — GDD_Crafteo.md §8 (2026-09-08): antes el `tier` SOLO
 * gateaba el acceso ("aunque hoy da igual" decía el propio comentario de
 * este archivo); ahora una herramienta de tier alto también recolecta más
 * rápido de verdad (`cooldownMs` del catálogo, escalado por tier). Función
 * pura (sin `Date.now()` propio) para poder testearla con timestamps
 * fabricados — `RoomExteriorBase.manejarCoger` es quien la llama con el
 * reloj real y quien recuerda `ultimoMs` por sesión.
 */
export function msFaltantesParaRecolectar(cooldownMs: number, ultimoMs: number, ahoraMs: number): number {
  return Math.max(0, cooldownMs - (ahoraMs - ultimoMs));
}
