/**
 * Crónica de la facción bandida (docs/GDD_Faccion_Bandidos.md §7quinquies,
 * pedido 2026-08-30: "que la historia del servidor, nombres de jugadores y
 * hazañas se recuerden") — mismo motor de IA que el chat de NPCs
 * (server/src/ia/proveedor.ts, Gemini+Groq con respaldo), pero para dos
 * usos distintos que comparten los mismos hechos ya guardados en BD
 * (memoria_lider): redactar la entrada de crónica cuando cae un
 * asentamiento entero, y poner voz a un bandido concreto cuando un
 * jugador con historial se le acerca. La IA NUNCA decide nada de
 * economía/combate (eso sigue siendo determinista) — solo redacta hechos
 * que ya pasaron de verdad.
 */
import { IProveedorIA, crearProveedorIA } from "./proveedor";
import { MemoriaLider } from "../datos/bd";

function textoConquistaPorDefecto(asentamientoId: string): string {
  return `La aldea "${asentamientoId}" ha caído: su última tropa ha muerto y los jugadores la han conquistado.`;
}

/**
 * Narra la caída de un asentamiento bandido — sin IA configurada (o si
 * falla la llamada), el mismo texto de siempre (comportamiento IDÉNTICO al
 * de antes de esta pasada; nunca inventa personalidad sin IA de verdad detrás).
 */
export async function narrarConquista(
  asentamientoId: string,
  jugadores: string[],
  proveedor: IProveedorIA | undefined = crearProveedorIA(),
): Promise<string> {
  if (!proveedor) return textoConquistaPorDefecto(asentamientoId);
  try {
    const systemPrompt = [
      "Eres el cronista de un mundo de fantasía medieval.",
      `Redacta en UNA frase, en español, en tono de crónica/leyenda, que el asentamiento bandido "${asentamientoId}" acaba de caer ante unos jugadores.`,
      jugadores.length
        ? `Los responsables directos son estos jugadores: ${jugadores.join(", ")} — nómbralos tal cual.`
        : "No se sabe qué jugador concreto lo logró — no inventes ninguno.",
      "No inventes lugares ni personajes que no se te hayan dado.",
    ].join("\n");
    const texto = (await proveedor.generarTexto(systemPrompt, "Redacta la crónica de esta conquista.", { temperatura: 0.8 })).trim();
    return texto || textoConquistaPorDefecto(asentamientoId);
  } catch {
    return textoConquistaPorDefecto(asentamientoId);
  }
}

export interface ContextoGritoBandido {
  asentamientoId: string;
  rango: "recluta" | "guardia" | "lider";
  nivelEquipo: number;
  jugador: string;
  /** Eventos previos de ESTE jugador con ESTE asentamiento, más reciente primero — vacío si nunca coincidieron. */
  historial: MemoriaLider[];
}

/**
 * Frase de burbuja de un bandido cuando un jugador se le acerca — sin IA
 * configurada (o si falla), silencio (cadena vacía): fingir personalidad
 * sin IA de verdad detrás no aporta nada, mismo criterio que el resto del
 * proyecto ("costura sin consumidor real, sin comportamiento inventado").
 */
export async function generarGritoBandido(
  ctx: ContextoGritoBandido,
  proveedor: IProveedorIA | undefined = crearProveedorIA(),
): Promise<string> {
  if (!proveedor) return "";
  try {
    const systemPrompt = [
      `Eres un ${ctx.rango} de la facción bandida del asentamiento "${ctx.asentamientoId}" (nivel de equipo ${ctx.nivelEquipo} de 3).`,
      "Responde con UNA frase corta (menos de 15 palabras), en español, tono hostil/amenazante, como si la vocearas al ver acercarse a alguien.",
      ctx.historial.length
        ? `Este jugador (${ctx.jugador}) tiene historial con tu asentamiento: ${ctx.historial.map((h) => h.evento).join(" · ")}`
        : `Nunca has visto a este jugador (${ctx.jugador}) por aquí.`,
      "No uses comillas ni acotaciones de escena, solo la frase que dirías en voz alta.",
    ].join("\n");
    return (await proveedor.generarTexto(systemPrompt, "¿Qué le gritas?", { temperatura: 1.0 })).trim();
  } catch {
    return "";
  }
}
