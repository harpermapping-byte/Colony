import vocabularioJson from "../../../taller-vox/catalogo/vocabularioEdificios.json";
import coloresJson from "../../../ropa/catalogo/vocabularioLegendario.json";

/**
 * PUERTO nativo (TS/ESM) de `taller-vox/interpretarPromptEdificio.js` —
 * MISMO algoritmo (docs/GDD_Ropa_Procedural.md §Ingeniero legendario), usado
 * SOLO para la vista previa instantánea del panel de la mesa de planos — el
 * servidor SIEMPRE reinterpreta el texto por su cuenta al aceptar.
 */

interface EntradaSimple { valor: string; palabras: string[]; hex?: string; }
interface EntradaModificador { campo: string; valor: boolean; palabras: string[]; }
interface VocabularioEdificios {
  tipoEdificio: EntradaSimple[];
  material: EntradaSimple[];
  forma: EntradaSimple[];
  techo: EntradaSimple[];
  modificador: EntradaModificador[];
}
interface EntradaColor { valor: string; palabras: string[]; }

const VOCABULARIO = vocabularioJson as unknown as VocabularioEdificios;
const COLORES = (coloresJson as unknown as { color: EntradaColor[] }).color;

const MATERIAL_POR_DEFECTO: EntradaSimple = { valor: "madera", hex: "#8a6a3a", palabras: [] };
const TECHO_POR_DEFECTO: EntradaSimple = { valor: "paja", hex: "#d4b84a", palabras: [] };

export interface ResultadoInterpretacionEdificio {
  tipoEdificio: string;
  materialId: string;
  colorMaterial: string;
  techoId: string;
  colorTecho: string;
  forma: string;
  colorAcento: string | null;
  balcon: boolean;
  porche: boolean;
  ventanasGrandes: boolean;
}

function normalizar(texto: string): string {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function algunaPalabraCoincide(t: string, palabras: string[]): boolean {
  return palabras.some((p) => t.includes(normalizar(p)));
}

function analizarPalabrasClave(texto: string) {
  const t = normalizar(texto);
  const resultado: Record<string, unknown> = { tipoEdificio: null, materialId: null, forma: null, techoId: null, colorAcento: null, balcon: false, porche: false, ventanasGrandes: false };

  for (const entrada of VOCABULARIO.tipoEdificio || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoEdificio = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.material || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.materialId = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.forma || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.forma = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.techo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.techoId = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.modificador || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado[entrada.campo] = entrada.valor;
  }
  for (const entrada of COLORES) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorAcento = entrada.valor; break; }
  }
  return resultado;
}

function resolverEntrada(id: string | null, lista: EntradaSimple[], porDefecto: EntradaSimple): EntradaSimple {
  if (id) {
    const entrada = lista.find((e) => e.valor === id);
    if (entrada) return entrada;
  }
  return porDefecto;
}

export function interpretarPromptEdificio(texto: string): ResultadoInterpretacionEdificio {
  const analisis = analizarPalabrasClave(texto);
  const tipoEdificio = (analisis.tipoEdificio as string) || "casa_humilde";
  const material = resolverEntrada(analisis.materialId as string | null, VOCABULARIO.material, MATERIAL_POR_DEFECTO);
  const techo = resolverEntrada(analisis.techoId as string | null, VOCABULARIO.techo, TECHO_POR_DEFECTO);
  const forma = (analisis.forma as string) || "rect";
  return {
    tipoEdificio,
    materialId: material.valor,
    colorMaterial: material.hex!,
    techoId: techo.valor,
    colorTecho: techo.hex!,
    forma,
    colorAcento: analisis.colorAcento as string | null,
    balcon: !!analisis.balcon,
    porche: !!analisis.porche,
    ventanasGrandes: !!analisis.ventanasGrandes,
  };
}
