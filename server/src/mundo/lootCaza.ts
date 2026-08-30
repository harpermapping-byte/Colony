/**
 * Loot de caza (docs/GDD_Caza.md, pedido 2026-08-30; REDISEÑADO 2026-08-30
 * octava pasada) — qué entra en el `Cadaver.contenedor` al morir un animal:
 * un ÚNICO ítem "cadáver entero" (`cadaverItemId`), NUNCA carne/tendones/
 * tripas sueltos directamente. Procesarlo (desollar/despiezar) es cosa de
 * `despiece.ts` — este módulo solo decide QUÉ id de cadáver corresponde a
 * cada especie (`cadaverItemId`/`TABLA_CADAVERES`, la tabla inversa que
 * `despiece.ts` usa para recuperar carne/piel/tamaño solo con el itemId, sin
 * tener que guardar la especie exacta por instancia) y CUÁNTO material da
 * cada tamaño (`TABLA_LOOT_CAZA`). Módulo PURO — sin fs/BD/Colyseus, mismo
 * patrón que `reproduccionFauna.ts`.
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
  grasa: number;
  piel: number;
  trofeo: "cabeza_trofeo_pequena" | "cabeza_trofeo_mediana" | "cabeza_trofeo_grande";
}

// Placeholder de balance (mismo criterio que el resto del proyecto) — más
// categoriaVida, más carne/tendones/tripas/grasa/piel. Esta es la cantidad
// COMPLETA (procesar en mesa_despiece/mesa_corte, docs/GDD_Caza.md); procesar
// en el sitio da una fracción de esto (ver despiece.ts:FRACCION_MATERIAL_CAMPO).
export const TABLA_LOOT_CAZA: Record<CategoriaVidaAnimal, CantidadesLootCaza> = {
  cria: { carne: 1, tendones: 1, tripas: 1, grasa: 1, piel: 1, trofeo: "cabeza_trofeo_pequena" },
  pequeno: { carne: 2, tendones: 1, tripas: 1, grasa: 1, piel: 1, trofeo: "cabeza_trofeo_pequena" },
  mediano: { carne: 4, tendones: 2, tripas: 2, grasa: 2, piel: 2, trofeo: "cabeza_trofeo_mediana" },
  grande: { carne: 7, tendones: 3, tripas: 3, grasa: 4, piel: 3, trofeo: "cabeza_trofeo_grande" },
  alfa: { carne: 12, tendones: 5, tripas: 5, grasa: 6, piel: 5, trofeo: "cabeza_trofeo_grande" },
};

/** 5% de probabilidad, pedido explícito del streamer — fija, no varía por categoría ni por campo/mesa. */
export const PROBABILIDAD_TROFEO = 0.05;

export interface DatosCadaver {
  /** itemId de carne (categoriaRecursoCarne) o `null` si la especie no tenía ninguna catalogada. */
  carne: string | null;
  /** itemId de piel cruda (categoriaRecursoPiel) o `null` si la especie no tenía ninguna catalogada. */
  piel: string | null;
  categoriaVida: CategoriaVidaAnimal;
}

/**
 * itemId del cadáver entero que deja esta especie al morir — codifica
 * carne+piel+tamaño en el propio id, sin tabla de mapeo directa aparte
 * (`generico`/`sinpiel` para especies sin esa categoría catalogada, caso
 * límite real: no todo animales.json tiene ambos campos).
 */
export function cadaverItemId(especie: EstadisticasCombateAnimal): string {
  const carne = especie.categoriaRecursoCarne ?? "generico";
  const piel = especie.categoriaRecursoPiel ?? "sinpiel";
  return `cadaver_${carne}_${piel}_${especie.categoriaVida}`;
}

// Tabla INVERSA de `cadaverItemId` — despiece.ts la necesita para recuperar
// carne/piel/tamaño solo con el itemId del cadáver ya recogido (el jugador
// puede procesarlo mucho después de matar al animal, sin que el servidor
// seas capaz de recordar de qué especie exacta venía sin guardar un campo
// nuevo en ItemInstancia — esta tabla evita esa migración de esquema). Las
// 33 combinaciones son TODAS las que hoy produce `baker/catalogo/animales.json`
// (categoriaRecursoCarne × categoriaRecursoPiel × categoriaVida reales);
// añadir una especie con una combinación nueva exige añadir su fila aquí
// (mismo criterio "las listas crecen" del resto del proyecto).
const TABLA_CADAVERES: Record<string, DatosCadaver> = {
  cadaver_carne_blanca_cuero_reptil_mediano: { carne: "carne_blanca", piel: "cuero_reptil", categoriaVida: "mediano" },
  cadaver_carne_blanca_piel_basta_mediano: { carne: "carne_blanca", piel: "piel_basta", categoriaVida: "mediano" },
  cadaver_carne_blanca_piel_basta_pequeno: { carne: "carne_blanca", piel: "piel_basta", categoriaVida: "pequeno" },
  cadaver_carne_blanca_sinpiel_mediano: { carne: "carne_blanca", piel: null, categoriaVida: "mediano" },
  cadaver_carne_blanca_sinpiel_pequeno: { carne: "carne_blanca", piel: null, categoriaVida: "pequeno" },
  cadaver_carne_caza_mayor_cuero_grueso_grande: { carne: "carne_caza_mayor", piel: "cuero_grueso", categoriaVida: "grande" },
  cadaver_carne_caza_mayor_cuero_reptil_grande: { carne: "carne_caza_mayor", piel: "cuero_reptil", categoriaVida: "grande" },
  cadaver_carne_caza_mayor_piel_fina_grande: { carne: "carne_caza_mayor", piel: "piel_fina", categoriaVida: "grande" },
  cadaver_carne_caza_mayor_piel_invierno_grande: { carne: "carne_caza_mayor", piel: "piel_invierno", categoriaVida: "grande" },
  cadaver_carne_exotica_piel_exotica_grande: { carne: "carne_exotica", piel: "piel_exotica", categoriaVida: "grande" },
  cadaver_carne_exotica_sinpiel_alfa: { carne: "carne_exotica", piel: null, categoriaVida: "alfa" },
  cadaver_carne_exotica_sinpiel_grande: { carne: "carne_exotica", piel: null, categoriaVida: "grande" },
  cadaver_carne_roja_cuero_grueso_grande: { carne: "carne_roja", piel: "cuero_grueso", categoriaVida: "grande" },
  cadaver_carne_roja_piel_basta_mediano: { carne: "carne_roja", piel: "piel_basta", categoriaVida: "mediano" },
  cadaver_carne_roja_piel_fina_grande: { carne: "carne_roja", piel: "piel_fina", categoriaVida: "grande" },
  cadaver_carne_roja_piel_fina_mediano: { carne: "carne_roja", piel: "piel_fina", categoriaVida: "mediano" },
  cadaver_carne_roja_piel_invierno_grande: { carne: "carne_roja", piel: "piel_invierno", categoriaVida: "grande" },
  cadaver_carne_roja_piel_invierno_mediano: { carne: "carne_roja", piel: "piel_invierno", categoriaVida: "mediano" },
  cadaver_carne_roja_sinpiel_mediano: { carne: "carne_roja", piel: null, categoriaVida: "mediano" },
  cadaver_generico_cuero_reptil_pequeno: { carne: null, piel: "cuero_reptil", categoriaVida: "pequeno" },
  cadaver_generico_piel_fina_mediano: { carne: null, piel: "piel_fina", categoriaVida: "mediano" },
  cadaver_generico_piel_fina_pequeno: { carne: null, piel: "piel_fina", categoriaVida: "pequeno" },
  cadaver_generico_sinpiel_alfa: { carne: null, piel: null, categoriaVida: "alfa" },
  cadaver_generico_sinpiel_cria: { carne: null, piel: null, categoriaVida: "cria" },
  cadaver_generico_sinpiel_grande: { carne: null, piel: null, categoriaVida: "grande" },
  cadaver_generico_sinpiel_mediano: { carne: null, piel: null, categoriaVida: "mediano" },
  cadaver_generico_sinpiel_pequeno: { carne: null, piel: null, categoriaVida: "pequeno" },
  cadaver_marisco_sinpiel_alfa: { carne: "marisco", piel: null, categoriaVida: "alfa" },
  cadaver_marisco_sinpiel_pequeno: { carne: "marisco", piel: null, categoriaVida: "pequeno" },
  cadaver_pescado_lago_sinpiel_pequeno: { carne: "pescado_lago", piel: null, categoriaVida: "pequeno" },
  cadaver_pescado_mar_piel_exotica_alfa: { carne: "pescado_mar", piel: "piel_exotica", categoriaVida: "alfa" },
  cadaver_pescado_mar_sinpiel_pequeno: { carne: "pescado_mar", piel: null, categoriaVida: "pequeno" },
  cadaver_pescado_rio_sinpiel_pequeno: { carne: "pescado_rio", piel: null, categoriaVida: "pequeno" },
};

/** `undefined` = itemId que no es un cadáver conocido (o combinación sin dar de alta todavía). */
export function datosDeCadaver(itemId: string): DatosCadaver | undefined {
  return TABLA_CADAVERES[itemId];
}

export interface ResultadoSacrificio {
  carne?: { itemId: string; cantidad: number };
  tendones: number;
  tripas: number;
  grasa: number;
  piel?: { itemId: string; cantidad: number };
  trofeoItemId?: string;
}

/**
 * Sacrificar tu PROPIO animal de granja (docs/GDD_Ganaderia.md) — rendimiento
 * COMPLETO instantáneo (equivalente a procesar en mesa, nunca la fracción de
 * campo de `despiece.ts`) y SIN pasar por el ítem "cadáver entero": es tuyo,
 * ya domesticado, no hace falta cazarlo/transportarlo — mismo criterio
 * "sin oficio" que ya tenía este verbo antes del rediseño de caza.
 */
export function sacrificarAnimalGranja(especie: EstadisticasCombateAnimal, rnd: () => number = Math.random): ResultadoSacrificio {
  const cantidades = TABLA_LOOT_CAZA[especie.categoriaVida];
  const resultado: ResultadoSacrificio = { tendones: cantidades.tendones, tripas: cantidades.tripas, grasa: cantidades.grasa };
  if (especie.categoriaRecursoCarne) resultado.carne = { itemId: especie.categoriaRecursoCarne, cantidad: cantidades.carne };
  if (especie.categoriaRecursoPiel) resultado.piel = { itemId: especie.categoriaRecursoPiel, cantidad: cantidades.piel };
  if (rnd() < PROBABILIDAD_TROFEO) resultado.trofeoItemId = cantidades.trofeo;
  return resultado;
}

/**
 * Rellena el cadáver recién creado con UN ÚNICO ítem "cadáver entero" —
 * nunca carne/tendones/tripas sueltos (eso solo sale de `despiece.ts` al
 * procesarlo). Silencioso si el itemId no existe en catálogo todavía (combo
 * carne×piel×tamaño nuevo sin dar de alta — mismo criterio de "las listas
 * crecen" que el resto del proyecto, no revienta el loot de caza por un
 * hueco de catálogo).
 */
export function rellenarLootCaza(contenedor: Contenedor, catalogo: CatalogoItems, especie: EstadisticasCombateAnimal): void {
  const itemId = cadaverItemId(especie);
  if (!catalogo[itemId]) return;
  agregarItem(contenedor, catalogo, itemId, 1);
}
