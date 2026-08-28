// Utilidades de memoria para el diálogo de NPCs (docs/GDD_IA_NPCs.md).

/** Similitud coseno entre dos embeddings de igual longitud: 1 = idénticos en
 * significado, 0 = sin relación. Base de la búsqueda de conocimiento (RAG). */
export function similitudCoseno(a: number[], b: number[]): number {
  let punto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    punto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  const denominador = Math.sqrt(normaA) * Math.sqrt(normaB);
  return denominador === 0 ? 0 : punto / denominador;
}

const MAX_HISTORIAL = 4;

/** Últimas respuestas dadas por cada NPC a cada jugador, en RAM (vive
 * mientras vive la room — no hace falta persistirlo). Se usa para pedirle a
 * la IA que no repita literalmente lo que ya dijo: sin esto, un modelo con
 * poco contexto tiende a caer siempre en la misma frase "de manual" para la
 * misma pregunta. */
export class MemoriaConversaciones {
  private historial = new Map<string, string[]>();

  private clave(npcId: string, jugador: string): string {
    return `${npcId}|${jugador}`;
  }

  ultimasRespuestas(npcId: string, jugador: string): string[] {
    return this.historial.get(this.clave(npcId, jugador)) ?? [];
  }

  registrar(npcId: string, jugador: string, respuesta: string): void {
    const clave = this.clave(npcId, jugador);
    const lista = this.historial.get(clave) ?? [];
    lista.push(respuesta);
    if (lista.length > MAX_HISTORIAL) lista.shift();
    this.historial.set(clave, lista);
  }
}
