/**
 * Bosques EN VIVO — activar/desactivar sectores según se acercan o alejan
 * jugadores, mismo patrón que fauna salvaje (`faunaSalvajeViva.ts`,
 * reusa de ahí `CoordenadaSector`/`sectorDeCasilla`/`sectoresEnRadio` tal
 * cual — es matemática de sector genérica, no específica de fauna).
 *
 * Diferencia real con la fauna: los árboles no se mueven ni tienen
 * necesidades — no hace falta `tick()`, toda la resolución pasa en
 * `activarSector` (cálculo perezoso puro, ver `bosqueSector.ts`).
 */
import { MapSchema } from "@colyseus/schema";
import { ArbolVivoSchema } from "../rooms/schema/HubState";
import { ArbolVivoFila, EtapaArbol } from "../datos/bd";
import { CoordenadaSector, sectorDeCasilla, sectoresEnRadio } from "./faunaSalvajeViva";
import { EspecieArbol } from "./crecimientoBosques";
import { ObjetoArbolBakeado, ResultadoResolucionBosque, idArbolBake, resolverSectorBosque } from "./bosqueSector";
import { MundoColision, TIPO } from "./colisiones";
import { ColaPorClave } from "../concurrencia/colaPorClave";

/** Misma clave plana que usa faunaSalvajeViva.ts internamente (no exportada de ahí, se repite aquí — una línea, no vale la pena acoplar los dos módulos por esto). */
function claveSector(s: CoordenadaSector): string {
  return `${s.sectorX},${s.sectorY}`;
}

interface ArbolBakeVivo {
  x: number;
  y: number;
  especieId: string;
  /** índice ORIGINAL dentro de `objetosBakeados` de ese sector — hace falta tal cual para reconstruir el mismo id determinista al talarlo. */
  indiceOriginal: number;
}

interface SectorActivo {
  /** Árboles de bake todavía en pie en este sector (ya sin los talados). */
  arbolesBake: ArbolBakeVivo[];
  /** Árboles nacidos en el sistema, vivos, en este sector. */
  crecidos: ArbolVivoFila[];
}

/** Referencia estable a un árbol concreto encontrado por `buscarArbolCercano`, para pasar a `talar`. */
export type RefArbol =
  | { sectorKey: string; tipo: "bake"; indiceBake: number }
  | { sectorKey: string; tipo: "crecido"; id: string };

export interface ArbolCercano {
  especieId: string;
  x: number;
  y: number;
  etapa: EtapaArbol;
  ref: RefArbol;
}

export interface DependenciasBosques {
  mapaId: string;
  catalogo: Record<string, EspecieArbol>;
  mundo: MundoColision;
  tamanoChunk: number;
  tamanoSectorChunks: number;
  /** Día de mundo fraccional actual — inyectado para poder testear con un reloj fijo. */
  ahora: () => number;
  /** Lee `sector_XXX_YYY.json` y devuelve solo los objetos `t==="v"` cuya especie tiene `crecimiento` en el catálogo. */
  cargarBakeSector: (s: CoordenadaSector) => ObjetoArbolBakeado[];
  cargarPersistido: (s: CoordenadaSector) => Promise<{ bakeTalados: ArbolVivoFila[]; crecidos: ArbolVivoFila[] }>;
  guardarArbolVivo: (a: ArbolVivoFila) => Promise<void>;
  marcarSectorResuelto: (s: CoordenadaSector, momento: number) => Promise<void>;
}

export class GestorBosques {
  private sectoresActivos = new Map<string, SectorActivo>();
  private contadorPlantado = 0;
  // Mismo mecanismo que `colaPorConstruccion`/`colaPorTrabajador`/`colaPorAnimal`/`colaPorCasilla`
  // de RoomExteriorBase.ts (docs de ColaPorClave): `talar`/`plantar` hacen lectura-modificación-
  // escritura async sobre `sectoresActivos` sin ninguna serialización — dos jugadores talando el
  // MISMO árbol (o plantando la MISMA casilla) casi a la vez pueden cobrar/plantar por duplicado o
  // dejar el índice de `arbolesBake`/`crecidos` desincronizado (encontrado en la auditoría de
  // concurrencia de 2026-09-02). `GestorBosques` no es una Room — no puede reusar las colas de
  // RoomExteriorBase, así que lleva la suya propia.
  private colaPorArbol = new ColaPorClave();

  constructor(
    private salida: MapSchema<ArbolVivoSchema>,
    private deps: DependenciasBosques,
  ) {}

  get sectoresCargados(): string[] {
    return [...this.sectoresActivos.keys()];
  }

  private casillaLibreParaBrote(x: number, y: number): boolean {
    const m = this.deps.mundo;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= m.ancho || yi >= m.alto) return false;
    return m.casillas[yi * m.ancho + xi] === TIPO.TIERRA;
  }

  private endurecer(x: number, y: number): void {
    const m = this.deps.mundo;
    const idx = Math.round(y) * m.ancho + Math.round(x);
    if (m.casillas[idx] === TIPO.TIERRA) m.casillas[idx] = TIPO.SOLIDO;
  }

  private ablandar(x: number, y: number): void {
    const m = this.deps.mundo;
    const idx = Math.round(y) * m.ancho + Math.round(x);
    m.casillas[idx] = TIPO.TIERRA;
  }

  private publicar(f: ArbolVivoFila): void {
    const esquema = new ArbolVivoSchema();
    esquema.x = f.x;
    esquema.y = f.y;
    esquema.especieId = f.especieId;
    esquema.etapa = f.etapa;
    this.salida.set(f.id, esquema);
  }

  /**
   * Activa un sector: resuelve su bosque (bake menos talados + jóvenes que
   * maduran + nuevos brotes de propagación), persiste solo la DIFERENCIA
   * respecto al bake (ver bosqueSector.ts), endurece el grid de colisión
   * de lo recién madurado, y materializa lo nacido en vivo (nunca el bake)
   * en el estado de Colyseus. No hace nada si el sector ya estaba activo.
   */
  async activarSector(s: CoordenadaSector): Promise<void> {
    const k = claveSector(s);
    if (this.sectoresActivos.has(k)) return;

    const persistido = await this.deps.cargarPersistido(s);
    const bake = this.deps.cargarBakeSector(s);
    const ahora = this.deps.ahora();

    const resultado: ResultadoResolucionBosque = resolverSectorBosque({
      mapaId: this.deps.mapaId,
      sectorX: s.sectorX,
      sectorY: s.sectorY,
      objetosBakeados: bake,
      bakeTaladosPersistidos: persistido.bakeTalados,
      crecidosPersistidos: persistido.crecidos,
      ahora,
      catalogo: this.deps.catalogo,
      casillaLibre: (x, y) => this.casillaLibreParaBrote(x, y),
    });

    for (const f of resultado.crecidos) await this.deps.guardarArbolVivo(f);
    await this.deps.marcarSectorResuelto(s, ahora);

    for (const { x, y } of resultado.recienMaduraron) this.endurecer(x, y);

    const idsTalados = new Set(resultado.bakeTalados.map((f) => f.id));
    const arbolesBake: ArbolBakeVivo[] = [];
    bake.forEach((obj, indiceOriginal) => {
      if (!this.deps.catalogo[obj.i]) return;
      const id = idArbolBake(this.deps.mapaId, s.sectorX, s.sectorY, indiceOriginal);
      if (idsTalados.has(id)) return;
      arbolesBake.push({ x: obj.x, y: obj.y, especieId: obj.i, indiceOriginal });
    });

    const crecidosVivos = resultado.crecidos.filter((f) => f.estado === "vivo");
    for (const f of crecidosVivos) this.publicar(f);

    this.sectoresActivos.set(k, { arbolesBake, crecidos: crecidosVivos });
  }

  /** Desactiva un sector: nada que guardar (los árboles no se mueven, ya está todo persistido desde la activación), solo se quita del estado en vivo. */
  desactivarSector(s: CoordenadaSector): void {
    const k = claveSector(s);
    const info = this.sectoresActivos.get(k);
    if (!info) return;
    for (const f of info.crecidos) this.salida.delete(f.id);
    this.sectoresActivos.delete(k);
  }

  /** Mismo patrón que GestorFaunaSalvaje.actualizarPorJugadores — llamar desde el MISMO intervalo de baja frecuencia que ya usa fauna, sin uno nuevo. */
  async actualizarPorJugadores(posiciones: { x: number; y: number }[], radioSectores = 1): Promise<void> {
    const necesarios = new Map<string, CoordenadaSector>();
    for (const p of posiciones) {
      const centro = sectorDeCasilla(p.x, p.y, this.deps.tamanoChunk, this.deps.tamanoSectorChunks);
      for (const s of sectoresEnRadio(centro, radioSectores)) necesarios.set(claveSector(s), s);
    }
    for (const k of [...this.sectoresActivos.keys()]) {
      if (!necesarios.has(k)) {
        const [sectorX, sectorY] = k.split(",").map(Number);
        this.desactivarSector({ sectorX, sectorY });
      }
    }
    for (const s of necesarios.values()) {
      if (!this.sectoresActivos.has(claveSector(s))) await this.activarSector(s);
    }
  }

  /** Árbol talable/interactuable más cercano dentro de `radio`, entre sectores activos (bake vivo + crecidos vivos). `null` si no hay ninguno cerca. */
  buscarArbolCercano(x: number, y: number, radio: number): ArbolCercano | null {
    let mejor: ArbolCercano | null = null;
    let mejorDist = Infinity;
    for (const [sectorKey, info] of this.sectoresActivos) {
      info.arbolesBake.forEach((a, indiceBake) => {
        const d = Math.hypot(a.x + 0.5 - x, a.y + 0.5 - y);
        if (d <= radio && d < mejorDist) {
          mejorDist = d;
          mejor = { especieId: a.especieId, x: a.x, y: a.y, etapa: "adulto", ref: { sectorKey, tipo: "bake", indiceBake } };
        }
      });
      for (const f of info.crecidos) {
        const d = Math.hypot(f.x + 0.5 - x, f.y + 0.5 - y);
        if (d <= radio && d < mejorDist) {
          mejorDist = d;
          mejor = { especieId: f.especieId, x: f.x, y: f.y, etapa: f.etapa, ref: { sectorKey, tipo: "crecido", id: f.id } };
        }
      }
    }
    return mejor;
  }

  /**
   * Tala el árbol referenciado (de `buscarArbolCercano`) — lo marca
   * talado (persistido, para que no reaparezca al reactivar el sector),
   * lo quita del estado en vivo si era un brote nacido en el sistema, y
   * ablanda su casilla en el grid de colisión si estaba endurecida
   * (siempre en un adulto, bake o crecido). `null` si la referencia ya no
   * es válida (alguien se adelantó, o el sector se desactivó entretanto).
   */
  async talar(ref: RefArbol): Promise<{ especieId: string; etapa: EtapaArbol } | null> {
    const clave = `${ref.sectorKey}:${ref.tipo}:${ref.tipo === "bake" ? ref.indiceBake : ref.id}`;
    return this.colaPorArbol.ejecutar(clave, async () => {
      const info = this.sectoresActivos.get(ref.sectorKey);
      if (!info) return null;
      const [sectorX, sectorY] = ref.sectorKey.split(",").map(Number);

      if (ref.tipo === "bake") {
        const obj = info.arbolesBake[ref.indiceBake];
        if (!obj) return null; // ya talado por una tarea anterior en esta misma cola
        const fila: ArbolVivoFila = {
          id: idArbolBake(this.deps.mapaId, sectorX, sectorY, obj.indiceOriginal),
          mapaId: this.deps.mapaId, sectorX, sectorY, especieId: obj.especieId,
          x: obj.x, y: obj.y, etapa: "adulto", origen: "bake", diaPlantado: null, estado: "talado",
        };
        await this.deps.guardarArbolVivo(fila);
        // Releer el índice tras el await: otra tarea de una clave DISTINTA pudo splice-ar
        // `arbolesBake` de por medio (talar otro árbol del mismo sector) y desplazar posiciones.
        const idxActual = info.arbolesBake.findIndex((a) => a === obj);
        if (idxActual === -1) return null;
        info.arbolesBake.splice(idxActual, 1);
        this.ablandar(obj.x, obj.y);
        return { especieId: obj.especieId, etapa: "adulto" };
      }

      const idx = info.crecidos.findIndex((f) => f.id === ref.id);
      if (idx === -1) return null;
      const f = info.crecidos[idx];
      await this.deps.guardarArbolVivo({ ...f, estado: "talado" });
      this.salida.delete(f.id);
      const idxActual = info.crecidos.findIndex((c) => c.id === ref.id);
      if (idxActual !== -1) info.crecidos.splice(idxActual, 1);
      if (f.etapa === "adulto") this.ablandar(f.x, f.y);
      return { especieId: f.especieId, etapa: f.etapa };
    });
  }

  /**
   * Planta una semilla de `especieId` en (x,y) — exige que el sector esté
   * activo (jugador cerca, coherente con cómo se llega a poder plantar) y
   * la casilla esté libre y sin otro árbol ya en ese punto exacto. Nace
   * `etapa:"joven"`, madura solo (mismo mecanismo que un brote de
   * propagación) cuando toque su sector. `null` si no se pudo.
   */
  async plantar(especieId: string, x: number, y: number): Promise<ArbolVivoFila | null> {
    if (!this.deps.catalogo[especieId]) return null;
    const xi = Math.round(x);
    const yi = Math.round(y);
    // Clave por CASILLA (no por sector): dos plantaciones en la MISMA casilla no pueden solaparse,
    // pero dos casillas distintas del mismo sector no tienen por qué esperarse la una a la otra.
    return this.colaPorArbol.ejecutar(`casilla:${xi},${yi}`, async () => {
      if (!this.casillaLibreParaBrote(xi, yi)) return null;

      const s = sectorDeCasilla(x, y, this.deps.tamanoChunk, this.deps.tamanoSectorChunks);
      const k = claveSector(s);
      const info = this.sectoresActivos.get(k);
      if (!info) return null;

      const ocupado =
        info.arbolesBake.some((a) => Math.round(a.x) === xi && Math.round(a.y) === yi) ||
        info.crecidos.some((f) => Math.round(f.x) === xi && Math.round(f.y) === yi);
      if (ocupado) return null;

      const ahora = this.deps.ahora();
      const fila: ArbolVivoFila = {
        id: `arbol:${this.deps.mapaId}:${s.sectorX}:${s.sectorY}:plantado:${ahora}:${this.contadorPlantado++}`,
        mapaId: this.deps.mapaId, sectorX: s.sectorX, sectorY: s.sectorY, especieId,
        x: xi, y: yi, etapa: "joven", origen: "plantado", diaPlantado: ahora, estado: "vivo",
      };
      await this.deps.guardarArbolVivo(fila);
      info.crecidos.push(fila);
      this.publicar(fila);
      return fila;
    });
  }
}
