// Orquesta el diálogo con NPCs (docs/GDD_IA_NPCs.md): junta el contexto
// general del mundo + el perfil conversacional + el ámbito de conocimiento
// por ROL (v3, qué sabe/qué NO sabe según su arquetipo) + la biografía
// INDIVIDUAL del NPC (o la del arquetipo si no tiene una propia) + lo que
// sabe (RAG sobre su conocimiento) + memoria real de este jugador concreto +
// un historial corto anti-repetición, y llama al proveedor de IA (con
// fallback automático si el principal se queda sin cuota).
import * as fs from "node:fs";
import * as path from "node:path";
import { IProveedorIA, IProveedorEmbeddings, crearProveedorIA, crearProveedorEmbeddings } from "./proveedor";
import { similitudCoseno, MemoriaConversaciones } from "./memoria";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const MAX_FRAGMENTOS_PROMPT = 3;
// Cuántos mensajes pasados de ESTE jugador con ESTE NPC se inyectan en un
// prompt concreto — menos que el tope real de BD (TOPE_MEMORIA_NPC en
// bd.ts, 20): de sobra para "te recuerdo", sin disparar el gasto de tokens.
const MAX_MEMORIA_JUGADOR_PROMPT = 6;

interface EntradaArquetipo {
  profesion?: string;
  personalidad?: string;
  conocimiento?: string[];
  ambitoConocimientoId?: string;
}

interface EntradaNpc {
  profesion?: string;
  personalidad?: string;
  conocimiento: string[];
  ambitoConocimientoId?: string;
}

interface FragmentoEmbebido {
  texto: string;
  embedding: number[];
}

/**
 * docs/GDD_IA_NPCs.md (pedido 2026-09-08) — lo que una Room concreta sabe de
 * UN individuo (de `poblacion.json`, vía `mundo/agentes.ts::NpcBakeado`).
 * `resolverIndividual` por defecto no devuelve nada (mismo comportamiento
 * de siempre: cae al arquetipo genérico por `npcId`) — HubRoom/RegionRoom lo
 * inyectan de verdad. Con individual pero sin `historia` (falló el bake o
 * nunca hubo GEMINI_API_KEY), `personalidad`/`conocimiento` quedan vacíos
 * aquí y `leerNpc` cae solos al arquetipo de su `oficio`.
 */
export interface DatosNpcIndividual {
  oficio?: string;
  personalidad?: string;
  conocimiento?: string[];
  perfilConversacionalId?: string | null;
}

/**
 * Memoria REAL de NPC↔jugador (docs/GDD_IA_NPCs.md, pedido streamer
 * "que el npc... quede con el nombre del player y lo cuente la siguiente
 * conversación") — persistida en BD (`bd.ts::registrarMemoriaNpc`/
 * `memoriaNpcJugador`), inyectada por quien construye `GestorConversacionesNpc`
 * para no acoplar este módulo a `datos/bd.ts` (mismo criterio de
 * testabilidad que `proveedorIA`/`proveedorEmbeddings`: sin esto inyectado,
 * `hablar()` sigue funcionando exactamente igual que antes, sin memoria).
 */
export interface IMemoriaNpcPersistente {
  obtener(npcId: string, jugador: string): Promise<string[]>;
  agregar(npcId: string, jugador: string, mensaje: string): Promise<void>;
}

function leerContextoMundo(): string {
  const ruta = path.join(RAIZ_REPO, "personajes", "catalogo", "contexto_mundo.json");
  const datos = JSON.parse(fs.readFileSync(ruta, "utf8")) as { texto: string };
  return datos.texto;
}

function leerArquetipo(id: string): EntradaArquetipo | undefined {
  const ruta = path.join(RAIZ_REPO, "personajes", "catalogo", "npcs.json");
  const catalogo = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaArquetipo>;
  return catalogo[id];
}

function leerPerfilesConversacionales(): Record<string, { instruccion: string }> {
  const ruta = path.join(RAIZ_REPO, "poblacion", "catalogo", "perfilesConversacionales.json");
  const catalogo = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, { instruccion: string } | string>;
  const salida: Record<string, { instruccion: string }> = {};
  for (const [id, valor] of Object.entries(catalogo)) {
    if (id.startsWith("_") || typeof valor === "string") continue;
    salida[id] = valor;
  }
  return salida;
}

interface AmbitoConocimiento {
  nombre: string;
  sabe: string[];
  noSabe: string[];
}

/**
 * docs/GDD_IA_NPCs.md v3 (pedido streamer: clasificación de tipos de NPC —
 * qué sabe y qué NO sabe cada uno según su ROL). Distinto del perfil
 * conversacional (el TONO, al azar por individuo): esto es el temario fijo
 * por arquetipo (personajes/catalogo/npcs.json::ambitoConocimientoId) — un
 * guardia siempre tiene ámbito de guardia, nunca le toca al azar el de un
 * bandido. Catálogo pequeño (7 entradas), sin coste de IA, mismo patrón de
 * lectura directa que `leerPerfilesConversacionales`.
 */
function leerAmbitosConocimiento(): Record<string, AmbitoConocimiento> {
  const ruta = path.join(RAIZ_REPO, "personajes", "catalogo", "ambitosConocimiento.json");
  const catalogo = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, AmbitoConocimiento | string>;
  const salida: Record<string, AmbitoConocimiento> = {};
  for (const [id, valor] of Object.entries(catalogo)) {
    if (id.startsWith("_") || typeof valor === "string") continue;
    salida[id] = valor;
  }
  return salida;
}

/** Una instancia vive mientras vive la room (estado en RAM): el embedding
 * del conocimiento de cada NPC se calcula una sola vez por proceso (no hay
 * catálogo grande que justifique un bake offline aparte todavía — cuando
 * la lista de NPCs crezca de verdad, esto se puede mover a un script como
 * el resto de bakes, sin tocar la interfaz de este módulo). */
export class GestorConversacionesNpc {
  private contextoMundo = leerContextoMundo();
  private perfilesConversacionales = leerPerfilesConversacionales();
  private ambitosConocimiento = leerAmbitosConocimiento();
  private cacheConocimiento = new Map<string, Promise<FragmentoEmbebido[]>>();
  private memoria = new MemoriaConversaciones();

  constructor(
    private proveedorIA: IProveedorIA | undefined = crearProveedorIA(),
    private proveedorEmbeddings: IProveedorEmbeddings | undefined = crearProveedorEmbeddings(),
    /** docs/GDD_IA_NPCs.md — por defecto ningún individuo (comportamiento de siempre: arquetipo genérico por `npcId`); HubRoom/RegionRoom lo sobreescriben con la biografía real de `poblacion.json`. */
    private resolverIndividual: (npcId: string) => DatosNpcIndividual | undefined = () => undefined,
    /** Sin esto (tests, o una Room sin BD configurada), el diálogo funciona exactamente igual que antes: sin memoria real entre sesiones, solo el anti-repetición en RAM de siempre. */
    private memoriaPersistente?: IMemoriaNpcPersistente,
    /**
     * docs/GDD_IA_NPCs.md v3bis (pedido streamer: "un npc llamado pregonero
     * que te cuente... las novedades del día") — log GLOBAL de sucesos
     * reales (`bd.ts::novedadesRecientes`), inyectado SOLO si el NPC es de
     * profesión "pregonero" (ver `hablar`). Sin esto (tests, o sin BD), un
     * pregonero sigue funcionando con su `conocimiento` de catálogo de
     * siempre, solo sin novedades reales que anunciar.
     */
    private novedadesProveedor?: () => Promise<string[]>,
  ) {}

  get disponible(): boolean {
    return this.proveedorIA !== undefined;
  }

  /**
   * Junta individuo (poblacion.json, vía `resolverIndividual`) + arquetipo
   * (personajes/catalogo/npcs.json) — el individuo manda campo a campo,
   * cayendo al arquetipo de SU `oficio` (o al `npcId` tal cual si no hay
   * individuo, comportamiento IDÉNTICO al de antes de esta pieza) donde
   * falte. Antes de esto, CUALQUIER NPC del mismo arquetipo (ej. "herrero")
   * compartía personalidad/conocimiento Y hasta el propio `npcId` de
   * catálogo — ahora cada individuo tiene los suyos si `poblacion/` le
   * generó una biografía real.
   */
  private leerNpc(npcId: string): EntradaNpc | undefined {
    const individual = this.resolverIndividual(npcId);
    const claveArquetipo = individual?.oficio ?? npcId;
    const arquetipo = leerArquetipo(claveArquetipo);
    if (!individual && !arquetipo) return undefined;
    const conocimientoIndividual = individual?.conocimiento;
    return {
      profesion: individual?.oficio ?? arquetipo?.profesion,
      personalidad: individual?.personalidad ?? arquetipo?.personalidad,
      conocimiento: conocimientoIndividual && conocimientoIndividual.length > 0 ? conocimientoIndividual : (arquetipo?.conocimiento ?? []),
      // Fijo por ROL, siempre del arquetipo — a diferencia de personalidad/
      // conocimiento, ningún individuo lo sobreescribe (un herrero concreto
      // puede tener su propia biografía, pero su ámbito de saber sigue
      // siendo el de "mercader/artesano", nunca al azar el de un bandido).
      ambitoConocimientoId: arquetipo?.ambitoConocimientoId,
    };
  }

  private conocimientoEmbebido(npcId: string, fragmentos: string[]): Promise<FragmentoEmbebido[]> {
    let promesa = this.cacheConocimiento.get(npcId);
    if (!promesa) {
      promesa = Promise.all(
        fragmentos.map(async (texto) => ({
          texto,
          embedding: await this.proveedorEmbeddings!.generarEmbedding(texto),
        })),
      );
      this.cacheConocimiento.set(npcId, promesa);
    }
    return promesa;
  }

  /** Los fragmentos relevantes para "mensaje": si hay pocos (típico hoy, 2-3
   * por NPC) se usan todos sin gastar tokens de embeddings; con más, se
   * eligen los MAX_FRAGMENTOS_PROMPT más afines por similitud coseno. */
  private async saberRelevante(npcId: string, fragmentos: string[], mensaje: string): Promise<string[]> {
    if (fragmentos.length <= MAX_FRAGMENTOS_PROMPT || !this.proveedorEmbeddings) return fragmentos;
    const embebidos = await this.conocimientoEmbebido(npcId, fragmentos);
    const embeddingPregunta = await this.proveedorEmbeddings.generarEmbedding(mensaje);
    return embebidos
      .map((f) => ({ texto: f.texto, score: similitudCoseno(embeddingPregunta, f.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FRAGMENTOS_PROMPT)
      .map((f) => f.texto);
  }

  async hablar(npcId: string, jugador: string, mensaje: string): Promise<string> {
    if (!this.proveedorIA) {
      throw new Error("sin proveedor de IA configurado (falta GEMINI_API_KEY/GROQ_API_KEY)");
    }
    const npc = this.leerNpc(npcId);
    if (!npc) throw new Error(`NPC desconocido: ${npcId}`);

    const saber = await this.saberRelevante(npcId, npc.conocimiento, mensaje);
    const dichoAntes = this.memoria.ultimasRespuestas(npcId, jugador);
    const perfilConversacionalId = this.resolverIndividual(npcId)?.perfilConversacionalId;
    const perfil = perfilConversacionalId ? this.perfilesConversacionales[perfilConversacionalId] : undefined;
    const ambito = npc.ambitoConocimientoId ? this.ambitosConocimiento[npc.ambitoConocimientoId] : undefined;

    // Memoria real de ESTE jugador con ESTE NPC (docs/GDD_IA_NPCs.md) — un
    // fallo leyendo BD nunca debe tumbar la conversación, se sigue como si
    // no hubiera memoria (mismo criterio "degradar, no romper" del resto
    // del proyecto con IA/red real).
    let recuerdos: string[] = [];
    if (this.memoriaPersistente) {
      try {
        recuerdos = await this.memoriaPersistente.obtener(npcId, jugador);
      } catch (err) {
        console.warn(`GestorConversacionesNpc: no se pudo leer memoria de ${npcId}|${jugador}: ${(err as Error).message}`);
      }
    }

    // Novedades del reino (docs/GDD_IA_NPCs.md v3bis) — SOLO el pregonero
    // las anuncia; cualquier otro NPC de rol `bardo_rumorero` (chismosa,
    // bardo_malo...) sigue con su cotilleo de catálogo de siempre, no el
    // log real de sucesos. Mismo criterio "degradar, no romper" que la
    // memoria de arriba si la BD falla.
    let novedades: string[] = [];
    if (npc.profesion === "pregonero" && this.novedadesProveedor) {
      try {
        novedades = await this.novedadesProveedor();
      } catch (err) {
        console.warn(`GestorConversacionesNpc: no se pudieron leer las novedades para ${npcId}: ${(err as Error).message}`);
      }
    }

    const systemPrompt = [
      this.contextoMundo,
      `Interpretas a "${npcId}"${npc.profesion ? ` (${npc.profesion})` : ""}.`,
      npc.personalidad ? `Tu personalidad: ${npc.personalidad}` : "",
      perfil ? perfil.instruccion : "",
      ambito?.sabe.length ? `Como ${ambito.nombre}, puedes hablar con soltura de:\n- ${ambito.sabe.join("\n- ")}` : "",
      ambito?.noSabe.length
        ? `NO sabes nada de esto — si te preguntan, niégalo, desvía la conversación o admite tu ignorancia, nunca inventes datos como si fueran ciertos:\n- ${ambito.noSabe.join("\n- ")}`
        : "",
      novedades.length
        ? `Eres el pregonero: cuando te pregunten qué ha pasado o por las novedades, anuncia estos sucesos reales y recientes con tu teatro habitual (puedes adornarlos, nunca inventarte otros que no estén aquí):\n- ${novedades.join("\n- ")}`
        : npc.profesion === "pregonero"
          ? "Eres el pregonero, pero hoy no tienes ninguna novedad real que contar — dilo con tu propio estilo (p.ej. un día tranquilo, sin sucesos dignos de pregonar), nunca inventes una noticia falsa."
          : "",
      saber.length ? `Lo que sabes de tu propia vida:\n- ${saber.join("\n- ")}` : "",
      recuerdos.length
        ? `Ya has hablado antes con el jugador "${jugador}". Esto es lo que recuerdas que te dijo, en orden del más reciente al más antiguo:\n- ${recuerdos.join("\n- ")}`
        : `Es la primera vez que hablas con el jugador "${jugador}" — no finjas conocerlo de antes.`,
      dichoAntes.length
        ? `No repitas literalmente ninguna de estas frases que ya dijiste antes:\n- ${dichoAntes.join("\n- ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const respuesta = await this.proveedorIA.generarTexto(systemPrompt, mensaje, { temperatura: 0.9 });
    this.memoria.registrar(npcId, jugador, respuesta);
    if (this.memoriaPersistente) {
      try {
        await this.memoriaPersistente.agregar(npcId, jugador, mensaje);
      } catch (err) {
        console.warn(`GestorConversacionesNpc: no se pudo guardar memoria de ${npcId}|${jugador}: ${(err as Error).message}`);
      }
    }
    return respuesta;
  }
}
