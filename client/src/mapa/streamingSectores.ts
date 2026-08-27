import type { IndiceMapa, SectorBakeado } from "./formatoMapa";

/**
 * Streaming de sectores por cercanía al jugador — LA mecánica de carga del
 * mapa principal (decisión pactada con el streamer, ver GDD_Motor_3D_Props):
 * el mapa entero (100 sectores, 70MB) nunca está en memoria; solo se
 * materializa el anillo alrededor del jugador y se suelta lo que queda
 * atrás, con histéresis para no cargar/soltar en bucle al pasearse por una
 * frontera de sectores.
 *
 * Esta clase es SOLO la lógica (qué sector se pide/materializa/suelta y
 * cuándo): no conoce Three ni fetch — ambos entran inyectados por opciones,
 * así se prueba en Node a secas (client/test/streaming.test.ts) simulando
 * caminatas de miles de casillas sin navegador.
 *
 * Distancias en CASILLAS desde el jugador al RECTÁNGULO del sector
 * (Chebyshev — la métrica natural de una rejilla de sectores cuadrados):
 * - dist <= radioCarga  → el sector se quiere materializado. Con el radio
 *   por defecto (192) el anillo 3x3 completo queda dentro estando en el
 *   centro de un sector (vecino más lejano a media diagonal = 160), y las
 *   filas nuevas van entrando por delante según avanzas — el prefetch ES
 *   esto mismo: al cruzar una frontera, la fila siguiente ya se pidió
 *   cuando te acercabas.
 * - dist >= radioDescarga → se suelta. El hueco entre ambos radios (160
 *   casillas = medio sector) es la histéresis: hay que alejarse medio
 *   sector más de lo que costó cargarlo para que se suelte.
 *
 * Presupuesto resultante con el mapa principal (sector = 320 casillas,
 * ~1MB JSON, ~7.300 props): 9 sectores materializados en régimen (~66k
 * instancias), pico transitorio de ~12 cruzando una frontera.
 */

export interface OpcionesStreaming<H> {
  indice: IndiceMapa;
  /** Descarga (o sirve de caché externa en tests) el JSON de un sector; null = no existe. */
  obtenerSector: (sx: number, sy: number) => Promise<SectorBakeado | null>;
  /** Crea la representación del sector (terreno+props) y la añade a escena. */
  materializar: (sector: SectorBakeado) => Promise<H>;
  /** Quita de escena y libera GPU/memoria lo que devolvió materializar. */
  soltar: (handle: H, sx: number, sy: number) => void;
  radioCargaTiles?: number;
  radioDescargaTiles?: number;
  /** Sectores parseados que se retienen aunque estén soltados (volver sobre tus pasos no refetchea). */
  maxSectoresCacheados?: number;
}

const RADIO_CARGA_DEFECTO = 192;
const RADIO_DESCARGA_DEFECTO = 352;
const MAX_CACHE_DEFECTO = 25;
/** No se reevalúa el anillo hasta haberse movido esto (casillas) — el bucle de juego llama cada frame. */
const UMBRAL_REEVALUACION = 16;

function clave(sx: number, sy: number): string {
  return `${sx}_${sy}`;
}

export class StreamingSectores<H = unknown> {
  private readonly opciones: Required<Pick<OpcionesStreaming<H>, "radioCargaTiles" | "radioDescargaTiles" | "maxSectoresCacheados">> & OpcionesStreaming<H>;
  private readonly tilesPorSector: number;
  private readonly sectoresAncho: number;
  private readonly sectoresAlto: number;

  /** JSON parseado por sector (LRU por orden de inserción del Map); null = 404 definitivo, no se reintenta. */
  private readonly cache = new Map<string, SectorBakeado | null>();
  private readonly enVuelo = new Map<string, Promise<SectorBakeado | null>>();
  private readonly materializados = new Map<string, H>();
  private readonly materializando = new Set<string>();
  /** Conjunto deseado según la última evaluación — la verdad contra la que se resuelven las carreras async. */
  private deseados = new Set<string>();
  private ultimaEvaluacion: { x: number; z: number } | null = null;

  constructor(opciones: OpcionesStreaming<H>) {
    this.opciones = {
      radioCargaTiles: RADIO_CARGA_DEFECTO,
      radioDescargaTiles: RADIO_DESCARGA_DEFECTO,
      maxSectoresCacheados: MAX_CACHE_DEFECTO,
      ...opciones,
    };
    const { indice } = opciones;
    this.tilesPorSector = indice.tamanoSectorChunks * indice.tamanoChunk;
    this.sectoresAncho = Math.max(1, Math.ceil(indice.anchoChunks / indice.tamanoSectorChunks));
    this.sectoresAlto = Math.max(1, Math.ceil(indice.altoChunks / indice.tamanoSectorChunks));
  }

  /** Distancia Chebyshev (casillas) desde un punto al rectángulo del sector; 0 = dentro. */
  private distanciaASector(tileX: number, tileZ: number, sx: number, sy: number): number {
    const t = this.tilesPorSector;
    const dx = Math.max(sx * t - tileX, 0, tileX - (sx + 1) * t);
    const dz = Math.max(sy * t - tileZ, 0, tileZ - (sy + 1) * t);
    return Math.max(dx, dz);
  }

  /**
   * Punto de entrada: llamar con la posición del jugador local (casillas).
   * Barata de llamar cada frame — solo reevalúa el anillo tras moverse
   * UMBRAL_REEVALUACION casillas desde la última evaluación.
   */
  actualizar(tileX: number, tileZ: number): void {
    if (this.ultimaEvaluacion) {
      const d = Math.max(Math.abs(tileX - this.ultimaEvaluacion.x), Math.abs(tileZ - this.ultimaEvaluacion.z));
      if (d < UMBRAL_REEVALUACION) return;
    }
    this.ultimaEvaluacion = { x: tileX, z: tileZ };
    this.evaluar(tileX, tileZ);
  }

  private evaluar(tileX: number, tileZ: number): void {
    const { radioCargaTiles, radioDescargaTiles } = this.opciones;
    const t = this.tilesPorSector;

    // Candidatos: solo la ventana de sectores que puede estar dentro del
    // radio de descarga — nunca se recorren los 100 del mapa entero.
    const sxMin = Math.max(0, Math.floor((tileX - radioDescargaTiles) / t));
    const sxMax = Math.min(this.sectoresAncho - 1, Math.floor((tileX + radioDescargaTiles) / t));
    const syMin = Math.max(0, Math.floor((tileZ - radioDescargaTiles) / t));
    const syMax = Math.min(this.sectoresAlto - 1, Math.floor((tileZ + radioDescargaTiles) / t));

    const deseados = new Set<string>();
    for (let sy = syMin; sy <= syMax; sy++) {
      for (let sx = sxMin; sx <= sxMax; sx++) {
        if (this.distanciaASector(tileX, tileZ, sx, sy) <= radioCargaTiles) deseados.add(clave(sx, sy));
      }
    }
    this.deseados = deseados;

    // Soltar SOLO lo que superó el radio de descarga (histéresis: lo que
    // está entre ambos radios se queda como está, cargado o no).
    for (const [k, handle] of [...this.materializados]) {
      const [sx, sy] = k.split("_").map(Number);
      if (this.distanciaASector(tileX, tileZ, sx, sy) >= radioDescargaTiles) {
        this.materializados.delete(k);
        this.opciones.soltar(handle, sx, sy);
      }
    }

    for (const k of deseados) {
      if (this.materializados.has(k) || this.materializando.has(k)) continue;
      const [sx, sy] = k.split("_").map(Number);
      this.materializando.add(k);
      this.obtenerSectorCacheado(sx, sy)
        .then(async (sector) => {
          // La caminata pudo dejar este sector atrás mientras se descargaba:
          // si ya no se desea, no se materializa (el JSON queda en caché).
          if (!sector || !this.deseados.has(k)) return;
          const handle = await this.opciones.materializar(sector);
          if (this.deseados.has(k)) {
            this.materializados.set(k, handle);
          } else {
            this.opciones.soltar(handle, sx, sy);
          }
        })
        .finally(() => this.materializando.delete(k));
    }
  }

  private obtenerSectorCacheado(sx: number, sy: number): Promise<SectorBakeado | null> {
    const k = clave(sx, sy);
    if (this.cache.has(k)) {
      const sector = this.cache.get(k)!;
      // refresco LRU: reinsertar lo usado lo pone al final (lo más reciente)
      this.cache.delete(k);
      this.cache.set(k, sector);
      return Promise.resolve(sector);
    }
    const previo = this.enVuelo.get(k);
    if (previo) return previo;

    const peticion = this.opciones
      .obtenerSector(sx, sy)
      .then((sector) => {
        this.cache.set(k, sector);
        this.podarCache();
        return sector;
      })
      .finally(() => this.enVuelo.delete(k));
    this.enVuelo.set(k, peticion);
    return peticion;
  }

  private podarCache(): void {
    while (this.cache.size > this.opciones.maxSectoresCacheados) {
      // El más antiguo que no esté materializado ni deseado; si todos lo
      // están (mapa diminuto), no se poda nada.
      let victima: string | null = null;
      for (const k of this.cache.keys()) {
        if (!this.materializados.has(k) && !this.deseados.has(k)) {
          victima = k;
          break;
        }
      }
      if (!victima) return;
      this.cache.delete(victima);
    }
  }

  estadisticas() {
    return {
      materializados: this.materializados.size,
      clavesMaterializadas: [...this.materializados.keys()].sort(),
      enCache: this.cache.size,
      enVuelo: this.enVuelo.size,
      materializando: this.materializando.size,
    };
  }
}
