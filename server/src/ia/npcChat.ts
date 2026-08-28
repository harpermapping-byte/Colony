// Orquesta el diálogo con NPCs (docs/GDD_IA_NPCs.md): junta el contexto
// general del mundo + la personalidad del NPC + lo que sabe (RAG sobre su
// conocimiento) + un historial corto anti-repetición, y llama al proveedor
// de IA (con fallback automático si el principal se queda sin cuota).
import * as fs from "node:fs";
import * as path from "node:path";
import { IProveedorIA, IProveedorEmbeddings, crearProveedorIA, crearProveedorEmbeddings } from "./proveedor";
import { similitudCoseno, MemoriaConversaciones } from "./memoria";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const MAX_FRAGMENTOS_PROMPT = 3;

interface EntradaNpc {
  profesion?: string;
  personalidad?: string;
  conocimiento?: string[];
}

interface FragmentoEmbebido {
  texto: string;
  embedding: number[];
}

function leerContextoMundo(): string {
  const ruta = path.join(RAIZ_REPO, "personajes", "catalogo", "contexto_mundo.json");
  const datos = JSON.parse(fs.readFileSync(ruta, "utf8")) as { texto: string };
  return datos.texto;
}

function leerNpc(npcId: string): EntradaNpc | undefined {
  const ruta = path.join(RAIZ_REPO, "personajes", "catalogo", "npcs.json");
  const catalogo = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaNpc>;
  return catalogo[npcId];
}

/** Una instancia vive mientras vive la room (estado en RAM): el embedding
 * del conocimiento de cada NPC se calcula una sola vez por proceso (no hay
 * catálogo grande que justifique un bake offline aparte todavía — cuando
 * la lista de NPCs crezca de verdad, esto se puede mover a un script como
 * el resto de bakes, sin tocar la interfaz de este módulo). */
export class GestorConversacionesNpc {
  private contextoMundo = leerContextoMundo();
  private cacheConocimiento = new Map<string, Promise<FragmentoEmbebido[]>>();
  private memoria = new MemoriaConversaciones();

  constructor(
    private proveedorIA: IProveedorIA | undefined = crearProveedorIA(),
    private proveedorEmbeddings: IProveedorEmbeddings | undefined = crearProveedorEmbeddings(),
  ) {}

  get disponible(): boolean {
    return this.proveedorIA !== undefined;
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
    const npc = leerNpc(npcId);
    if (!npc) throw new Error(`NPC desconocido: ${npcId}`);

    const saber = await this.saberRelevante(npcId, npc.conocimiento ?? [], mensaje);
    const dichoAntes = this.memoria.ultimasRespuestas(npcId, jugador);

    const systemPrompt = [
      this.contextoMundo,
      `Interpretas a "${npcId}"${npc.profesion ? ` (${npc.profesion})` : ""}.`,
      npc.personalidad ? `Tu personalidad: ${npc.personalidad}` : "",
      saber.length ? `Lo que sabes:\n- ${saber.join("\n- ")}` : "",
      dichoAntes.length
        ? `No repitas literalmente ninguna de estas frases que ya dijiste antes:\n- ${dichoAntes.join("\n- ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const respuesta = await this.proveedorIA.generarTexto(systemPrompt, mensaje, { temperatura: 0.9 });
    this.memoria.registrar(npcId, jugador, respuesta);
    return respuesta;
  }
}
