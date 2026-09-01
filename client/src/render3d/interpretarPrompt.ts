import vocabularioJson from "../../../ropa/catalogo/vocabularioLegendario.json";
import prendasJson from "../../../ropa/catalogo/prendas.json";

/**
 * PUERTO nativo (TS/ESM) de `ropa/src/interpretarPrompt.js` — MISMO
 * algoritmo, mantenido en sincronía a mano (mismo criterio que
 * `generarPrendaVoxel.ts`/`generarPrenda.js`: límite real de bundling entre
 * CommonJS de `ropa/` y Vite/Rollup). Usado SOLO para la vista previa
 * instantánea del panel del telar (docs/GDD_Ropa_Procedural.md §Sastre
 * legendario) — el resultado final SIEMPRE lo decide el servidor
 * reinterpretando el mismo texto por su cuenta (`sastre:tejerAceptar`),
 * nunca se envía lo que calculó aquí el cliente como si fuera autoritativo.
 */

interface EntradaVocabularioSimple {
  valor: string | boolean | null;
  palabras: string[];
}
interface EntradaDetalle {
  campo: string;
  valor: string | boolean | null;
  palabras: string[];
}
interface EntradaEstilo {
  palabras: string[];
  material?: string;
  detalle?: Record<string, unknown>;
  color?: string;
}
interface VocabularioLegendario {
  tipoPrenda: EntradaVocabularioSimple[];
  detalle: EntradaDetalle[];
  material: EntradaVocabularioSimple[];
  color: EntradaVocabularioSimple[];
  estilo: EntradaEstilo[];
}

const VOCABULARIO = vocabularioJson as unknown as VocabularioLegendario;
const PRENDAS = prendasJson as Record<string, any>;

export interface ResultadoInterpretacion {
  prendaBaseId: string;
  materialId: string;
  detalle: Record<string, unknown>;
  colorHint: string | null;
}

function normalizar(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function algunaPalabraCoincide(textoNormalizado: string, palabras: string[]): boolean {
  return palabras.some((p) => textoNormalizado.includes(normalizar(p)));
}

function analizarPalabrasClave(texto: string, vocabulario: VocabularioLegendario) {
  const t = normalizar(texto);
  const resultado: { tipoPrenda: string | null; detalle: Record<string, unknown>; materialId: string | null; colorHint: string | null } = {
    tipoPrenda: null, detalle: {}, materialId: null, colorHint: null,
  };

  for (const entrada of vocabulario.estilo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) {
      if (entrada.material) resultado.materialId = entrada.material;
      if (entrada.detalle) resultado.detalle = { ...resultado.detalle, ...entrada.detalle };
      if (entrada.color) resultado.colorHint = entrada.color;
      break;
    }
  }
  for (const entrada of vocabulario.tipoPrenda || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoPrenda = entrada.valor as string; break; }
  }
  for (const entrada of vocabulario.detalle || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado.detalle[entrada.campo] = entrada.valor;
  }
  for (const entrada of vocabulario.material || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.materialId = entrada.valor as string; break; }
  }
  for (const entrada of vocabulario.color || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorHint = entrada.valor as string; break; }
  }
  return resultado;
}

function elegirPrendaBase(tipoPrenda: string, materialPreferido: string | null, catalogoPrendas: Record<string, any>): string | null {
  const candidatas = Object.entries(catalogoPrendas).filter(([id, def]: [string, any]) => !id.startsWith("_") && def.tipoPrenda === tipoPrenda);
  if (candidatas.length === 0) return null;
  if (materialPreferido) {
    const conMaterial = candidatas.find(([, def]: [string, any]) => (def.materialesCompatibles || []).includes(materialPreferido));
    if (conMaterial) return conMaterial[0];
  }
  return candidatas[0][0];
}

/** Texto libre → parámetros válidos para `generarPrendaVoxel` — MISMO contrato que `ropa/src/interpretarPrompt.js::interpretarPromptTejido`. */
export function interpretarPromptTejido(texto: string): ResultadoInterpretacion {
  const analisis = analizarPalabrasClave(texto, VOCABULARIO);
  const tipoPrenda = analisis.tipoPrenda || "camisa";
  const prendaBaseId = elegirPrendaBase(tipoPrenda, analisis.materialId, PRENDAS) || Object.keys(PRENDAS).find((k) => !k.startsWith("_"))!;
  const base = PRENDAS[prendaBaseId];
  const materialId = analisis.materialId && (base.materialesCompatibles || []).includes(analisis.materialId)
    ? analisis.materialId
    : base.materialesCompatibles[0];
  const detalle = { ...base.detalle, ...analisis.detalle };
  return { prendaBaseId, materialId, detalle, colorHint: analisis.colorHint };
}
