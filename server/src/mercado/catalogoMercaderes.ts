/**
 * Mercaderes NPC POR OFICIO (docs/GDD_Economia.md §9, pedido 2026-08-31) —
 * reemplaza el catálogo plano "tienda general" v1 (catalogoNpcComercio.ts):
 * cada oficio tiene un pool de artículos candidatos con un precioBase fijado
 * a mano en `catalogoMercaderes.json`; cada NPC con ese oficio elige un
 * subconjunto DETERMINISTA de su pool (mismo npcId = misma selección
 * siempre, vía PRNG mulberry32 sembrado en npcId+oficio — mismo criterio
 * "nada de Math.random() para identidad" que el resto del proyecto, aunque
 * esto no sea un bake offline: es la IDENTIDAD del mercader, no economía
 * viva) y vende/compra CADA artículo elegido a precios derivados del mismo
 * precioBase: vende a ×MARGEN_VENTA, compra a ×MARGEN_COMPRA — pedido
 * literal del streamer: "si pactas precio de algo en X pues el vendedor lo
 * vende a 20% más y compra por 50% menos, y la gracia es que así las
 * tiendas de player tienen margen de poner precio decente de X".
 */
import * as fs from "fs";
import * as path from "path";

const RUTA_CATALOGO = path.join(__dirname, "catalogoMercaderes.json");

/** El jugador paga precioBase × esto por unidad. */
export const MARGEN_VENTA_MERCADER = 1.2;
/** El NPC paga precioBase × esto por unidad (con SU PROPIO saldo, ver bd.ts venderANpc). */
export const MARGEN_COMPRA_MERCADER = 0.5;

/** Ventana de reinicio DIARIO REAL (Date.now(), NUNCA día de mundo — pedido explícito: "no ligado al reloj de mundo"). */
export const VENTANA_RESET_MERCADER_MS = 24 * 60 * 60 * 1000;

export interface EntradaOficioMercader {
  /** itemId → precioBase Farycoins/unidad. */
  pool: Record<string, number>;
  /** Overrides opcionales de config para este oficio en concreto (sin usar hoy, listos para cuando el streamer quiera afinar uno). */
  stockMin?: number;
  stockMax?: number;
  limiteCompraDiario?: number;
}

interface ConfigMercaderes {
  itemsPorMercaderMin: number;
  itemsPorMercaderMax: number;
  stockMinDefecto: number;
  stockMaxDefecto: number;
  limiteCompraDiarioDefecto: number;
}

interface CatalogoMercaderesBruto {
  config: ConfigMercaderes;
  oficios: Record<string, EntradaOficioMercader>;
}

let cache: CatalogoMercaderesBruto | null = null;

export function cargarCatalogoMercaderes(): CatalogoMercaderesBruto {
  if (!cache) cache = JSON.parse(fs.readFileSync(RUTA_CATALOGO, "utf8")) as CatalogoMercaderesBruto;
  return cache;
}

/** ¿Este oficio tiene pool de mercader real (no solo flavor)? */
export function esOficioMercader(oficio: string | undefined, catalogo: CatalogoMercaderesBruto = cargarCatalogoMercaderes()): boolean {
  return !!oficio && !!catalogo.oficios[oficio];
}

/** PRNG determinista pequeño (mulberry32) — misma fórmula que interiores/src/azar.js::crearPRNG (ver server/src/personaje/nombresNpc.ts, server/src/personaje/companeros.ts: cada módulo la porta suelta a propósito, sin dependencia cruzada). */
function crearPRNG(semillaTexto: string): () => number {
  let h = 1779033703 ^ semillaTexto.length;
  for (let i = 0; i < semillaTexto.length; i++) {
    h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function siguiente(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Subconjunto determinista de artículos que este NPC concreto ofrece —
 * SIEMPRE el mismo para el mismo `npcId`+`oficio` (identidad del mercader,
 * no cambia con el reinicio diario de stock). Tamaño entre
 * itemsPorMercaderMin y ...Max de config (acotado al tamaño real del pool,
 * que hoy es más pequeño que 10 en varios oficios).
 */
export function elegirArticulosDeMercader(
  npcId: string,
  oficio: string,
  entrada: EntradaOficioMercader,
  config: ConfigMercaderes = cargarCatalogoMercaderes().config,
): string[] {
  const idsOrdenados = Object.keys(entrada.pool).sort();
  const rnd = crearPRNG(`${npcId}|${oficio}|mercader`);
  const minDeseado = Math.min(config.itemsPorMercaderMin, idsOrdenados.length);
  const maxDeseado = Math.min(config.itemsPorMercaderMax, idsOrdenados.length);
  const objetivo = minDeseado + Math.floor(rnd() * (maxDeseado - minDeseado + 1));

  // Fisher-Yates determinista con la MISMA rnd (misma semilla = mismo orden siempre).
  const barajado = [...idsOrdenados];
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  return barajado.slice(0, objetivo).sort();
}

export function precioVentaMercader(precioBase: number): number {
  return Math.max(1, Math.round(precioBase * MARGEN_VENTA_MERCADER));
}

export function precioCompraMercader(precioBase: number): number {
  return Math.max(0, Math.round(precioBase * MARGEN_COMPRA_MERCADER));
}

// --- Oferta/demanda REAL (pedido 2026-08-31: "guarda el tema de precios de
// mercader por oferta real... aplicarlo aquí") — el precio que de verdad se
// cobra/paga se recalcula tras CADA compra/venta a partir del stock que
// queda, reusando las columnas que ya existían (`tenderete_items.cantidad`
// para el stock de venta del NPC, y ese mismo contador reaprovechado como
// "presupuesto de compra restante hoy" en el pool de compra) — nada de
// tabla ni tracking nuevo, la propia cantidad restante YA ES la señal de
// volumen. Determinista en la fórmula, no en el resultado (depende de lo
// que compren/vendan los jugadores en vivo — economía viva, igual que el
// reinicio diario de stock).

/** Techo de la subida de precio de venta cuando el stock se agota del todo (+50% sobre el ×1.2 normal). */
export const ESCASEZ_PRIME_MAX = 0.5;
/** Techo de la bajada de precio de compra cuando el NPC ya cubrió casi todo su cupo diario de hoy (-40% sobre el ×0.5 normal). */
export const DEMANDA_DESCUENTO_MAX = 0.4;

/** Precio de venta (NPC→jugador) con recargo por escasez: cuanto menos stock queda, más caro — hasta ESCASEZ_PRIME_MAX de recargo con el stock a 0. */
export function precioVentaConEscasez(precioBase: number, stockActual: number, stockMax: number): number {
  const ratio = stockMax > 0 ? Math.max(0, Math.min(1, stockActual / stockMax)) : 1;
  const factor = 1 + ESCASEZ_PRIME_MAX * (1 - ratio);
  return Math.max(1, Math.round(precioVentaMercader(precioBase) * factor));
}

/** Precio de compra (jugador→NPC) con descuento por demanda: cuanto más ha comprado ya el NPC hoy de este artículo, menos paga por el siguiente — hasta DEMANDA_DESCUENTO_MAX de descuento con el cupo a 0. */
export function precioCompraConDemanda(precioBase: number, presupuestoRestante: number, limiteDiario: number): number {
  const ratio = limiteDiario > 0 ? Math.max(0, Math.min(1, presupuestoRestante / limiteDiario)) : 1;
  const factor = 1 - DEMANDA_DESCUENTO_MAX * (1 - ratio);
  return Math.max(0, Math.round(precioCompraMercader(precioBase) * factor));
}

export function rangoStockMercader(entrada: EntradaOficioMercader, config: ConfigMercaderes = cargarCatalogoMercaderes().config): [number, number] {
  return [entrada.stockMin ?? config.stockMinDefecto, entrada.stockMax ?? config.stockMaxDefecto];
}

export function limiteCompraDiarioMercader(entrada: EntradaOficioMercader, config: ConfigMercaderes = cargarCatalogoMercaderes().config): number {
  return entrada.limiteCompraDiario ?? config.limiteCompraDiarioDefecto;
}

/** Entero aleatorio en [min,max] — reinicio de stock diario es economía VIVA (mismo criterio ya usado por el loot 1-20 de Farycoins, docs/GDD_Economia.md §5: Math.random() en vivo, no "generación" offline). */
export function stockAleatorioEnRango(min: number, max: number, rnd: () => number = Math.random): number {
  if (max <= min) return Math.max(0, Math.round(min));
  return Math.round(min + rnd() * (max - min));
}
