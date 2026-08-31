/**
 * Mesas de MINIJUEGO (docs/GDD_Mesas_Minijuego.md) — mobiliario JUGABLE
 * craftable y colocable (mesa_ajedrez hoy; damas/blackjack/otros a futuro
 * con el MISMO esqueleto). No confundir con una "mesa" de OFICIO (yunque,
 * banco_carpintero, mesa_delineante...) — aquí "mesa" es el mueble de juego.
 *
 * Verificado leyendo `interiores/src/colocarElementos.js::anclaAdmite()`
 * antes de diseñar esto: `childSlots`/`anclaAdmite` es el mecanismo que usa
 * el BAKEADOR OFFLINE de interiores para sentar sillas junto a una mesa al
 * generar una sala (colocación NPC, determinista por semilla) — nunca se
 * importa desde `server/src/construccion/` ni desde `RoomExteriorBase.ts`,
 * así que NO aplica a la colocación en vivo del jugador (`"construir"`,
 * GDD_Construccion §4-5). Por eso una mesa de minijuego es UNA sola pieza
 * fusionada (mesa + N asientos en su huella) con las posiciones de los
 * asientos como offsets FIJOS aquí, en vez de depender de ese mecanismo.
 *
 * Rotación de un asiento: `construccion.ts::huellaRotada`/`casillasDe` les
 * basta con la caja final [ancho,largo] (una huella lisa no tiene "lados"
 * distintos) — pero un asiento es un PUNTO con una dirección de mirada, así
 * que hace falta rotar la posición de verdad, no solo intercambiar ejes.
 * Fórmula derivada a mano (mismo convenio "rot = x90° horario" que ya usa
 * `casillasDe`, con (x,y) = esquina noroeste de la huella YA rotada):
 *
 * Para un punto (dx,dy) local a la huella SIN rotar [W,H] (W=ancho,
 * H=largo), rotado `rot` cuartos de vuelta horarios sobre sí misma:
 *   rot 0: (dx, dy)
 *   rot 1: (H-dy, dx)
 *   rot 2: (W-dx, H-dy)
 *   rot 3: (dy, W-dx)
 * (verificable esquina a esquina: la NW original pasa a NE en rot 1, a SE
 * en rot 2, a SW en rot 3 — exactamente lo que hace girar una tarjeta
 * rectangular en el sentido horario). Un vector de dirección (sin
 * traslación) rota con la misma regla aplicada `rot` veces sobre sí mismo:
 * un paso de 90° horario manda (dx,dy) -> (-dy,dx) (Norte->Este->Sur->
 * Oeste->Norte). Ambas fórmulas están cubiertas por
 * `server/test/mesasJuego.test.ts` (permanecen dentro de la huella rotada
 * para los 4 rot, no se solapan entre sí).
 */

export type Silla = "blancas" | "negras";

export interface OffsetSilla {
  /** Offset LOCAL a la huella sin rotar (puede ser fraccionario: el centro de una celda). */
  dx: number;
  dy: number;
  /** Vector unitario hacia dónde mira el asiento sin rotar (típicamente hacia la mesa). */
  mirandoDx: number;
  mirandoDy: number;
}

export interface DefinicionMesaJuego {
  /** [ancho, largo] en casillas, SIN rotar — debe coincidir con la huella real del mueble en interiores/catalogo/elementos.json. */
  huella: [number, number];
  sillas: Record<Silla, OffsetSilla>;
}

/**
 * Catálogo de mesas de minijuego — CRECE por entrada, nunca por código
 * nuevo (regla 7 del CLAUDE.md): un futuro "mesa_damas"/"mesa_blackjack"
 * solo necesita una entrada más aquí + su propio motor de reglas puro
 * (mismo patrón que `ajedrez.ts`) + su propio panel de cliente.
 *
 * mesa_ajedrez: huella [3,2] — mesa 2x1 al centro con un taburete pegado a
 * cada lado corto (oeste/este), mirando el uno al otro por encima de la
 * mesa. dy=1.0 cae en el centro vertical (largo=2); dx=0.5/2.5 caen a medio
 * paso de cada borde corto (ancho=3).
 */
export const MESAS_JUEGO: Record<string, DefinicionMesaJuego> = {
  mesa_ajedrez: {
    huella: [3, 2],
    sillas: {
      negras: { dx: 0.5, dy: 1.0, mirandoDx: 1, mirandoDy: 0 }, // taburete oeste, mirando al este (hacia la mesa)
      blancas: { dx: 2.5, dy: 1.0, mirandoDx: -1, mirandoDy: 0 }, // taburete este, mirando al oeste
    },
  },
};

/** Rota un punto (dx,dy) local a la huella SIN rotar [w,h] `rot` cuartos de vuelta horarios — ver derivación en la cabecera del fichero. */
export function rotarPunto(dx: number, dy: number, huella: [number, number], rot: number): { x: number; y: number } {
  const [w, h] = huella;
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return { x: h - dy, y: dx };
    case 2:
      return { x: w - dx, y: h - dy };
    case 3:
      return { x: dy, y: w - dx };
    default:
      return { x: dx, y: dy };
  }
}

/** Rota un vector dirección (dx,dy) `rot` cuartos de vuelta horarios (sin traslación): un paso manda (dx,dy) -> (-dy,dx). */
export function rotarDireccion(dx: number, dy: number, rot: number): { x: number; y: number } {
  let x = dx;
  let y = dy;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  // `-y` con y=0 produce -0 en JS (Object.is(-0,0)===false, aunque -0===0):
  // normalizado para que un vector como Norte=(0,-1) rotado dé exactamente
  // (0,1) y no (-0,1) — solo afecta a la representación, nunca al valor.
  return { x: x || 0, y: y || 0 };
}

/**
 * Posición mundo (esquina noroeste + offset ya rotado) y hacia dónde mira
 * una silla de una mesa de minijuego YA colocada — `construccion` es
 * cualquier objeto con `{x,y,rot}` (encaja tanto `ConstruccionViva` del
 * servidor como el espejo `ConstruccionRed` del cliente).
 */
export function posicionSilla(
  mesaJuegoId: string,
  construccion: { x: number; y: number; rot: number },
  silla: Silla,
): { x: number; y: number; mirandoDx: number; mirandoDy: number } | null {
  const def = MESAS_JUEGO[mesaJuegoId];
  if (!def) return null;
  const offset = def.sillas[silla];
  const punto = rotarPunto(offset.dx, offset.dy, def.huella, construccion.rot);
  const mirando = rotarDireccion(offset.mirandoDx, offset.mirandoDy, construccion.rot);
  return { x: construccion.x + punto.x, y: construccion.y + punto.y, mirandoDx: mirando.x, mirandoDy: mirando.y };
}

/** Estado mínimo de asientos que necesita la lógica de abajo — encaja tanto con `MesaAjedrezSchema` (Colyseus) como con un mock plano en tests. */
export interface EstadoAsientosMesaJuego {
  sillaBlancas: string;
  sillaNegras: string;
}

/** sessionId sentado en esa silla, o "" si está libre. */
export function ocupanteDe(mesa: EstadoAsientosMesaJuego, silla: Silla): string {
  return silla === "blancas" ? mesa.sillaBlancas : mesa.sillaNegras;
}

/**
 * Elige qué silla ocupar: la pedida (`preferida`) si sigue libre, si no la
 * primera libre en orden blancas->negras; `null` si las dos están ocupadas.
 * PURA — misma función tanto si `preferida` viene de un cliente (E2E,
 * elección explícita) como si viene vacía (tecla de interacción del juego,
 * auto-apuntado sin UI, mismo criterio que el resto de acciones de
 * proximidad del proyecto).
 */
export function elegirSillaLibre(mesa: EstadoAsientosMesaJuego, preferida?: Silla | null): Silla | null {
  const otra: Silla = preferida === "blancas" ? "negras" : "blancas";
  const candidatas: Silla[] = preferida ? [preferida, otra] : ["blancas", "negras"];
  for (const silla of candidatas) {
    if (!ocupanteDe(mesa, silla)) return silla;
  }
  return null;
}

/** ¿Las dos sillas están ocupadas? — dispara el paso "esperando" -> "activo". */
export function mesaCompleta(mesa: EstadoAsientosMesaJuego): boolean {
  return !!mesa.sillaBlancas && !!mesa.sillaNegras;
}

/** ¿Las dos sillas están libres? — la mesa puede borrarse del Map (no acumular basura de partidas sin nadie). */
export function mesaVacia(mesa: EstadoAsientosMesaJuego): boolean {
  return !mesa.sillaBlancas && !mesa.sillaNegras;
}
