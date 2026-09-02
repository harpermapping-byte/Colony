/**
 * Desgaste/durabilidad — PURA (sin Colyseus/fs/Date.now real, recibe el
 * "ahora" como parámetro para poder testear con tiempos fijos), mismo
 * patrón que inventario.ts/construccion.ts. Pedido del streamer
 * 2026-08-29: "cada X días se desgasta un 0.01 sin uso, con uso un poco
 * más cada X usos... si recibe daño armadura... si mueres tus cosas
 * pierden el 20% de la durabilidad".
 *
 * Un ítem SIN `durabilidadMax` en el catálogo NUNCA se desgasta — el
 * campo es opcional a propósito, así los 49 recursos/consumibles de
 * items.json (que no tiene sentido que "se desgasten") quedan intactos
 * sin tocar ni una línea de ellos.
 *
 * Cálculo PEREZOSO (CLAUDE.md regla 1: "generar una vez, nunca en
 * directo"): el desgaste por inactividad NUNCA corre en un tick de
 * fondo — se resuelve la próxima vez que la instancia se toca de verdad
 * (equipar, mover, usar), comparando `ultimoUso` contra el reloj actual.
 */

import { EntradaCatalogoItem, ItemInstancia } from "./inventario";

/** Fracción de durabilidadMax perdida por HORA sin usar el ítem (0.2%/h). */
export const TASA_INACTIVIDAD_HORA = 0.002;
/** Fracción de lo ABSORBIDO por una pieza de armadura que se traduce en desgaste. */
export const FACTOR_DESGASTE_ARMADURA = 0.08;
/** Fracción de durabilidadMax que se pierde de golpe al morir (solo lo EQUIPADO). */
export const PENALIZACION_MUERTE = 0.2;

/** ¿Este ítem tiene durabilidad de verdad (no es un recurso/consumible sin desgaste)? */
export function tieneDurabilidad(entrada: EntradaCatalogoItem): boolean {
  return entrada.durabilidadMax != null && entrada.durabilidadMax > 0;
}

/**
 * Cierra el hueco de inactividad desde `ultimoUso` hasta `ahoraMs` y dejа
 * `ultimoUso` puesto a `ahoraMs` — llamar SIEMPRE antes de tocar la
 * instancia por cualquier motivo (uso, daño, muerte), así el reloj nunca
 * se queda desfasado. No hace nada si el ítem no tiene durabilidad.
 */
export function aplicarDesgasteInactividad(instancia: ItemInstancia, entrada: EntradaCatalogoItem, ahoraMs: number): void {
  if (!tieneDurabilidad(entrada)) return;
  const desde = instancia.ultimoUso ?? ahoraMs;
  const horas = Math.max(0, (ahoraMs - desde) / 3_600_000);
  const actual = instancia.durabilidad ?? entrada.durabilidadMax!;
  const perdida = entrada.durabilidadMax! * TASA_INACTIVIDAD_HORA * horas;
  instancia.durabilidad = Math.max(0, actual - perdida);
  instancia.ultimoUso = ahoraMs;
}

/**
 * Registra `usos` usos directos (un golpe dado con un arma, una tala con
 * un hacha...) — primero cierra el hueco de inactividad (por si llevaba
 * tiempo sin tocarse), luego resta el desgaste de uso.
 */
export function registrarUso(instancia: ItemInstancia, entrada: EntradaCatalogoItem, ahoraMs: number, usos = 1): void {
  if (!tieneDurabilidad(entrada)) return;
  aplicarDesgasteInactividad(instancia, entrada, ahoraMs);
  const porUso = entrada.desgastePorUso ?? 0;
  instancia.durabilidad = Math.max(0, (instancia.durabilidad ?? entrada.durabilidadMax!) - porUso * usos);
}

export interface PiezaEquipada {
  instancia: ItemInstancia;
  entrada: EntradaCatalogoItem;
}

/**
 * Daño absorbido por un golpe recibido, repartido a partes iguales entre
 * las piezas de armadura EQUIPADAS con durabilidad — "más golpes parados,
 * más desgaste". Piezas sin durabilidadMax (ítems cosméticos) no cuentan
 * ni reciben desgaste.
 */
export function aplicarDanoArmadura(piezasEquipadas: PiezaEquipada[], danoAbsorbido: number, ahoraMs: number): void {
  const conDurabilidad = piezasEquipadas.filter((p) => tieneDurabilidad(p.entrada));
  if (conDurabilidad.length === 0 || danoAbsorbido <= 0) return;
  const perdidaPorPieza = (danoAbsorbido * FACTOR_DESGASTE_ARMADURA) / conDurabilidad.length;
  for (const { instancia, entrada } of conDurabilidad) {
    aplicarDesgasteInactividad(instancia, entrada, ahoraMs);
    instancia.durabilidad = Math.max(0, (instancia.durabilidad ?? entrada.durabilidadMax!) - perdidaPorPieza);
  }
}

/**
 * Penalización de muerte: -20% FLAT (no proporcional al golpe que mató)
 * a lo que el jugador llevaba EQUIPADO en ese momento — nunca a lo que
 * hay suelto en la mochila/cuerpo sin equipar.
 */
export function aplicarPenalizacionMuerte(piezasEquipadas: PiezaEquipada[], ahoraMs: number): void {
  for (const { instancia, entrada } of piezasEquipadas) {
    if (!tieneDurabilidad(entrada)) continue;
    aplicarDesgasteInactividad(instancia, entrada, ahoraMs);
    const actual = instancia.durabilidad ?? entrada.durabilidadMax!;
    instancia.durabilidad = Math.max(0, actual - entrada.durabilidadMax! * PENALIZACION_MUERTE);
  }
}

/** ¿Este ítem está roto (durabilidad a 0)? Un ítem sin durabilidadMax nunca se rompe. */
export function estaRoto(instancia: ItemInstancia, entrada: EntradaCatalogoItem): boolean {
  return tieneDurabilidad(entrada) && (instancia.durabilidad ?? entrada.durabilidadMax!) <= 0;
}

/**
 * Factor 0..1 de rendimiento efectivo por desgaste — multiplica
 * ataque/defensa antes de romperse del todo (no es un interruptor
 * binario: un arma al 50% de durabilidad ya rinde la mitad). Ítems sin
 * durabilidadMax siempre rinden al 100%.
 */
export function factorDurabilidad(instancia: ItemInstancia, entrada: EntradaCatalogoItem): number {
  if (!tieneDurabilidad(entrada)) return 1;
  return Math.max(0, (instancia.durabilidad ?? entrada.durabilidadMax!) / entrada.durabilidadMax!);
}
