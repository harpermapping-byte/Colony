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
import { CatalogoEspecies, ObjetoFaunaBakeado, convertirFilaAAnimal, resolverSector } from "./faunaSalvajeSector";
import { necesitaAgua, necesitaComida } from "./reproduccionFauna";
import { Cadaver, crearCadaver } from "./cadaveres";
import { CatalogoCombateFauna, estadisticasCombatePorDefecto } from "./catalogoCombateFauna";
import { aplicarDanio, curar, estaMuerto } from "../combate/combate";
import { FaunaHuevoFila, FaunaSalvajeFila } from "../datos/bd";
import { CatalogoItems } from "../inventario/inventario";
import { rellenarLootCaza } from "./lootCaza";

const RADIO_MERODEO = 3; // casillas — paseo corto alrededor de donde se resolvió cada individuo
const VEL = 1.0;
const ACCIONES_IDLE = ["sentarse", "jugar", "dormir", "alerta"];
const RADIO_BUSQUEDA_AGUA = 15; // casillas — hasta dónde busca agua antes de rendirse por este intento

// --- Manada/banco/bandada (pedido 2026-08-31) — cohesión ligera, no boids
// completo: cada individuo gregario, al elegir su próximo paseo, desplaza
// el CENTRO de su merodeo hacia el centroide de vecinos de su misma
// especie cercanos, en vez de merodear siempre alrededor de sí mismo. Sin
// vecinos cerca (o especie no gregaria) se comporta exactamente igual que
// antes. PESO_COHESION bajo a propósito: tira del grupo sin que se apelmacen
// en una sola casilla ni se mueva en bloque de forma robótica.
const RADIO_MANADA = 10; // casillas — hasta dónde "ve" a vecinos de su especie para formar grupo
const PESO_COHESION = 0.15;

/** Gregario = deriva de catálogos YA existentes (dieta de `catalogo`, peligroso/categoriaVida de `catalogoCombate`), sin flag nuevo por especie: cualquier adulto no peligroso y no carnívoro (herbívoros, omnívoros, peces, aves) tiende a agruparse; depredadores y crías, no. Sin `catalogoCombate` (opcional) se asume no peligroso/no cría — mismo criterio "nunca romper por un dato ausente" que `estadisticasCombatePorDefecto`. */
function esGregario(dieta: string | undefined, combate: { peligroso?: boolean; categoriaVida?: string } | undefined): boolean {
  if (dieta === "carnivoro") return false;
  if (combate?.peligroso) return false;
  if (combate?.categoriaVida === "cria") return false;
  return true;
}

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
  /** Vida/ataque por especie (docs/GDD_Mecanicas.md §5.4) — relleno seguro si se omite, ver `estadisticasCombatePorDefecto`. */
  catalogoCombate?: CatalogoCombateFauna;
  /** docs/GDD_Caza.md — items/catalogo/items.json, para rellenar el cadáver con carne/tendones/tripas al morir. Ausente = cadáver vacío (mismo comportamiento que antes de esta mecánica). */
  catalogoItems?: CatalogoItems;
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
  /** Persiste un cadáver recién creado (docs/GDD_Agentes_Moviles.md, pedido 2026-08-30) — ver `matarIndividuo`. */
  crearCadaver: (c: Cadaver) => Promise<void>;
}

interface IndividuoVivo {
  fila: FaunaSalvajeFila;
  esquema: Fauna;
  destino: { x: number; y: number } | null;
  /** por qué va hacia `destino`: "agua" = al llegar bebe (marca ultimaBebida); null = paseo normal, no hace nada especial al llegar. */
  objetivoDestino: "agua" | null;
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
      catalogoCombate: this.deps.catalogoCombate,
    });

    const vivos: IndividuoVivo[] = [];
    for (const fila of resultado.individuos) {
      if (fila.estado !== "vivo" || !this.transitable(fila.x, fila.y)) continue;
      const esquema = new Fauna();
      esquema.x = fila.x + 0.5;
      esquema.y = fila.y + 0.5;
      esquema.especieId = fila.especieId;
      esquema.accion = accionIdleAlAzar();
      esquema.vida = fila.vida;
      esquema.vidaMax = fila.vidaMax;
      esquema.ataque = fila.ataque;
      this.salida.set(fila.id, esquema);
      vivos.push({ fila, esquema, destino: null, objetivoDestino: null, pausaRestante: 1 + Math.random() * 3 });
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
   * Mata a un individuo activo por su id: lo marca `estado: "muerto"`
   * (nunca vuelve a "vivo"), lo persiste así, lo quita del estado de
   * Colyseus (deja de contar como animal vivo) y crea+persiste su
   * cadáver en su sitio (pedido 2026-08-30: "al morir... aparece el
   * cadáver looteable en el suelo"). `null` si ese id no está activo
   * ahora mismo (ya murió, se desactivó su sector, o nunca existió). El
   * cadáver ya sale con loot de caza dentro si `deps.catalogoItems` está
   * puesto (docs/GDD_Caza.md) — carne/tendones/tripas, nunca piel (esa
   * sale aparte, de desollar).
   *
   * Invocado hoy por `HubRoom.onFaunaMuerta` al cerrar un combate real
   * contra fauna (docs/GDD_Combate.md) — comentario histórico corregido
   * 2026-08-30, antes decía "nada lo invoca todavía" (quedó desfasado en
   * cuanto se implementó el combate).
   */
  async matarIndividuo(id: string): Promise<Cadaver | null> {
    for (const vivos of this.sectoresActivos.values()) {
      const idx = vivos.findIndex((v) => v.fila.id === id);
      if (idx === -1) continue;
      const v = vivos[idx];
      v.fila.x = v.esquema.x;
      v.fila.y = v.esquema.y;
      v.fila.estado = "muerto";
      await this.deps.guardarIndividuo(v.fila);
      this.salida.delete(v.fila.id);
      vivos.splice(idx, 1);

      const cadaver = crearCadaver({
        id: `cadaver:${v.fila.id}`,
        mapaId: this.deps.mapaId,
        tipoOrigen: "animal",
        especieOrigenId: v.fila.especieId,
        x: v.fila.x,
        y: v.fila.y,
        ahora: this.deps.ahora(),
      });
      // Loot de caza (docs/GDD_Caza.md): carne/tendones/tripas SIEMPRE, la
      // piel queda aparte para quien lo desuelle (cadaver:desollar).
      if (this.deps.catalogoItems) {
        const especie = this.deps.catalogoCombate?.[v.fila.especieId] ?? estadisticasCombatePorDefecto();
        rellenarLootCaza(cadaver.contenedor, this.deps.catalogoItems, especie);
      }
      await this.deps.crearCadaver(cadaver);
      return cadaver;
    }
    return null;
  }

  /**
   * Domestica a un individuo activo (docs/GDD_Ganaderia.md +
   * docs/GDD_Monturas.md, pedido 2026-08-30, mismo método para ambas: un
   * `AnimalGranja` de granja y una mascota/montura salen de aquí igual):
   * mismo camino de salida que `matarIndividuo` (marca `estado:"muerto"` —
   * reusa el mismo valor, el resto del sistema solo necesita saber "ya no
   * vive en la fauna salvaje", el motivo real no le importa — y lo quita
   * del sector activo) pero SIN crear cadáver ni loot: no murió. Devuelve
   * la especie para que quien llama sepa qué acaba de domesticar, o
   * `null` si el id no está activo ahora mismo.
   */
  async domesticar(id: string): Promise<string | null> {
    for (const vivos of this.sectoresActivos.values()) {
      const idx = vivos.findIndex((v) => v.fila.id === id);
      if (idx === -1) continue;
      const v = vivos[idx];
      v.fila.x = v.esquema.x;
      v.fila.y = v.esquema.y;
      v.fila.estado = "muerto";
      await this.deps.guardarIndividuo(v.fila);
      this.salida.delete(v.fila.id);
      vivos.splice(idx, 1);
      return v.fila.especieId;
    }
    return null;
  }

  /**
   * Aplica daño a un individuo activo (docs/GDD_Mecanicas.md §5.4, pedido
   * 2026-08-30) — los animales NO tienen defensa, así que `danio` se resta
   * directo de su vida. Si la vida llega a 0, mata al individuo por el
   * mismo camino que `matarIndividuo` (marca muerto, persiste, quita del
   * estado, crea cadáver). `null` si el id no está activo ahora mismo.
   *
   * PUNTO DE ENGANCHE, igual que `matarIndividuo`: hoy solo la llama el
   * mensaje `combate:atacar` de HubRoom — el resto de disparadores (fauna
   * cazando, magia de daño en área...) quedan para cuando existan.
   */
  async recibirDanio(id: string, danio: number): Promise<{ vida: number; vidaMax: number; muerto: boolean; cadaver: Cadaver | null } | null> {
    for (const vivos of this.sectoresActivos.values()) {
      const v = vivos.find((x) => x.fila.id === id);
      if (!v) continue;
      const stats = aplicarDanio({ vida: v.esquema.vida, vidaMax: v.esquema.vidaMax, ataque: v.esquema.ataque, defensa: 0 }, danio);
      v.esquema.vida = stats.vida;
      v.fila.vida = stats.vida;
      if (estaMuerto(stats)) {
        const cadaver = await this.matarIndividuo(id);
        return { vida: 0, vidaMax: v.fila.vidaMax, muerto: true, cadaver };
      }
      await this.deps.guardarIndividuo(v.fila);
      return { vida: stats.vida, vidaMax: v.fila.vidaMax, muerto: false, cadaver: null };
    }
    return null;
  }

  /**
   * Curación explícita — un jugador cura A PROPÓSITO con un objeto/magia
   * (regla de diseño: los animales NUNCA se regeneran solos con el
   * tiempo). `null` si el id no está activo ahora mismo.
   */
  async curarIndividuo(id: string, cantidad: number): Promise<{ vida: number; vidaMax: number } | null> {
    for (const vivos of this.sectoresActivos.values()) {
      const v = vivos.find((x) => x.fila.id === id);
      if (!v) continue;
      const stats = curar({ vida: v.esquema.vida, vidaMax: v.esquema.vidaMax, ataque: v.esquema.ataque, defensa: 0 }, cantidad);
      v.esquema.vida = stats.vida;
      v.fila.vida = stats.vida;
      await this.deps.guardarIndividuo(v.fila);
      return { vida: stats.vida, vidaMax: v.fila.vidaMax };
    }
    return null;
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

  /**
   * Mismo algoritmo de paseo que `GestorFauna` (mundo/fauna.ts), con
   * hambre/sed por encima (pedido 2026-08-30, "1 vez al día beber agua...
   * herbívoros [comen] algo del suelo, carnívoros cada más días"): antes
   * de decidir un paseo al azar, cada individuo (adulto — las crías nunca
   * necesitan nada, comen de sus padres) comprueba si necesita agua o
   * comida y, si toca, eso manda sobre el merodeo normal:
   * - Sed: SIEMPRE (granja o salvaje, cualquier dieta) — busca la casilla
   *   de agua transitable más cercana y camina hasta ella; al llegar,
   *   bebe (marca `ultimaBebida`). Si no encuentra agua cerca, no se
   *   bloquea: sigue paseando y lo reintenta el próximo ciclo idle.
   * - Comida herbívoro/omnívoro: "algo del suelo" — como no necesita
   *   desplazarse a ningún sitio especial, come donde está (marca
   *   `ultimaComida` de inmediato) con una pausa de "comer".
   * - Comida carnívoro: sin comportamiento activo todavía — depende de
   *   cazar, y cazar depende de un sistema de combate que no existe
   *   (pedido explícito: "ahora resolveremos combate, no te preocupes").
   *   Sigue paseando con normalidad; su ventana de 6 días le da margen de
   *   sobra hasta que ese sistema exista.
   */
  tick(dt: number): void {
    const ahora = this.deps.ahora();
    for (const vivos of this.sectoresActivos.values()) {
      for (const v of vivos) {
        if (v.destino) {
          this.avanzarHaciaDestino(v, dt, ahora);
          continue;
        }
        v.pausaRestante -= dt;
        if (v.pausaRestante > 0) continue;

        const especie = this.deps.catalogo[v.fila.especieId];
        const animal = convertirFilaAAnimal(v.fila);
        if (especie && necesitaAgua(animal, ahora)) {
          const destinoAgua = this.buscarAguaCercana(v.esquema.x, v.esquema.y);
          if (destinoAgua) {
            v.destino = destinoAgua;
            v.objetivoDestino = "agua";
            v.esquema.accion = "caminar";
            continue;
          }
        }
        if (especie && especie.dieta !== "carnivoro" && necesitaComida(animal, especie, ahora)) {
          v.fila.ultimaComida = ahora;
          v.esquema.accion = "comer";
          v.pausaRestante = 2 + Math.random() * 2;
          continue;
        }

        const destino = this.elegirDestino(v);
        if (destino) {
          v.destino = destino;
          v.objetivoDestino = null;
          v.esquema.accion = "caminar";
        } else {
          v.pausaRestante = 2;
          v.esquema.accion = accionIdleAlAzar();
        }
      }
    }
  }

  /** Centroide de vecinos ACTIVOS de la misma especie dentro de RADIO_MANADA (busca en todos los sectores activos, no solo el propio — un grupo puede repartirse entre sectores vecinos). `null` si no hay ninguno cerca. */
  private centroideManada(v: IndividuoVivo): { x: number; y: number } | null {
    let sx = 0, sy = 0, n = 0;
    for (const vivos of this.sectoresActivos.values()) {
      for (const otro of vivos) {
        if (otro === v || otro.fila.especieId !== v.fila.especieId) continue;
        if (Math.hypot(otro.esquema.x - v.esquema.x, otro.esquema.y - v.esquema.y) > RADIO_MANADA) continue;
        sx += otro.esquema.x;
        sy += otro.esquema.y;
        n++;
      }
    }
    return n > 0 ? { x: sx / n, y: sy / n } : null;
  }

  private elegirDestino(v: IndividuoVivo): { x: number; y: number } | null {
    // Cohesión de manada/banco/bandada (pedido 2026-08-31): si la especie es
    // gregaria y hay vecinos cerca, el CENTRO del merodeo se desplaza un
    // poco hacia el centroide del grupo en vez de quedarse siempre sobre el
    // propio individuo — con PESO_COHESION bajo, tira del grupo sin
    // apelmazarlo ni moverlo en bloque de forma robótica.
    const especie = this.deps.catalogo[v.fila.especieId];
    const combate = this.deps.catalogoCombate?.[v.fila.especieId];
    const centro = esGregario(especie?.dieta, combate) ? this.centroideManada(v) : null;
    const baseX = centro ? v.esquema.x + (centro.x - v.esquema.x) * PESO_COHESION : v.esquema.x;
    const baseY = centro ? v.esquema.y + (centro.y - v.esquema.y) * PESO_COHESION : v.esquema.y;
    for (let intento = 0; intento < 6; intento++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * RADIO_MERODEO;
      const cx = baseX + Math.cos(ang) * dist;
      const cy = baseY + Math.sin(ang) * dist;
      if (this.transitable(cx, cy)) return { x: cx, y: cy };
    }
    return null;
  }

  /** Busca la casilla de agua más cercana en anillos crecientes — sin A*, solo para decidir un punto al que caminar en línea recta (mismo criterio que el resto del merodeo). `null` si no hay agua dentro del radio de búsqueda. */
  private buscarAguaCercana(cx: number, cy: number): { x: number; y: number } | null {
    const m = this.deps.mundo;
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    for (let r = 1; r <= RADIO_BUSQUEDA_AGUA; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // solo el anillo de este radio, el interior ya se miró
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= m.ancho || y >= m.alto) continue;
          const t = m.casillas[y * m.ancho + x];
          if (t === TIPO.AGUA || t === TIPO.AGUA_PROFUNDA) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return null;
  }

  private avanzarHaciaDestino(v: IndividuoVivo, dt: number, ahora: number): void {
    const dx = v.destino!.x - v.esquema.x;
    const dy = v.destino!.y - v.esquema.y;
    const dist = Math.hypot(dx, dy);
    const paso = VEL * dt;
    if (dist <= paso) {
      v.esquema.x = v.destino!.x;
      v.esquema.y = v.destino!.y;
      if (v.objetivoDestino === "agua") v.fila.ultimaBebida = ahora;
      v.destino = null;
      v.objetivoDestino = null;
      v.pausaRestante = 2 + Math.random() * 4;
      v.esquema.accion = accionIdleAlAzar();
    } else {
      v.esquema.x += (dx / dist) * paso;
      v.esquema.y += (dy / dist) * paso;
    }
  }
}
