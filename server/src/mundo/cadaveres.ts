/**
 * Cadáveres — pedido del streamer 2026-08-30: cuando un animal, NPC o
 * jugador muere (pierde toda su vida), deja de contar como esa entidad
 * viva y aparece un cadáver lootable en su sitio, con inventario. Mismo
 * tamaño de inventario para TODOS los cadáveres, sea cual sea el origen
 * — el contenido en sí ("ya veremos qué sale ahí") es una decisión
 * aparte, todavía sin tomar; este módulo solo crea el contenedor VACÍO,
 * listo para que otro sistema lo rellene cuando se diseñe el loot. El
 * cadáver desaparece 1 día in-game después de morir, se haya lootado
 * entero o no.
 *
 * Módulo PURO — mismo patrón que reproduccionFauna.ts: sin BD, sin
 * Colyseus, y sobre todo sin saber CUÁNDO ni CÓMO muere algo (eso
 * depende de un sistema de combate que todavía no existe). Esto solo
 * modela qué pasa DESPUÉS de la muerte — el punto de enganche para
 * cuando el combate exista es una única llamada a `crearCadaver`.
 */
import { Contenedor, crearContenedor } from "../inventario/inventario";

// Tamaño único de inventario para cualquier cadáver (animal, NPC o
// jugador) — pedido explícito "todos mismo tamaño de inventario". Cifra
// de referencia (12 huecos), ajustable igual que el resto de números de
// esta serie de pedidos.
export const ANCHO_INVENTARIO_CADAVER = 4;
export const ALTO_INVENTARIO_CADAVER = 3;

// "Al lootearlo entero o no, y pasar 1 día in-game, desaparece" — el
// cadáver no dura más por vaciarlo antes, ni menos por dejarlo lleno.
export const DIAS_HASTA_DESAPARECER_CADAVER = 1;

export type TipoOrigenCadaver = "animal" | "npc" | "jugador";

export interface Cadaver {
  id: string;
  mapaId: string;
  tipoOrigen: TipoOrigenCadaver;
  /** especieId (fauna), npcId, o nombre de jugador — de quién era este cadáver. */
  especieOrigenId: string;
  x: number;
  y: number;
  /** día de mundo fraccional (ver reproduccionFauna.ts: diaFraccional) en que murió. */
  muertoEn: number;
  contenedor: Contenedor;
}

/** Crea un cadáver con el inventario vacío del tamaño estándar, en el sitio y momento en que murió el origen. */
export function crearCadaver(params: {
  id: string;
  mapaId: string;
  tipoOrigen: TipoOrigenCadaver;
  especieOrigenId: string;
  x: number;
  y: number;
  ahora: number;
}): Cadaver {
  return {
    id: params.id,
    mapaId: params.mapaId,
    tipoOrigen: params.tipoOrigen,
    especieOrigenId: params.especieOrigenId,
    x: params.x,
    y: params.y,
    muertoEn: params.ahora,
    contenedor: crearContenedor(ANCHO_INVENTARIO_CADAVER, ALTO_INVENTARIO_CADAVER),
  };
}

/** ¿Ya le tocó desaparecer? Se compara siempre contra `muertoEn`, nunca contra si se lootó o no. */
export function cadaverDesaparecio(c: { muertoEn: number }, ahora: number): boolean {
  return ahora - c.muertoEn >= DIAS_HASTA_DESAPARECER_CADAVER;
}
