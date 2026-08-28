"use strict";

// Biografía de un NPC individual (GDD_Poblacion_NPCs.md / GDD_IA_NPCs.md):
// UNA llamada a Gemini al bakear el asentamiento (nunca en directo), que
// devuelve personalidad + conocimiento propios de ESE individuo — resuelve
// el pendiente anotado en GDD_IA_NPCs.md ("cada NPC debería inventarse su
// propia vida", hoy compartida por arquetipo). Sin GEMINI_API_KEY, o si la
// llamada falla, devuelve null: el resto del pipeline sigue funcionando
// (el NPC se queda con la personalidad/conocimiento genéricos de su
// arquetipo en npcs.json).
const MODELO_GEMINI = "gemini-2.0-flash";

function construirPrompt({ contextoMundo, nombre, apellido, oficio, rolFamiliar, familiares }) {
  const relacion =
    rolFamiliar === "cabeza" && familiares?.length
      ? `Tiene familia: ${familiares.join(", ")}.`
      : rolFamiliar === "conyuge"
        ? "Es cónyuge de otro habitante del mismo hogar."
        : rolFamiliar === "hijo"
          ? "Es hijo/hija de una familia del asentamiento, aún no tiene oficio propio."
          : "Vive solo/a, sin familia declarada.";

  return [
    contextoMundo,
    `Vas a inventar la biografía de un habitante concreto de este mundo, NO vas a hablar como él.`,
    `Nombre: ${nombre} ${apellido}. Oficio: ${oficio ?? "sin oficio propio"}. ${relacion}`,
    `Devuelve SOLO un JSON con esta forma exacta, sin explicaciones fuera del JSON:`,
    `{"personalidad": "una frase describiendo su carácter", "conocimiento": ["3 a 5 frases en primera persona lógica de hechos de SU vida: de dónde viene, algo que le pasó, qué le preocupa o qué sabe hacer"]}`,
    `Todo en español, coherente con su oficio y con la ambientación. No inventes nombres de otros lugares del mundo real ni tecnología moderna.`,
  ].join("\n\n");
}

async function generarHistoria(datos, apiKey) {
  if (!apiKey) return null;
  const prompt = construirPrompt(datos);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1, responseMimeType: "application/json" },
        }),
      },
    );
    if (!resp.ok) {
      console.warn(`generarHistoria: gemini ${resp.status}: ${await resp.text()}`);
      return null;
    }
    const datosResp = await resp.json();
    const texto = datosResp?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) return null;
    const parsed = JSON.parse(texto);
    if (!parsed.personalidad || !Array.isArray(parsed.conocimiento)) return null;
    return { personalidad: parsed.personalidad, conocimiento: parsed.conocimiento };
  } catch (err) {
    console.warn(`generarHistoria: fallo generando biografía de ${datos.nombre}: ${err.message}`);
    return null;
  }
}

module.exports = { generarHistoria };
