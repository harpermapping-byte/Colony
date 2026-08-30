/**
 * Cocina — PURO (sin Colyseus/BD/fs), mismo patrón que cultivo.ts.
 * Pedido del streamer 2026-08-30: cocinar un ingrediente crudo tal cual al
 * fuego (sencillo, boost modesto) o combinar varios en una vasija (cuenco/
 * cazuela/olla) para un plato — "cada ingrediente ya creado asignamos SÍ O
 * SÍ stats aleatorias de +stamina +vida +hambre +bebida... se fomenta que
 * se combinen materiales diferentes, como planta y carne, da más stats de
 * bonus". El nombre se genera automático; la identidad del plato (mismo
 * nombre/itemId reusado) se cachea por el CONJUNTO de tipos de ingrediente
 * usados — misma receta siempre da el mismo plato, más cantidad solo da
 * más raciones (ver RoomExteriorBase.ts, tabla `platos_creados`).
 */

import { AportesCocina } from "../inventario/inventario";

export type OrigenCocina = "vegetal" | "animal";

export interface IngredienteEnVasija {
  itemId: string;
  cantidad: number;
}

/**
 * Estado persistido en `viva.extra.cocina` de una vasija (cuenco/cazuela/
 * olla) — vacía = `{ ingredientes: [] }`. Pedido explícito del streamer
 * (2026-08-30): "para hacer guisos y sopas necesitas llenar la olla de
 * agua y ponerla al fuego hasta que se caliente (un tiempo determinado)"
 * — `conAgua`/`calentandoDesde` trackean ese paso; `cocina:anadir` lo
 * exige ANTES de dejar meter ingredientes (ver `estaHirviendo`).
 */
export interface EstadoCocina {
  ingredientes: IngredienteEnVasija[];
  /** true desde que se llena de agua — se vacía de golpe (junto con los ingredientes) al preparar un plato. */
  conAgua?: boolean;
  /** epoch ms de cuándo se puso al fuego (mismo instante que `conAgua` pasa a true) — el hervor se DERIVA de esto, nunca se guarda un booleano aparte. */
  calentandoDesde?: number;
}

export interface IngredienteCocina {
  itemId: string;
  cantidad: number;
  aportes: AportesCocina;
  origen: OrigenCocina;
}

/** Cuántas unidades totales de ingredientes hacen falta por cada ración del plato. */
export const UNIDADES_POR_PLATO = 2;
/** Multiplicador aplicado a los 4 ejes cuando la vasija mezcla AL MENOS un ingrediente vegetal y uno animal. */
export const BONUS_MEZCLA = 1.2;
/** Boost de "cocinar tal cual" sobre el aporte crudo del ingrediente (sencillo, al fuego, sin vasija). */
export const BOOST_COCINA_SIMPLE = 1.5;
/** Tiempo REAL (no día de mundo, esto es un fogón encendido AHORA) que tarda el agua de una vasija en hervir desde que se llena — "un tiempo determinado", pedido explícito. */
export const TIEMPO_HERVIR_MS = 20_000;

/** ¿Ya hierve el agua de la vasija? false si nunca se llenó. */
export function estaHirviendo(estado: EstadoCocina, ahoraMs: number): boolean {
  return !!estado.conAgua && estado.calentandoDesde != null && ahoraMs - estado.calentandoDesde >= TIEMPO_HERVIR_MS;
}

/** Segundos que faltan para que hierva — 0 si ya hierve o si no tiene agua puesta todavía. */
export function segundosParaHervir(estado: EstadoCocina, ahoraMs: number): number {
  if (!estado.conAgua || estado.calentandoDesde == null) return 0;
  return Math.max(0, Math.ceil((TIEMPO_HERVIR_MS - (ahoraMs - estado.calentandoDesde)) / 1000));
}

export interface ResultadoCoccion extends AportesCocina {
  platos: number;
  mezclaBonus: boolean;
}

/**
 * Adaptador para el bocadillo (cocina v2): sus "ingredientes" son cosas ya
 * cocinadas (rebanada_pan, quesos, asados, ensaladas...) con `restauraMultiple`
 * en vez de `aportesCocina` — misma forma salvo que `comida` es opcional ahí.
 * Reusa `cocinarPlato` tal cual sin duplicar la fórmula de combinación.
 */
export function aportesDesdeRestaura(r: { vida?: number; estamina?: number; comida?: number; bebida?: number }): AportesCocina {
  return { vida: r.vida, estamina: r.estamina, comida: r.comida ?? 0, bebida: r.bebida };
}

/** "Cocinar tal cual" — boost modesto sobre el aporte crudo, un único ingrediente, sin vasija. */
export function cocinarSimple(aportes: AportesCocina): AportesCocina {
  const boost = (v: number | undefined) => (v == null ? undefined : Math.ceil(v * BOOST_COCINA_SIMPLE));
  return {
    vida: boost(aportes.vida),
    estamina: boost(aportes.estamina),
    comida: Math.ceil(aportes.comida * BOOST_COCINA_SIMPLE),
    bebida: boost(aportes.bebida),
  };
}

/**
 * Cocina lo que hay en la vasija: raciones = unidades totales / UNIDADES_POR_PLATO
 * (redondeo hacia abajo, mínimo 1 si hay algo), TOPADAS en `capacidadMax` si
 * se da (pedido 2026-08-30: "cada olla puede dar 6 cuencos llenos" — la
 * capacidad de la vasija, ya usada para limitar tipos de ingrediente
 * distintos, también topa cuántas raciones salen de un solo lote). Cada eje
 * del plato = MEDIA de los aportes de los tipos de ingrediente DISTINTOS
 * presentes (la cantidad de cada uno solo cuenta para las raciones, no para
 * la calidad del plato — misma receta = mismo plato siempre, decisión
 * explícita de diseño, ver cabecera), × BONUS_MEZCLA si hay vegetal Y
 * animal a la vez.
 */
export function cocinarPlato(ingredientes: IngredienteCocina[], capacidadMax?: number): ResultadoCoccion {
  const totalUnidades = ingredientes.reduce((suma, i) => suma + i.cantidad, 0);
  const platosSinTope = totalUnidades > 0 ? Math.max(1, Math.floor(totalUnidades / UNIDADES_POR_PLATO)) : 0;
  const platos = capacidadMax != null && platosSinTope > 0 ? Math.min(platosSinTope, capacidadMax) : platosSinTope;
  const distintos = ingredientes.length || 1;
  const mezclaBonus = ingredientes.some((i) => i.origen === "vegetal") && ingredientes.some((i) => i.origen === "animal");
  const factor = mezclaBonus ? BONUS_MEZCLA : 1;

  const media = (clave: keyof AportesCocina): number => {
    const suma = ingredientes.reduce((s, i) => s + (i.aportes[clave] ?? 0), 0);
    return Math.round((suma / distintos) * factor);
  };

  return {
    platos,
    vida: media("vida"),
    estamina: media("estamina"),
    comida: Math.max(1, media("comida")),
    bebida: media("bebida"),
    mezclaBonus,
  };
}

/**
 * Clave de identidad de una receta: la FAMILIA de plato (ver `familiaDePlato`
 * más abajo) + los itemId DISTINTOS presentes, ordenados — la cantidad de
 * cada uno no forma parte de la identidad (ver cabecera). La familia forma
 * parte de la clave a propósito (corrección 2026-08-30 respecto a v1): sin
 * ella, cocinar "carne_roja" sola en una olla (Sopa) y luego en un
 * cuenco_barro_grande (Frito) reusarían el MISMO itemId cacheado — dos
 * platos claramente distintos deben tener identidades distintas aunque
 * compartan ingredientes.
 */
export function clavePlato(familia: string, itemIds: string[]): string {
  return `${familia}:${[...new Set(itemIds)].sort().join("|")}`;
}

/** itemId -> texto legible, mismo criterio que cultivo.ts::nombreLegible (duplicado a propósito: 3 líneas, no vale la pena acoplar dos módulos independientes por esto). */
function nombreLegible(itemId: string): string {
  return itemId
    .replace(/_/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Familia de plato — decide la clave/nombre. Cocina v2 (2026-08-30): más
 * tipos de vasija que las 3 originales (cuenco/cazuela/olla), así que el
 * catálogo (`cocina.vasija` en exteriores.json) usa un string libre en vez
 * de un enum cerrado — esta tabla es el único sitio que traduce ese id a
 * una familia de nombre. `olla_grande` comparte familia "sopa" con `olla`
 * (misma familia, más escala); `cuenco_grande` (sartén) es la única
 * DINÁMICA: "Frito" si TODOS los ingredientes son de origen animal (carne/
 * pescado/huevo a la sartén), si no "Estofado" (mezcla o solo vegetal).
 */
export type FamiliaPlato = "sopa" | "guiso" | "estofado" | "frito" | "batido" | "ensalada" | "bocadillo";

const PREFIJOS: Record<FamiliaPlato, string> = {
  sopa: "Sopa",
  guiso: "Guiso",
  estofado: "Estofado",
  frito: "Frito",
  batido: "Batido",
  ensalada: "Ensalada",
  bocadillo: "Bocadillo",
};

const FAMILIA_FIJA_POR_VASIJA: Record<string, FamiliaPlato | undefined> = {
  cuenco: "sopa",
  cazuela: "guiso",
  olla: "sopa",
  olla_grande: "sopa",
  tinaja: "batido",
};

/** Familia de plato que sale de una vasija concreta — fija para la mayoría, dinámica (frito/estofado) para `cuenco_grande` según el origen de los ingredientes metidos. */
export function familiaDePlato(vasija: string, ingredientes: { origen: OrigenCocina }[]): FamiliaPlato {
  const fija = FAMILIA_FIJA_POR_VASIJA[vasija];
  if (fija) return fija;
  if (vasija === "cuenco_grande") {
    return ingredientes.length > 0 && ingredientes.every((i) => i.origen === "animal") ? "frito" : "estofado";
  }
  return "estofado";
}

/** Palabra del nombre que corresponde a una familia — "Sopa"/"Guiso"/"Estofado"/"Frito"/"Batido"/"Ensalada"/"Bocadillo". */
export function prefijoDe(familia: FamiliaPlato): string {
  return PREFIJOS[familia];
}

/** Nombre automático del plato a partir de un prefijo YA resuelto (ver `prefijoDe`) — los ingredientes distintos deciden el resto. */
export function nombrePlato(prefijo: string, itemIdsIngredientes: string[]): string {
  const nombres = [...new Set(itemIdsIngredientes)].map(nombreLegible);
  if (nombres.length === 1) return `${prefijo} de ${nombres[0]}`;
  if (nombres.length === 2) return `${prefijo} de ${nombres[0]} y ${nombres[1]}`;
  return `${prefijo} de ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * Categorías de `categoriaRecurso` (items.json) admitidas en la tinaja de
 * batidos — pedido explícito: "obviamente no con carne no con cosas que no
 * tengan sentido para hacer un batido, sobre todo bayas y frutas". `leche`
 * no lleva categoriaRecurso (recurso vivo, ver items.json) así que se
 * admite por itemId exacto aparte de esta lista.
 */
const CATEGORIAS_BATIDO = new Set(["baya", "fruta", "fruta_cultivada"]);

/** ¿Puede este ingrediente entrar en una tinaja de batidos? `leche` siempre; el resto solo fruta/baya por categoriaRecurso. Para cualquier otra vasija, siempre true (sin filtro). */
export function aceptaEnVasija(vasija: string, itemId: string, categoriaRecurso: string | undefined): boolean {
  if (vasija !== "tinaja") return true;
  return itemId === "leche" || (categoriaRecurso != null && CATEGORIAS_BATIDO.has(categoriaRecurso));
}

/** Categorías de `categoriaRecurso` cortables en ensalada (cuenco + cuchillo, sin cocinar) — hortalizas y fruta cruda, nunca carne/pescado/cereal. */
const CATEGORIAS_ENSALADA = new Set(["hortaliza", "baya", "fruta", "fruta_cultivada"]);

/** ¿Se puede cortar este ingrediente en una ensalada? */
export function aptoParaEnsalada(categoriaRecurso: string | undefined): boolean {
  return categoriaRecurso != null && CATEGORIAS_ENSALADA.has(categoriaRecurso);
}
