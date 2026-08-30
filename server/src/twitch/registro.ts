/**
 * Registro global de jugadores/rooms conectados — docs/GDD_Twitch.md.
 * Necesario porque un comando de chat o un canje de puntos de canal son
 * GLOBALES (cualquier jugador conectado, en cualquier room), y cada room de
 * Colyseus solo conoce su propio `state.players` — sin esto, `gestorTwitch`
 * no tendría forma de encontrar "el jugador que escribió en el chat" ni de
 * aplicar un evento a "todas las rooms activas ahora mismo".
 *
 * UNA instancia por proceso (mismo criterio que `obtenerContextoGremios`/el
 * tick de economía en `index.ts`) — vive en memoria, nunca se persiste
 * (igual que `inputs`/`inventarios` de cada Room). Tipado contra una
 * interfaz mínima (`RoomConectable`) en vez de `RoomExteriorBase` para
 * poder testear sin levantar Colyseus de verdad.
 */

/** Lo mínimo que este módulo necesita de una Room — RoomExteriorBase la cumple tal cual. */
export interface RoomConectable {
  aplicarEventoTwitch(eventoId: string, activar: boolean): void;
  curarCompleto(sessionId: string): void;
  llenarVital(sessionId: string, vital: "comida" | "bebida"): void;
  vaciarCaca(sessionId: string): void;
  fijarTituloTwitch(sessionId: string, titulo: string): void;
}

interface Conexion {
  room: RoomConectable;
  sessionId: string;
}

const rooms = new Set<RoomConectable>();
// Clave del registro: el LOGIN REAL de Twitch si el jugador entró con login
// (docs/GDD_Twitch.md §7, pedido 2026-08-30 "que se conecte con su cuenta
// de Twitch aunque su PJ tenga otro nombre") — únicos de verdad, sin el
// problema de abajo. Si no hizo login, cae al nombre de su PJ (comportamiento
// de antes, sin cambios): si el mismo nombre de PJ entra en dos rooms a la
// vez —no debería, pero identidad v1 sin login es solo texto libre— gana el
// último, mismo criterio "sin garantías fuertes" ya aceptado en todo el
// sistema de nombre-como-identidad.
const conexionPorNombre = new Map<string, Conexion>();

export function registrarRoom(room: RoomConectable): void {
  rooms.add(room);
}

export function quitarRoom(room: RoomConectable): void {
  rooms.delete(room);
}

/** `twitchLogin` (si el jugador hizo login con Twitch) manda como clave sobre `nombrePj` — ver comentario de `conexionPorNombre`. */
export function registrarJugador(nombrePj: string, room: RoomConectable, sessionId: string, twitchLogin?: string): void {
  conexionPorNombre.set((twitchLogin ?? nombrePj).trim().toLowerCase(), { room, sessionId });
}

/**
 * `sessionId` es OBLIGATORIO para evitar un bug real con nombres de PJ
 * duplicados (identidad v1 sin login no los impide, ver comentario de
 * `conexionPorNombre`): si A y B entran con el mismo nombre, B "gana" el
 * registro; si A se desconecta DESPUÉS, un `quitarJugador(nombre)` sin
 * comprobar de quién es borraría el registro de B (que sigue conectado) —
 * solo se borra si la entrada actual sigue siendo la de ESTA sesión. Mismo
 * `twitchLogin` que en `registrarJugador` — hay que dar la MISMA clave con
 * la que se registró, o no encontrará nada que borrar.
 */
export function quitarJugador(nombrePj: string, sessionId: string, twitchLogin?: string): void {
  const clave = (twitchLogin ?? nombrePj).trim().toLowerCase();
  if (conexionPorNombre.get(clave)?.sessionId === sessionId) conexionPorNombre.delete(clave);
}

export function buscarConexion(nombre: string): Conexion | undefined {
  return conexionPorNombre.get(nombre.trim().toLowerCase());
}

export function jugadoresConectados(): string[] {
  return [...conexionPorNombre.keys()];
}

export function roomsActivas(): RoomConectable[] {
  return [...rooms];
}

/** SOLO para tests: vacía el registro entre casos. */
export function _resetRegistroParaTests(): void {
  rooms.clear();
  conexionPorNombre.clear();
}
