// Proveedores de IA para diálogo de NPCs (docs/GDD_IA_NPCs.md). Dos motores
// gratuitos intercambiables tras la misma interfaz — mismo patrón que
// datos/bd.ts (IAlmacenDatos con SQLite/Postgres): si el principal falla
// (límite de cuota gratis agotado, error de red...) se reintenta con el de
// respaldo sin que el jugador note el cambio.

export interface IProveedorIA {
  nombre: string;
  generarTexto(
    systemPrompt: string,
    mensaje: string,
    opciones?: { temperatura?: number },
  ): Promise<string>;
}

export interface IProveedorEmbeddings {
  generarEmbedding(texto: string): Promise<number[]>;
}

const MODELO_GEMINI = "gemini-2.0-flash";
const MODELO_EMBEDDING_GEMINI = "text-embedding-004";
const MODELO_GROQ = "llama-3.3-70b-versatile";
const MAX_TOKENS_RESPUESTA = 200;

export class GeminiProveedor implements IProveedorIA, IProveedorEmbeddings {
  nombre = "gemini";
  constructor(private apiKey: string) {}

  async generarTexto(
    systemPrompt: string,
    mensaje: string,
    opciones?: { temperatura?: number },
  ): Promise<string> {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: mensaje }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: opciones?.temperatura ?? 0.8,
            maxOutputTokens: MAX_TOKENS_RESPUESTA,
          },
        }),
      },
    );
    if (!resp.ok) throw new Error(`gemini ${resp.status}: ${await resp.text()}`);
    const datos = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texto = datos.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error("gemini: respuesta sin texto (posible bloqueo de seguridad)");
    return texto.trim();
  }

  async generarEmbedding(texto: string): Promise<number[]> {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EMBEDDING_GEMINI}:embedContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: texto }] } }),
      },
    );
    if (!resp.ok) throw new Error(`gemini embeddings ${resp.status}: ${await resp.text()}`);
    const datos = (await resp.json()) as { embedding?: { values?: number[] } };
    if (!Array.isArray(datos.embedding?.values)) {
      throw new Error("gemini embeddings: respuesta sin valores");
    }
    return datos.embedding.values;
  }
}

export class GroqProveedor implements IProveedorIA {
  nombre = "groq";
  constructor(private apiKey: string) {}

  async generarTexto(
    systemPrompt: string,
    mensaje: string,
    opciones?: { temperatura?: number },
  ): Promise<string> {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODELO_GROQ,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: mensaje },
        ],
        temperature: opciones?.temperatura ?? 0.8,
        max_tokens: MAX_TOKENS_RESPUESTA,
      }),
    });
    if (!resp.ok) throw new Error(`groq ${resp.status}: ${await resp.text()}`);
    const datos = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = datos.choices?.[0]?.message?.content;
    if (!texto) throw new Error("groq: respuesta sin texto");
    return texto.trim();
  }
}

/** Envuelve dos proveedores: si el principal falla, reintenta con el de
 * respaldo antes de propagar el error. */
export class ProveedorIAConRespaldo implements IProveedorIA {
  nombre: string;
  constructor(
    private principal: IProveedorIA,
    private respaldo: IProveedorIA,
  ) {
    this.nombre = `${principal.nombre}+${respaldo.nombre}`;
  }

  async generarTexto(
    systemPrompt: string,
    mensaje: string,
    opciones?: { temperatura?: number },
  ): Promise<string> {
    try {
      return await this.principal.generarTexto(systemPrompt, mensaje, opciones);
    } catch (err) {
      console.warn(
        `IA: ${this.principal.nombre} falló (${(err as Error).message}) — usando ${this.respaldo.nombre}`,
      );
      return await this.respaldo.generarTexto(systemPrompt, mensaje, opciones);
    }
  }
}

/** GEMINI_API_KEY y/o GROQ_API_KEY por env — con las dos, Gemini es
 * principal y Groq el respaldo automático. Sin ninguna, undefined (el
 * diálogo de NPCs queda desactivado sin tumbar el servidor). */
export function crearProveedorIA(): IProveedorIA | undefined {
  const gemini = process.env.GEMINI_API_KEY ? new GeminiProveedor(process.env.GEMINI_API_KEY) : undefined;
  const groq = process.env.GROQ_API_KEY ? new GroqProveedor(process.env.GROQ_API_KEY) : undefined;
  if (gemini && groq) return new ProveedorIAConRespaldo(gemini, groq);
  return gemini ?? groq;
}

/** Groq no ofrece embeddings gratis: la búsqueda de conocimiento del NPC
 * (RAG) depende de Gemini específicamente. */
export function crearProveedorEmbeddings(): IProveedorEmbeddings | undefined {
  return process.env.GEMINI_API_KEY ? new GeminiProveedor(process.env.GEMINI_API_KEY) : undefined;
}
