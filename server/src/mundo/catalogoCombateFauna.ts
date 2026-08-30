/**
 * Carga `baker/catalogo/animales.json` y lo reduce a estadísticas de combate
 * por especie (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30). A propósito
 * INDEPENDIENTE de `catalogoFaunaSalvaje.ts` (el de reproducción): ese
 * excluye a las crías (no se aparean) pero una cría SÍ tiene vida y puede
 * recibir daño, así que este catálogo cubre TODAS las entradas del bake
 * (adultas, crías y población infinita por igual) — nadie queda sin
 * estadísticas de combate por no participar en la reproducción.
 */
import * as fs from "fs";

export type CategoriaVidaAnimal = "cria" | "pequeno" | "mediano" | "grande" | "alfa";

/** docs/GDD_Ganaderia.md — producto "vivo" que da un animal de granja periódicamente (sin matarlo), vía resolverProduccion. Una especie puede dar varios (oveja: lana Y leche). */
export type CategoriaProductoGranja = "leche" | "huevos" | "lana";

export interface EstadisticasCombateAnimal {
  categoriaVida: CategoriaVidaAnimal;
  vidaMaxima: number;
  ataque: number;
  /** docs/GDD_Combate.md §7 (autosimulación NPC-vs-animal): si esta especie puede iniciar un encuentro hostil con un NPC. */
  peligroso: boolean;
  /** docs/GDD_Mascotas.md — perro/gato (fauna urbana) pueden convertirse en mascota a base de comida; el resto de fauna, no. */
  domesticable: boolean;
  /** docs/GDD_Caza.md — id de items/catalogo/items.json que da el loot automático al matar (carne_roja/carne_blanca/...); ausente = sin carne útil. */
  categoriaRecursoCarne?: string;
  /** docs/GDD_Caza.md — id de items/catalogo/items.json que da desollar el cadáver (cuero_grueso/piel_basta/...); ausente = sin piel útil. */
  categoriaRecursoPiel?: string;
  /** docs/GDD_Ganaderia.md — qué productos "vivos" da esta especie como animal de granja; ausente/vacío = solo carne/piel al sacrificar. */
  categoriaProductoGranja?: CategoriaProductoGranja[];
}

export type CatalogoCombateFauna = Record<string, EstadisticasCombateAnimal>;

interface EntradaCatalogoBaker {
  categoriaVida?: CategoriaVidaAnimal;
  vidaMaxima?: number;
  ataque?: number;
  peligroso?: boolean;
  domesticable?: boolean;
  categoriaRecursoCarne?: string;
  categoriaRecursoPiel?: string;
  categoriaProductoGranja?: CategoriaProductoGranja[];
}

// Relleno si una especie llegara a faltar en el catálogo (no debería pasar
// con el bake actual, pero un animal sin estadísticas no debe romper el
// combate): vida/ataque de un animal pequeño normal, no peligroso, no
// domesticable, sin carne/piel de loot (mejor no dar nada que inventar un recurso).
const RELLENO: EstadisticasCombateAnimal = { categoriaVida: "pequeno", vidaMaxima: 15, ataque: 2, peligroso: false, domesticable: false };

export function estadisticasCombatePorDefecto(): EstadisticasCombateAnimal {
  return { ...RELLENO };
}

export function cargarCatalogoCombateFauna(rutaAnimalesJson: string): CatalogoCombateFauna {
  const raw = JSON.parse(fs.readFileSync(rutaAnimalesJson, "utf8")) as Record<string, EntradaCatalogoBaker>;
  const catalogo: CatalogoCombateFauna = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_nota") || !datos || typeof datos !== "object") continue;
    if (!datos.categoriaVida || datos.vidaMaxima == null || datos.ataque == null) continue;
    catalogo[id] = {
      categoriaVida: datos.categoriaVida,
      vidaMaxima: datos.vidaMaxima,
      ataque: datos.ataque,
      peligroso: !!datos.peligroso,
      domesticable: !!datos.domesticable,
      categoriaRecursoCarne: datos.categoriaRecursoCarne,
      categoriaRecursoPiel: datos.categoriaRecursoPiel,
      categoriaProductoGranja: datos.categoriaProductoGranja,
    };
  }
  return catalogo;
}
