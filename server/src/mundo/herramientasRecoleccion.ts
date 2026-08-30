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
};

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
