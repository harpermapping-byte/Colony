/**
 * Espejo de CLIENTE de `server/src/construccion/mesasJuego.ts` (geometría de
 * asientos) — mismo criterio que `client/src/construccion/catalogoConstruccion.ts::huellaRotada`,
 * que YA duplica su equivalente de servidor en vez de importarlo: el
 * cliente se compila con Vite y no debe arrastrar módulos de servidor
 * (fs/path, dependencias de Colyseus) a través de un import cruzado. Es
 * geometría pura y pequeña — mantenerla en dos sitios es más simple y más
 * seguro para el bundle que forzar un import compartido. Si cambia la
 * huella/offsets de una mesa de minijuego, cambia en LOS DOS sitios (el
 * test de servidor `server/test/mesasJuego.test.ts` es la fuente de verdad
 * de la fórmula; aquí solo se replica).
 */

export type Silla = "blancas" | "negras";

interface OffsetSilla {
  dx: number;
  dy: number;
  mirandoDx: number;
  mirandoDy: number;
}

interface DefinicionMesaJuego {
  huella: [number, number];
  sillas: Record<Silla, OffsetSilla>;
}

export const MESAS_JUEGO: Record<string, DefinicionMesaJuego> = {
  mesa_ajedrez: {
    huella: [3, 2],
    sillas: {
      negras: { dx: 0.5, dy: 1.0, mirandoDx: 1, mirandoDy: 0 },
      blancas: { dx: 2.5, dy: 1.0, mirandoDx: -1, mirandoDy: 0 },
    },
  },
};

function rotarPunto(dx: number, dy: number, huella: [number, number], rot: number): { x: number; y: number } {
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

/** Posición mundo de una silla de una mesa de minijuego YA colocada (x,y = esquina noroeste de su huella ya rotada). */
export function posicionSilla(mesaJuegoId: string, construccion: { x: number; y: number; rot: number }, silla: Silla): { x: number; y: number } | null {
  const def = MESAS_JUEGO[mesaJuegoId];
  if (!def) return null;
  const offset = def.sillas[silla];
  const punto = rotarPunto(offset.dx, offset.dy, def.huella, construccion.rot);
  return { x: construccion.x + punto.x, y: construccion.y + punto.y };
}
