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
// nombreLower -> conexión ACTIVA más reciente (si el mismo nombre entra en
// dos rooms a la vez —no debería, pero identidad v1 es solo texto libre—
// gana la última: mismo criterio "sin garantías fuertes" ya aceptado en
// todo el sistema de nombre-como-identidad).
const conexionPorNombre = new Map<string, Conexion>();

export function registrarRoom(room: RoomConectable): void {
  rooms.add(room);
}

export function quitarRoom(room: RoomConectable): void {
  rooms.delete(room);
}

export function registrarJugador(nombre: string, room: RoomConectable, sessionId: string): void {
  conexionPorNombre.set(nombre.trim().toLowerCase(), { room, sessionId });
}

/**
 * `sessionId` es OBLIGATORIO para evitar un bug real con nombres duplicados
 * (identidad v1 no los impide, ver comentario de `conexionPorNombre`): si A
 * y B entran con el mismo nombre, B "gana" el registro; si A se desconecta
 * DESPUÉS, un `quitarJugador(nombre)` sin comprobar de quién es borraría el
 * registro de B (que sigue conectado) — solo se borra si la entrada actual
 * sigue siendo la de ESTA sesión.
 */
export function quitarJugador(nombre: string, sessionId: string): void {
  const clave = nombre.trim().toLowerCase();
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
