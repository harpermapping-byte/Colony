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

/** Qué hay que reconstruir en la room de arena si el participante NO es un jugador (fauna/enemigo sin cliente). */
export type TipoEntidadNoJugador = "fauna" | "enemigo";

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
  /** Solo si esJugador — nombre estable del jugador (sessionId cambia al reconectar a la room nueva; el nombre no). */
  nombreJugador?: string;
  hp: number;
  hpMax: number;
  ataqueFisico: number;
  defensaFisica: number;
  alcance: number;
  /** docs/GDD_Caza.md — presa de modo caza: deambula sin rumbo en la arena, nunca ataca (server/src/combate/arenaCombate.ts::jugarTurnoIAPasiva). Ausente/false = IA normal. */
  pasivo?: boolean;
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

const registro = new Map<string, RosterArena>();

export function registrarRosterArena(combateId: string, roster: RosterArena): void {
  registro.set(combateId, roster);
}

/** Lee y BORRA el roster — se consume una sola vez, al crear la room de arena. */
export function tomarRosterArena(combateId: string): RosterArena | undefined {
  const r = registro.get(combateId);
  registro.delete(combateId);
  return r;
}
