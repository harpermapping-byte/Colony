import vocabularioJson from "../../../taller-vox/catalogo/vocabularioMuebles.json";
import coloresJson from "../../../ropa/catalogo/vocabularioLegendario.json";

/**
 * PUERTO nativo (TS/ESM) de `taller-vox/interpretarPromptMueble.js` — MISMO
 * algoritmo, mantenido en sincronía a mano (mismo criterio que
 * `interpretarPrompt.ts` del sastre). Usado SOLO para la vista previa
 * instantánea del panel del banco de carpintero — el resultado final
 * SIEMPRE lo decide el servidor reinterpretando el mismo texto por su cuenta.
 */

interface EntradaSimple { valor: string; palabras: string[]; hex?: string; }
interface EntradaModificador { campo: string; valor: boolean; palabras: string[]; }
interface EntradaEstilo { palabras: string[]; madera?: string; detalle?: Record<string, unknown>; color?: string; }
interface VocabularioMuebles {
  tipoMueble: EntradaSimple[];
  madera: EntradaSimple[];
  modificador: EntradaModificador[];
  estilo: EntradaEstilo[];
}
interface EntradaColor { valor: string; palabras: string[]; }

const VOCABULARIO = vocabularioJson as unknown as VocabularioMuebles;
const COLORES = (coloresJson as unknown as { color: EntradaColor[] }).color;

export const ARQUETIPO_POR_TIPO: Record<string, string> = { silla: "silla", mesa: "mesa_comedor", cama: "cama_individual", arcon: "arcon" };
const MADERA_POR_DEFECTO: EntradaSimple = { valor: "roble", hex: "#5a3d20", palabras: [] };

export interface ResultadoInterpretacionMueble {
  tipoMueble: string;
  arquetipoId: string;
  maderaId: string;
  colorMadera: string;
  colorAcento: string | null;
  tallado: boolean;
  desgaste: boolean;
  roto: boolean;
  tapizado: boolean;
  incrustado: boolean;
  herraje: boolean;
}

function normalizar(texto: string): string {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function algunaPalabraCoincide(t: string, palabras: string[]): boolean {
  return palabras.some((p) => t.includes(normalizar(p)));
}

function analizarPalabrasClave(texto: string) {
  const t = normalizar(texto);
  const resultado: Record<string, unknown> = { tipoMueble: null, maderaId: null, colorAcento: null, tallado: false, desgaste: false, roto: false, tapizado: false, incrustado: false, herraje: false };

  for (const entrada of VOCABULARIO.estilo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) {
      if (entrada.madera) resultado.maderaId = entrada.madera;
      if (entrada.detalle) Object.assign(resultado, entrada.detalle);
      if (entrada.color) resultado.colorAcento = entrada.color;
      break;
    }
  }
  for (const entrada of VOCABULARIO.tipoMueble || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoMueble = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.madera || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.maderaId = entrada.valor; break; }
  }
  for (const entrada of VOCABULARIO.modificador || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado[entrada.campo] = entrada.valor;
  }
  for (const entrada of COLORES) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorAcento = entrada.valor; break; }
  }
  return resultado;
}

function resolverMadera(maderaId: string | null): EntradaSimple {
  if (maderaId) {
    const entrada = VOCABULARIO.madera.find((m) => m.valor === maderaId);
    if (entrada) return entrada;
  }
  return MADERA_POR_DEFECTO;
}

/** Texto libre → parámetros válidos para `generarMuebleVoxel` — MISMO contrato que `taller-vox/interpretarPromptMueble.js`. */
export function interpretarPromptMueble(texto: string): ResultadoInterpretacionMueble {
  const analisis = analizarPalabrasClave(texto);
  const tipoMueble = (analisis.tipoMueble as string) || "silla";
  const arquetipoId = ARQUETIPO_POR_TIPO[tipoMueble];
  const madera = resolverMadera(analisis.maderaId as string | null);
  return {
    tipoMueble,
    arquetipoId,
    maderaId: madera.valor,
    colorMadera: madera.hex!,
    colorAcento: analisis.colorAcento as string | null,
    tallado: !!analisis.tallado,
    desgaste: !!analisis.desgaste,
    roto: !!analisis.roto,
    tapizado: !!analisis.tapizado,
    incrustado: !!analisis.incrustado,
    herraje: !!analisis.herraje,
  };
}
