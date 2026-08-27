import reglas from "./morfologia.json";
import proporcionesBase from "./proporcionesRig.json";

/**
 * Morfología de un personaje — los mismos tres valores viajan al generador
 * de ropa (ropa/src/generarPrenda.js): el rig dibuja el cuerpo morfado y la
 * ropa se genera sobre ESAS mismas medidas + su margen de capa, así una
 * prenda acopla igual en un personaje alto, bajo, ancho o estrecho.
 * Reglas/rangos/factores por sexo: morfologia.json (fuente única).
 */
export interface Morfologia {
  altura?: number; // ver rangos en morfologia.json
  corpulencia?: number;
  sexo?: "hombre" | "mujer";
}

export type ProporcionesRig = typeof proporcionesBase;

function acotar(valor: number, rango: { min: number; max: number }): number {
  return Math.max(rango.min, Math.min(rango.max, valor));
}

/**
 * Copia de las proporciones base con la morfología aplicada. Aplicador
 * genérico gemelo de ropa/src/morfologia.js — si cambias el CÓMO se aplica
 * (no los números del JSON), toca los dos.
 */
export function aplicarMorfologia(morfo: Morfologia = {}): ProporcionesRig {
  const sexo = (morfo.sexo && reglas.sexo[morfo.sexo]) || { hombros: 1, caderas: 1 };
  const factores: Record<string, number> = {
    altura: acotar(morfo.altura ?? reglas.rangos.altura.defecto, reglas.rangos.altura),
    corpulencia: acotar(morfo.corpulencia ?? reglas.rangos.corpulencia.defecto, reglas.rangos.corpulencia),
    hombros: sexo.hombros,
    caderas: sexo.caderas,
  };

  const copia: ProporcionesRig = JSON.parse(JSON.stringify(proporcionesBase));
  for (const [ruta, nombres] of Object.entries(reglas.escalas)) {
    const multiplicador = (nombres as string[]).reduce((acc, n) => acc * factores[n], 1);
    const partes = ruta.split(".");
    // Navegación dinámica sobre el JSON — el tipado fino se pierde aquí a
    // propósito: las rutas válidas las garantiza morfologia.json, no TS.
    let nodo: any = copia;
    for (let i = 0; i < partes.length - 1; i++) nodo = nodo[partes[i]];
    nodo[partes[partes.length - 1]] *= multiplicador;
  }
  return copia;
}
