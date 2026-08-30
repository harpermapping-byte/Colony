/**
 * Resolución de un SECTOR de bosque — junta `crecimientoBosques.ts`
 * (reglas puras) con lo bakeado por `baker/src/decoracion.js` y lo
 * persistido en BD (`server/src/datos/bd.ts`). Mismo espíritu que
 * `faunaSalvajeSector.ts`, con una simplificación real: los árboles no
 * tienen necesidades ni se mueven, así que la población base NUNCA se
 * duplica en BD — un árbol bakeado que nadie ha tocado se re-deriva del
 * propio bake en cada resolución (gratis, ya está en disco) y solo se
 * persiste la DIFERENCIA respecto al bake: los que se han talado
 * (`origen:"bake"`, `estado:"talado"`) y los que han nacido en el sistema
 * (`origen:"propagacion"|"plantado"`, jóvenes o ya adultos).
 *
 * Cálculo perezoso, sin excepción: `resolverSectorBosque` se llama SOLO
 * cuando un sector se activa (un jugador se acerca) — nunca en un bucle de
 * fondo. UNA tirada de propagación por árbol adulto elegible en la
 * resolución, nunca una por día transcurrido — mismo criterio que
 * `faunaSalvajeSector.ts` para evitar que un hueco de tiempo largo dispare
 * una explosión de brotes.
 */
import { EspecieArbol, intentaPropagar, puntoAleatorioEnRadio, tocaMadurar } from "./crecimientoBosques";
import { ArbolVivoFila, EtapaArbol } from "../datos/bd";

/** Objeto de vegetación tal cual sale de un `sector_XXX_YYY.json` bakeado (t==="v"), ya filtrado a especies de árbol con `crecimiento` en el catálogo. */
export interface ObjetoArbolBakeado {
  i: string; // especieId
  x: number;
  y: number;
}

/** Determinista por índice del objeto bakeado — el mismo sector siempre exporta los mismos objetos en el mismo orden (mismo criterio que fauna salvaje). */
export function idArbolBake(mapaId: string, sectorX: number, sectorY: number, indice: number): string {
  return `arbol:${mapaId}:${sectorX}:${sectorY}:${indice}`;
}

function idNuevoBrote(mapaId: string, sectorX: number, sectorY: number, ahora: number, n: number): string {
  return `arbol:${mapaId}:${sectorX}:${sectorY}:brote:${ahora}:${n}`;
}

export interface ResultadoResolucionBosque {
  /** Árboles de origen "bake" que se han talado alguna vez — la única parte del bake que hace falta persistir. */
  bakeTalados: ArbolVivoFila[];
  /** Árboles nacidos en el sistema (propagación o plantados) — jóvenes/adultos, vivos/talados. */
  crecidos: ArbolVivoFila[];
  /** Posiciones que acaban de pasar de joven a adulto en ESTA resolución — quien llama debe endurecer su casilla en el grid de colisión vivo. */
  recienMaduraron: { x: number; y: number }[];
}

export function resolverSectorBosque(params: {
  mapaId: string;
  sectorX: number;
  sectorY: number;
  objetosBakeados: ObjetoArbolBakeado[];
  /** Solo filas `origen:"bake"`, `estado:"talado"` — el resto del bake no se persiste (ver cabecera). */
  bakeTaladosPersistidos: ArbolVivoFila[];
  /** Filas `origen:"propagacion"|"plantado"` de este sector — el estado completo de lo que ha nacido en el sistema. */
  crecidosPersistidos: ArbolVivoFila[];
  ahora: number;
  catalogo: Record<string, EspecieArbol>;
  /** ¿Esa casilla está libre para que nazca un brote? (transitable, sin colisión ya puesta, dentro del mapa) — inyectado para no acoplar este módulo puro a MundoColision. */
  casillaLibre: (x: number, y: number) => boolean;
  rnd?: () => number;
}): ResultadoResolucionBosque {
  const { mapaId, sectorX, sectorY, objetosBakeados, bakeTaladosPersistidos, crecidosPersistidos, ahora, catalogo, casillaLibre } = params;
  const rnd = params.rnd ?? Math.random;

  const idsTalados = new Set(bakeTaladosPersistidos.map((f) => f.id));
  const ocupadas = new Set<string>(); // casillas ya reclamadas en ESTA resolución (adultos vivos + brotes nuevos) — evita apilar dos brotes en el mismo punto
  const claveCasilla = (x: number, y: number) => `${x},${y}`;

  // 1) Árboles adultos vivos de origen bake — se re-derivan del propio
  // bake en cada resolución (gratis, nunca se duplican en BD).
  const adultosBake: { x: number; y: number; especieId: string }[] = [];
  objetosBakeados.forEach((obj, i) => {
    const especie = catalogo[obj.i];
    if (!especie) return; // no es una especie de árbol con crecimiento configurado
    const id = idArbolBake(mapaId, sectorX, sectorY, i);
    if (idsTalados.has(id)) return;
    adultosBake.push({ x: obj.x, y: obj.y, especieId: obj.i });
    ocupadas.add(claveCasilla(obj.x, obj.y));
  });

  // 2) Árboles crecidos: maduran los que tocan, el resto sigue igual.
  const recienMaduraron: { x: number; y: number }[] = [];
  const crecidosProcesados: ArbolVivoFila[] = crecidosPersistidos.map((f) => {
    if (f.estado === "talado") return f; // inmutable a partir de aquí
    ocupadas.add(claveCasilla(f.x, f.y));
    if (f.etapa === "joven" && f.diaPlantado != null) {
      const especie = catalogo[f.especieId];
      if (especie && tocaMadurar(f.diaPlantado, especie.diasMaduracion, ahora)) {
        recienMaduraron.push({ x: f.x, y: f.y });
        return { ...f, etapa: "adulto" as EtapaArbol };
      }
    }
    return f;
  });

  // 3) Propagación: una tirada por árbol adulto vivo elegible (bake +
  // crecidos que ya son adultos tras el paso 2), nunca una por día.
  const adultosVivos: { x: number; y: number; especieId: string }[] = [
    ...adultosBake,
    ...crecidosProcesados.filter((f) => f.estado === "vivo" && f.etapa === "adulto").map((f) => ({ x: f.x, y: f.y, especieId: f.especieId })),
  ];
  const nuevosBrotes: ArbolVivoFila[] = [];
  let contadorBrotes = 0;
  for (const arbol of adultosVivos) {
    const especie = catalogo[arbol.especieId];
    if (!especie || !intentaPropagar(especie, rnd)) continue;
    const punto = puntoAleatorioEnRadio(arbol.x, arbol.y, especie.radioPropagacion, rnd);
    const clave = claveCasilla(punto.x, punto.y);
    if (ocupadas.has(clave) || !casillaLibre(punto.x, punto.y)) continue;
    ocupadas.add(clave);
    contadorBrotes++;
    nuevosBrotes.push({
      id: idNuevoBrote(mapaId, sectorX, sectorY, ahora, contadorBrotes),
      mapaId, sectorX, sectorY,
      especieId: arbol.especieId,
      x: punto.x, y: punto.y,
      etapa: "joven",
      origen: "propagacion",
      diaPlantado: ahora,
      estado: "vivo",
    });
  }

  return {
    bakeTalados: bakeTaladosPersistidos,
    crecidos: [...crecidosProcesados, ...nuevosBrotes],
    recienMaduraron,
  };
}
