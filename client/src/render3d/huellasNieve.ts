/**
 * Huella de pisada en la nieve (pedido streamer 2026-09-11: "deberia bajar
 * a la mitad la parte que pise cada player o npc o jugador... es viable?
 * y persistente? o que quede la huella X tiempo... y luego que vuelva al
 * estado que estuviera").
 *
 * La capa de nieve es UNA `BoxGeometry` por sector con altura UNIFORME
 * (`crearCajaNieveSector`, sectorVisual.ts) — no hay altura por casilla,
 * así que una depresión 3D real (bajar la malla justo donde se pisa) NO es
 * viable sin rediseñar esa capa entera (una malla por casilla, o un
 * displacement map real — mucho más caro, y esta sesión ya midió con
 * cuidado el coste de tocar el terreno, ver `docs/GDD_Motor_3D_Props.md`).
 *
 * Lo que SÍ es viable y barato reusando la arquitectura tal cual: la cara
 * de arriba de la caja ya es una textura de canvas (`nieveCanvas`, blanco
 * opaco = nieve, transparente = agua/hielo, 1px = 1 casilla) — una pisada
 * oscurece esa MISMA textura en la casilla pisada (nieve "compactada/
 * sucia", el mismo lenguaje visual real de una huella en nieve real), y
 * pasado un tiempo se restaura el blanco EXACTO original — se conoce de
 * antemano sin guardar nada (`crearTerrenoSector` siempre escribe
 * 255,255,255,255 en tierra), así que "vuelve al estado que estuviera" es
 * literal, no una aproximación. Nunca hace falta comprobar si la casilla es
 * agua: un no-nadador SOLO puede estar de pie sobre una casilla `!agua`
 * (la misma condición que ya decide el blanco de `nieveCanvas`), así que
 * cualquier pisada real cae siempre sobre un píxel ya elegible.
 *
 * Decorativo y 100% CLIENTE, NUNCA sincronizado entre jugadores — cada
 * cliente pinta sus propias huellas bajo cualquier entidad que vea
 * moverse, con su propio temporizador (mismo criterio que los charcos de
 * lluvia o el vagabundeo de fauna decorativa: nadie necesita ver EXACTAMENTE
 * la misma huella en el mismo pixel-frame que otro jugador).
 */

export interface SectorNieveCanvas {
  canvas: HTMLCanvasElement;
  /** Referencia a la CanvasTexture real (o un objeto con la misma forma, para tests) — hay que marcarla sucia tras pintar/restaurar. */
  textura: { needsUpdate: boolean };
}

/** Traduce una casilla del MUNDO a su sector y el píxel local dentro del canvas de nieve de ESE sector (1px = 1 casilla, sin relación con `PX_POR_TILE_SUELO` — la máscara de nieve no cambió de resolución). */
export function sectorYPixelDeCasilla(
  gx: number,
  gy: number,
  tamanoSectorChunks: number,
  tamanoChunk: number,
): { sx: number; sy: number; px: number; py: number } {
  const tilesSector = tamanoSectorChunks * tamanoChunk;
  const sx = Math.floor(gx / tilesSector);
  const sy = Math.floor(gy / tilesSector);
  const px = gx - sx * tilesSector;
  const py = gy - sy * tilesSector;
  return { sx, sy, px, py };
}

const DURACION_HUELLA_MS = 25000;
const COLOR_HUELLA = "rgb(176,186,196)"; // gris azulado — nieve pisada/compactada, no barro
const COLOR_NIEVE_INTACTA = "rgb(255,255,255)";

interface HuellaActiva {
  sx: number;
  sy: number;
  px: number;
  py: number;
  expiraEn: number;
}

export class GestorHuellasNieve {
  private readonly activas = new Map<string, HuellaActiva>();
  // Por ENTIDAD (identidad de objeto, no un id de texto — evita depender de
  // que cada tipo de entidad tenga un id único a mano; una entidad que deja
  // de existir simplemente se pierde de este WeakMap sin fuga de memoria).
  private readonly ultimaPorEntidad = new WeakMap<object, { gx: number; gy: number }>();

  constructor(
    private readonly tamanoSectorChunks: number,
    private readonly tamanoChunk: number,
    private readonly obtenerCanvasSector: (sx: number, sy: number) => SectorNieveCanvas | null,
  ) {}

  /**
   * Llamar cada frame por cada entidad que camina sobre nieve (nivel de
   * nieve > 0 y `!nadando` — un nadador está sobre agua, nunca pisa nieve).
   * `x`/`z` en coordenadas de mundo. No-op si sigue en la misma casilla que
   * su propia última pisada (evita repintar 15-60 veces/segundo mientras
   * cruza una casilla).
   */
  registrarPisada(entidad: object, x: number, z: number): void {
    const gx = Math.floor(x);
    const gy = Math.floor(z);
    const ultima = this.ultimaPorEntidad.get(entidad);
    if (ultima && ultima.gx === gx && ultima.gy === gy) return;
    this.ultimaPorEntidad.set(entidad, { gx, gy });
    this.pintarHuella(gx, gy);
  }

  private pintarHuella(gx: number, gy: number): void {
    const { sx, sy, px, py } = sectorYPixelDeCasilla(gx, gy, this.tamanoSectorChunks, this.tamanoChunk);
    const sector = this.obtenerCanvasSector(sx, sy);
    if (!sector) return; // sector no materializado ahora mismo (fuera de rango, o todavía cargando) — sin huella, no pasa nada
    const ctx = sector.canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = COLOR_HUELLA;
    ctx.fillRect(px, py, 1, 1);
    sector.textura.needsUpdate = true;
    this.activas.set(`${sx}_${sy}:${px}_${py}`, { sx, sy, px, py, expiraEn: performance.now() + DURACION_HUELLA_MS });
  }

  /** Llamar una vez por frame: restaura al blanco original las huellas que ya cumplieron su tiempo — "vuelve al estado que estuviera". */
  actualizar(ahora: number): void {
    for (const [clave, h] of this.activas) {
      if (ahora < h.expiraEn) continue;
      const sector = this.obtenerCanvasSector(h.sx, h.sy);
      if (sector) {
        const ctx = sector.canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = COLOR_NIEVE_INTACTA;
          ctx.fillRect(h.px, h.py, 1, 1);
          sector.textura.needsUpdate = true;
        }
      }
      this.activas.delete(clave);
    }
  }

  /** Sonda de depuración/tests: claves `sx_sy:px_py` de las huellas activas ahora mismo. */
  clavesActivas(): string[] {
    return [...this.activas.keys()];
  }

  /** Sector descargado/oculto: sus huellas activas dejan de tener sentido (el canvas entero se libera u oculta con el sector) — quitarlas de la lista evita perseguir un sector que ya no está. */
  olvidarSector(sx: number, sy: number): void {
    for (const [clave, h] of this.activas) if (h.sx === sx && h.sy === sy) this.activas.delete(clave);
  }
}
