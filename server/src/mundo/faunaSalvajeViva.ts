/**
 * Fauna salvaje EN VIVO — la pieza que faltaba: activar/desactivar
 * sectores según se acercan o alejan jugadores, y tickear el merodeo de
 * los que están activos. Reutiliza el MISMO algoritmo de paseo que la
 * fauna doméstica (`mundo/fauna.ts`, `GestorFauna`) — confirmado con el
 * streamer ("por qué no usamos la inteligencia de los domésticos en lo
 * salvaje") — adaptado aquí porque además necesita poder QUITAR animales
 * del estado (al desactivar un sector) y guardar su posición final en
 * BD, cosa que `GestorFauna` no hace (la fauna doméstica nunca se quita).
 *
 * Todas las dependencias (leer el bake, leer/guardar BD, "ahora" del
 * reloj de mundo) se inyectan — nada de fs/BD directos aquí — para poder
 * testear con datos falsos sin tocar disco ni una base de datos real.
 */
import { MapSchema } from "@colyseus/schema";
import { Fauna } from "../rooms/schema/HubState";
import { MundoColision, TIPO } from "./colisiones";
import { CatalogoEspecies, ObjetoFaunaBakeado, resolverSector } from "./faunaSalvajeSector";
import { FaunaHuevoFila, FaunaSalvajeFila } from "../datos/bd";

const RADIO_MERODEO = 3; // casillas — paseo corto alrededor de donde se resolvió cada individuo
const VEL = 1.0;
const ACCIONES_IDLE = ["comer", "sentarse", "jugar", "dormir", "alerta"];

function accionIdleAlAzar(): string {
  return ACCIONES_IDLE[Math.floor(Math.random() * ACCIONES_IDLE.length)];
}

export interface CoordenadaSector {
  sectorX: number;
  sectorY: number;
}

export function sectorDeCasilla(x: number, y: number, tamanoChunk: number, tamanoSectorChunks: number): CoordenadaSector {
  const chunkX = Math.floor(x / tamanoChunk);
  const chunkY = Math.floor(y / tamanoChunk);
  return { sectorX: Math.floor(chunkX / tamanoSectorChunks), sectorY: Math.floor(chunkY / tamanoSectorChunks) };
}

export function sectoresEnRadio(centro: CoordenadaSector, radioSectores: number): CoordenadaSector[] {
  const salida: CoordenadaSector[] = [];
  for (let dy = -radioSectores; dy <= radioSectores; dy++) {
    for (let dx = -radioSectores; dx <= radioSectores; dx++) {
      salida.push({ sectorX: centro.sectorX + dx, sectorY: centro.sectorY + dy });
    }
  }
  return salida;
}

function clave(s: CoordenadaSector): string {
  return `${s.sectorX},${s.sectorY}`;
}

export interface DependenciasFaunaSalvaje {
  mapaId: string;
  catalogo: CatalogoEspecies;
  mundo: MundoColision;
  /** Día de mundo fraccional actual — inyectado (no Date.now() aquí) para poder testear con un reloj fijo. */
  ahora: () => number;
  /** Lee `sector_XXX_YYY.json` y devuelve solo los objetos `t==="a"` — solo se llama la PRIMERA vez que se activa un sector. */
  cargarBakeSector: (s: CoordenadaSector) => ObjetoFaunaBakeado[];
  cargarPersistido: (s: CoordenadaSector) => Promise<{
    filas: FaunaSalvajeFila[];
    huevos: FaunaHuevoFila[];
    ultimaResolucion: number | null;
  }>;
  guardarIndividuo: (f: FaunaSalvajeFila) => Promise<void>;
  guardarHuevo: (h: FaunaHuevoFila) => Promise<void>;
  marcarSectorResuelto: (s: CoordenadaSector, momento: number) => Promise<void>;
}

interface IndividuoVivo {
  fila: FaunaSalvajeFila;
  esquema: Fauna;
  destino: { x: number; y: number } | null;
  pausaRestante: number;
}

export class GestorFaunaSalvaje {
  private sectoresActivos = new Map<string, IndividuoVivo[]>();

  constructor(
    private salida: MapSchema<Fauna>,
    private deps: DependenciasFaunaSalvaje,
  ) {}

  get sectoresCargados(): string[] {
    return [...this.sectoresActivos.keys()];
  }

  cantidadViva(): number {
    let n = 0;
    for (const vivos of this.sectoresActivos.values()) n += vivos.length;
    return n;
  }

  private transitable(x: number, y: number): boolean {
    const xi = Math.round(x);
    const yi = Math.round(y);
    const m = this.deps.mundo;
    if (xi < 0 || yi < 0 || xi >= m.ancho || yi >= m.alto) return false;
    return m.casillas[yi * m.ancho + xi] !== TIPO.SOLIDO;
  }

  /**
   * Activa un sector: resuelve su población (primera vez desde el bake,
   * o avanzando el hueco de tiempo si ya se había resuelto antes),
   * persiste el resultado ENTERO (también los muertos, para no
   * "resucitarlos" la próxima vez) y materializa los vivos en el estado
   * de Colyseus. No hace nada si el sector ya estaba activo.
   */
  async activarSector(s: CoordenadaSector): Promise<void> {
    const k = clave(s);
    if (this.sectoresActivos.has(k)) return;

    const persistido = await this.deps.cargarPersistido(s);
    const esPrimeraVez = persistido.ultimaResolucion === null && persistido.filas.length === 0;
    const bake = esPrimeraVez ? this.deps.cargarBakeSector(s) : [];

    const resultado = resolverSector({
      mapaId: this.deps.mapaId,
      sectorX: s.sectorX,
      sectorY: s.sectorY,
      objetosBakeados: bake,
      filasPersistidas: persistido.filas,
      huevosPersistidos: persistido.huevos,
      ultimaResolucion: persistido.ultimaResolucion,
      ahora: this.deps.ahora(),
      catalogo: this.deps.catalogo,
    });

    const vivos: IndividuoVivo[] = [];
    for (const fila of resultado.individuos) {
      if (fila.estado !== "vivo" || !this.transitable(fila.x, fila.y)) continue;
      const esquema = new Fauna();
      esquema.x = fila.x + 0.5;
      esquema.y = fila.y + 0.5;
      esquema.especieId = fila.especieId;
      esquema.accion = accionIdleAlAzar();
      this.salida.set(fila.id, esquema);
      vivos.push({ fila, esquema, destino: null, pausaRestante: 1 + Math.random() * 3 });
    }

    for (const fila of resultado.individuos) await this.deps.guardarIndividuo(fila);
    for (const h of resultado.huevos) await this.deps.guardarHuevo(h);
    await this.deps.marcarSectorResuelto(s, this.deps.ahora());

    this.sectoresActivos.set(k, vivos);
  }

  /** Desactiva un sector: guarda la posición/estado final de cada vivo y lo quita del estado en vivo. No hace nada si no estaba activo. */
  async desactivarSector(s: CoordenadaSector): Promise<void> {
    const k = clave(s);
    const vivos = this.sectoresActivos.get(k);
    if (!vivos) return;
    for (const v of vivos) {
      v.fila.x = v.esquema.x;
      v.fila.y = v.esquema.y;
      await this.deps.guardarIndividuo(v.fila);
      this.salida.delete(v.fila.id);
    }
    this.sectoresActivos.delete(k);
  }

  /**
   * Llamar periódicamente (baja frecuencia, ej. cada pocos segundos) con
   * la posición de los jugadores conectados — activa los sectores dentro
   * de `radioSectores` de alguno y desactiva los que se quedaron sin
   * nadie cerca. Nunca actúa sobre más sectores que los realmente
   * necesarios: el resto del mapa (los otros miles de sectores) ni se
   * toca ni cuesta nada mientras no haya un jugador cerca.
   */
  async actualizarPorJugadores(
    posiciones: { x: number; y: number }[],
    tamanoChunk: number,
    tamanoSectorChunks: number,
    radioSectores = 1,
  ): Promise<void> {
    const necesarios = new Map<string, CoordenadaSector>();
    for (const p of posiciones) {
      const centro = sectorDeCasilla(p.x, p.y, tamanoChunk, tamanoSectorChunks);
      for (const s of sectoresEnRadio(centro, radioSectores)) necesarios.set(clave(s), s);
    }
    for (const k of [...this.sectoresActivos.keys()]) {
      if (!necesarios.has(k)) {
        const [sectorX, sectorY] = k.split(",").map(Number);
        await this.desactivarSector({ sectorX, sectorY });
      }
    }
    for (const s of necesarios.values()) {
      if (!this.sectoresActivos.has(clave(s))) await this.activarSector(s);
    }
  }

  /** Mismo algoritmo de paseo que `GestorFauna` (mundo/fauna.ts): pausa idle, o caminar en línea recta a un punto al azar dentro de un radio pequeño. */
  tick(dt: number): void {
    for (const vivos of this.sectoresActivos.values()) {
      for (const v of vivos) {
        if (v.destino) {
          this.avanzarHaciaDestino(v, dt);
          continue;
        }
        v.pausaRestante -= dt;
        if (v.pausaRestante > 0) continue;
        const destino = this.elegirDestino(v);
        if (destino) {
          v.destino = destino;
          v.esquema.accion = "caminar";
        } else {
          v.pausaRestante = 2;
          v.esquema.accion = accionIdleAlAzar();
        }
      }
    }
  }

  private elegirDestino(v: IndividuoVivo): { x: number; y: number } | null {
    for (let intento = 0; intento < 6; intento++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * RADIO_MERODEO;
      const cx = v.esquema.x + Math.cos(ang) * dist;
      const cy = v.esquema.y + Math.sin(ang) * dist;
      if (this.transitable(cx, cy)) return { x: cx, y: cy };
    }
    return null;
  }

  private avanzarHaciaDestino(v: IndividuoVivo, dt: number): void {
    const dx = v.destino!.x - v.esquema.x;
    const dy = v.destino!.y - v.esquema.y;
    const dist = Math.hypot(dx, dy);
    const paso = VEL * dt;
    if (dist <= paso) {
      v.esquema.x = v.destino!.x;
      v.esquema.y = v.destino!.y;
      v.destino = null;
      v.pausaRestante = 2 + Math.random() * 4;
      v.esquema.accion = accionIdleAlAzar();
    } else {
      v.esquema.x += (dx / dist) * paso;
      v.esquema.y += (dy / dist) * paso;
    }
  }
}
