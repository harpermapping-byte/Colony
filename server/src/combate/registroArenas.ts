/**
 * Traspaso del roster de un combate de la room de origen a la room de
 * arena nueva (docs/GDD_Combate.md §9.2) — SIN matchMaker.createRoom: las
 * dos rooms corren en el MISMO proceso (single process, "un solo servidor
 * en Render free"), así que un Map en memoria compartido por todo el
 * módulo basta, mismo espíritu que `obtenerBdCompartida()` (un singleton
 * de proceso, no un sistema de mensajería nuevo). La room de origen escribe
 * el roster al cerrar la ventana de unión; la room de arena lo lee y lo
 * BORRA en su `onCreate` (un roster se consume una sola vez).
 */

export type Bando = "A" | "B";

/** Qué hay que reconstruir en la room de arena si el participante NO es un jugador (fauna/enemigo/npc sin cliente). */
export type TipoEntidadNoJugador = "fauna" | "enemigo" | "npc";

/** Todo lo que el cliente necesita mandar de vuelta para reconstruir la URL exacta de la que salió (docs/GDD_Combate.md §9.2) — opaco para el servidor, solo se relee al volver. */
export type RetornoJugador = Record<string, string | number>;

export interface ParticipanteArena {
  id: string; // sessionId (jugador, en la room de ORIGEN) o clave real (fauna/enemigo)
  bando: Bando;
  esJugador: boolean;
  /** Solo si !esJugador — qué entidad sintética crear en la room de arena para que el motor de combate (que espera Fauna/Enemigo reales) funcione sin cambios. */
  tipoEntidad?: TipoEntidadNoJugador;
  /** Solo si tipoEntidad==="fauna" — mismo especieId que la Fauna real de origen, para que el cliente la pinte igual en la arena. */
  especieId?: string;
  /** Solo si tipoEntidad==="enemigo" — mismos datos visuales que el Enemigo real de origen. */
  enemigoId?: string;
  variante?: number;
  esBoss?: boolean;
  /** Solo si tipoEntidad==="npc" (docs/GDD_Faccion_Bandidos.md §7ter, patrulla bandida) — nombre del Npc real de origen, para reconstruirlo en la arena. */
  nombreNpc?: string;
  /** Solo si esJugador — nombre estable del jugador (sessionId cambia al reconectar a la room nueva; el nombre no). */
  nombreJugador?: string;
  hp: number;
  hpMax: number;
  /**
   * PA máximo YA calculado en la room de origen (`crearUnidadCombate` —
   * Destreza para jugador, PA_MAX_COMBATE_BOSS para enemigo `esBoss`,
   * PA_MAX_COMBATE para el resto). Corrige un bug real (docs/GDD_Combate.md
   * §8, 2026-09-01): antes de este campo, `ArenaCombateRoom.onCreate`
   * hardcodeaba PA_MAX_COMBATE para TODOS al reconstruir la unidad, así que
   * ni la Destreza del jugador ni el PA de boss llegaban a aplicarse nunca
   * en el combate que de verdad se juega turno a turno.
   */
  paMax: number;
  ataqueFisico: number;
  defensaFisica: number;
  alcance: number;
  /** docs/GDD_Mecanicas.md §5.4 (munición a distancia, 2026-09-02) — SOLO esJugador con arma a distancia equipada; ausente/"" = cuerpo a cuerpo. Ver CombateUnidad.municionId. */
  municionId?: string;
  /** Snapshot de cuántas unidades de `municionId` tenía el jugador en su inventario real al entrar en combate — ausente/0 si `municionId` está ausente. */
  municionDisponible?: number;
  /** docs/GDD_Caza.md — presa de modo caza: deambula sin rumbo en la arena, nunca ataca (server/src/combate/arenaCombate.ts::jugarTurnoIAPasiva). Ausente/false = IA normal. */
  pasivo?: boolean;
  /** docs/GDD_Combate.md (2026-09-03) — habilidad por familia de arma, snapshot de `CombateUnidad.habilidadId`. Ausente/"" = sin habilidad reconocida (ataque base). */
  habilidadId?: string;
  /** Solo si esJugador — lo que mandó de vuelta en `combate:iniciar`/`combate:unirse`; se reenvía tal cual al terminar. */
  retorno?: RetornoJugador;
  /** docs/GDD_Barcos.md (pedido 2026-08-30) — solo si esJugador e iba en un barco al entrar en combate acuático: "barco" (el capitán, uno solo) o "nadando" (el resto de la tripulación). Puramente cosmético, ver CombateUnidad.visual. */
  visualCombate?: "barco" | "nadando";
  /** Solo con visualCombate==="barco" — qué modelo de barco pintar. */
  barcoTipoId?: string;
}

export interface RosterArena {
  mapaArenaId: string;
  participantes: ParticipanteArena[];
  /** `this.roomId` de la room de ORIGEN (Colyseus) — para poder recuperarla con matchMaker.getLocalRoomById y quitar el marcador/aplicar resultados al terminar. */
  origenRoomId: string;
}

/**
 * Un roster que nadie llega a reclamar (el cliente que inició el combate se
 * desconecta o cierra la pestaña antes de que `ArenaCombateRoom.onCreate`
 * llegue a pedirlo) se quedaba en `registro` para siempre — encontrado en el
 * testeo de concurrencia de 2026-09-01 (varias sesiones abriendo/cerrando
 * combates sin llegar a entrar a la arena). Fuga pequeña por combate suelto,
 * pero real bajo carga sostenida. Mismo criterio que el resto del proyecto
 * (regla 1 CLAUDE.md, "cálculo perezoso para todo lo que cambia con el
 * tiempo"): nada de `setTimeout`, solo se limpia lo caducado la próxima vez
 * que alguien registra un roster nuevo.
 */
const TTL_ROSTER_MS = 10 * 60 * 1000; // 10 min reales de sobra para que el cliente navegue a la arena.

const registro = new Map<string, { roster: RosterArena; registradoEn: number }>();

export function registrarRosterArena(combateId: string, roster: RosterArena): void {
  const ahora = Date.now();
  for (const [id, entrada] of registro) {
    if (ahora - entrada.registradoEn > TTL_ROSTER_MS) registro.delete(id);
  }
  registro.set(combateId, { roster, registradoEn: ahora });
}

/** Lee y BORRA el roster — se consume una sola vez, al crear la room de arena. */
export function tomarRosterArena(combateId: string): RosterArena | undefined {
  const entrada = registro.get(combateId);
  registro.delete(combateId);
  return entrada?.roster;
}
