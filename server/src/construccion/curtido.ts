/**
 * Encurtido de pieles (docs/GDD_Caza.md, pedido 2026-08-30) — PURA (sin
 * Colyseus/BD/fs), mismo patrón que produccion.ts/crafteo.ts: cada mueble
 * curtidor (cubo_sal, barril_curtido) procesa UN ÚNICO lote a la vez,
 * resuelto por timestamp cuando alguien lo toca — sin tick de servidor.
 *
 * Pipeline completo (docs/GDD_Caza.md): piel_cruda -> [cubo_sal, con sal a
 * granel] -> piel_salada -> [cuchillo_desollar, acción instantánea] ->
 * piel_raspada -> [barril_curtido, con curtiente a granel] -> cuero_curtido.
 */
import { CatalogoItems } from "../inventario/inventario";
import { EntradaCurtidor } from "./catalogo";

export interface EstadoCurtidor {
  /** Material a granel cargado (sal en cubo_sal, curtiente en barril_curtido) — se consume al iniciar un lote, nunca decae solo. */
  stock: number;
  /** Lote de pieles en proceso, o ausente si el mueble está vacío. */
  lote?: {
    cantidad: number;
    /** epoch ms real (Date.now()) — NUNCA horas de mundo, mismo criterio que cadaveres.ts/desgaste.ts. */
    iniciadoEn: number;
  };
}

export function estadoCurtidorInicial(): EstadoCurtidor {
  return { stock: 0 };
}

/** ¿Acepta este mueble el itemId que el jugador intenta meter? Por itemId exacto o por familiaMaterial+tier (cualquier piel cruda). */
export function aceptaEntradaCurtidor(datos: EntradaCurtidor, itemId: string, catalogo: CatalogoItems): boolean {
  if (datos.entradaItemId) return itemId === datos.entradaItemId;
  const entrada = catalogo[itemId];
  if (!entrada || !datos.entradaFamilia) return false;
  if (entrada.familiaMaterial !== datos.entradaFamilia) return false;
  if (datos.entradaTier !== undefined && entrada.tier !== datos.entradaTier) return false;
  return true;
}

/** Cuánto stock de `materialCarga` cabe todavía sin superar `capacidadMaxMaterial` — nunca negativo. */
export function huecoMaterialCurtidor(estado: EstadoCurtidor, datos: EntradaCurtidor): number {
  return Math.max(0, datos.capacidadMaxMaterial - estado.stock);
}

/**
 * Arranca un lote nuevo: exige que NO haya ya un lote en curso y que el
 * stock a granel cubra `cantidad * materialPorUnidad`. No muta `estado`
 * (devuelve uno nuevo); `null` si no se puede arrancar.
 */
export function iniciarLoteCurtidor(estado: EstadoCurtidor, datos: EntradaCurtidor, cantidad: number, ahoraMs: number): EstadoCurtidor | null {
  if (estado.lote || cantidad <= 0) return null;
  const costeMaterial = cantidad * datos.materialPorUnidad;
  if (estado.stock < costeMaterial) return null;
  return { stock: estado.stock - costeMaterial, lote: { cantidad, iniciadoEn: ahoraMs } };
}

/** ¿Ya pasó `datos.horas` desde que se inició el lote en curso? `false` si no hay ningún lote. */
export function curtidorListo(estado: EstadoCurtidor, datos: EntradaCurtidor, ahoraMs: number): boolean {
  if (!estado.lote) return false;
  return ahoraMs - estado.lote.iniciadoEn >= datos.horas * 3_600_000;
}

/** Recolecta el lote terminado: `null` si no hay lote o todavía no está listo. Devuelve el nuevo estado (vacío) y cuánto entregar. */
export function recolectarLoteCurtidor(estado: EstadoCurtidor, datos: EntradaCurtidor, ahoraMs: number): { estado: EstadoCurtidor; cantidad: number } | null {
  if (!curtidorListo(estado, datos, ahoraMs)) return null;
  return { estado: { stock: estado.stock }, cantidad: estado.lote!.cantidad };
}
