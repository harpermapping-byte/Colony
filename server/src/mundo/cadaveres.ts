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

/**
 * Identidad VISUAL del cadáver (pedido 2026-09-01, "el cadáver debe ser el
 * mismo modelo generado de ese personaje/animal concreto... en pose
 * tumbada"): lo mínimo para que el cliente reconstruya el MISMO rig que
 * tenía en vida, en vez de la caja genérica de antes. Se guarda como JSON
 * en `Cadaver.datosVisual` (string, nunca objeto suelto — mismo patrón que
 * `contenedor`/`extra` en el resto del proyecto) porque su forma cambia
 * según `tipoOrigen` y el Schema de Colyseus solo sincroniza un string.
 *
 * - **jugador**: no tiene morfología/color propios hoy (el rig del
 *   jugador vivo es fijo, solo cambia el equipo puesto — game.ts
 *   `crearRigHumanoide({colorTunica: ...})`) — así que "su apariencia" se
 *   reduce honestamente a QUÉ llevaba puesto: `equipo` (slot->itemId,
 *   espejo de `InventarioSchema.equipo`) y `equipoBlueprintRopa`
 *   (slot->id de prenda legendaria del sastre, si llevaba alguna).
 * - **npc**: `slotId` es la clave real en `poblacion.json`/`voxPorSlot`
 *   (cliente) para los civiles con ficha bakeada — HOY nadie mata a esos
 *   (ver límite documentado en GDD_Muerte_Respawn.md); los NPC que sí
 *   mueren hoy (tropas bandidas, guarnición, jefes de mazmorra) no tienen
 *   ficha de poblacion/ real, así que caen honestamente al mismo rig
 *   plano + `equipo` (si lo llevaban) que ya usan en vivo.
 * - **animal**: la fauna SALVAJE (única que muere hoy) ya se renderiza en
 *   vivo con una caja-placeholder por especie (`animalPlaceholder`, sin
 *   vóxel individual — ver su comentario), así que `especieOrigenId` por
 *   sí solo ya reconstruye EXACTAMENTE el mismo aspecto que tenía vivo; no
 *   hace falta ningún dato extra aquí.
 */
export interface DatosVisualJugador {
  equipo?: Record<string, string>;
  equipoBlueprintRopa?: Record<string, number>;
}
export interface DatosVisualNpc {
  /** Clave real en poblacion.json/voxPorSlot (civiles con ficha bakeada) — nadie mata a esos hoy, ver comentario de arriba. */
  slotId?: string;
  /** slot->itemId visualmente puesto (NPC tutorial, mismo mecanismo que el jugador). */
  equipo?: Record<string, string>;
  /** enemigoId + variante del pool de enemigos de mazmorra (client `poolEnemigos`, docs/GDD_Bakeador_Dungeons.md §4) — jefes humanoides de DungeonRoom. */
  enemigoId?: string;
  variante?: number;
}
export type DatosVisualCadaver = DatosVisualJugador | DatosVisualNpc;

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
  /** JSON de `DatosVisualCadaver` (ver arriba), "" (u omitido) si no hace falta ninguno (fauna). */
  datosVisual?: string;
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
  /** Ver `DatosVisualCadaver` — omitido = "" (fauna, o sin datos de apariencia que guardar). */
  datosVisual?: DatosVisualCadaver;
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
    datosVisual: params.datosVisual ? JSON.stringify(params.datosVisual) : "",
  };
}

/** ¿Ya le tocó desaparecer? Se compara siempre contra `muertoEn`, nunca contra si se lootó o no. */
export function cadaverDesaparecio(c: { muertoEn: number }, ahora: number): boolean {
  return ahora - c.muertoEn >= DIAS_HASTA_DESAPARECER_CADAVER;
}
