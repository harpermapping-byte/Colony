/**
 * Resolución de un SECTOR de fauna salvaje — la pieza que junta
 * `reproduccionFauna.ts` (reglas puras) con lo bakeado por
 * `baker/src/decoracion.js` y lo persistido en BD (`server/src/datos/bd.ts`).
 * Sigue sin tocar Colyseus/RoomExteriorBase: esto es la "foto resuelta" de
 * un sector en un instante dado; conectarlo al Hub en vivo (activar
 * sectores cerca de jugadores, tickear el merodeo con GestorFauna) es el
 * siguiente paso.
 *
 * Cálculo perezoso, sin excepción: `resolverSector` se llama SOLO cuando
 * un sector se activa (un jugador se acerca) — nunca en un bucle de
 * fondo. Si el sector nunca se tocó, la población inicial sale 1:1 de lo
 * que YA bakeó decoracion.js (mismas posiciones/especies de siempre, cero
 * densidad nueva que inventar). Si ya se había resuelto antes, el hueco de
 * tiempo transcurrido se resuelve de UNA tirada por pareja elegible —
 * nunca día a día — así un hueco de 30 días de mundo cuesta lo mismo que
 * uno de 1: como mucho una cría por pareja presente, nunca una explosión
 * de población por quedarse nadie mirando mucho tiempo (pedido explícito
 * del streamer, "no sea que... de repente tengamos x1000").
 */
import {
  AnimalReproductor,
  EspecieReproductiva,
  Huevo,
  buscarPareja,
  faltanParaCompletarPoblacion,
  huevoEclosiona,
  intentarAparearse,
  resolverParto,
  tocaDarALuz,
  tocaMadurar,
} from "./reproduccionFauna";
import { FaunaSalvajeFila, FaunaHuevoFila, SexoFauna } from "../datos/bd";
import { CatalogoCombateFauna, estadisticasCombatePorDefecto } from "./catalogoCombateFauna";

/** Objeto de fauna tal cual sale de un `sector_XXX_YYY.json` bakeado (t==="a"). */
export interface ObjetoFaunaBakeado {
  i: string; // especieId
  x: number;
  y: number;
}

export type EspecieCatalogo = EspecieReproductiva & { poblacionInfinita?: boolean };
export type CatalogoEspecies = Record<string, EspecieCatalogo>;

// Radio de búsqueda de pareja dentro del sector — mismo orden de magnitud
// que un radio de merodeo pequeño; un sector completo mide muchas más
// casillas, así que esto mantiene el apareamiento "local" a la manada.
const RADIO_APAREAMIENTO = 6;

export function convertirFilaAAnimal(f: FaunaSalvajeFila): AnimalReproductor {
  return {
    id: f.id,
    especieId: f.especieId,
    sexo: f.sexo,
    etapa: f.etapa,
    vivo: f.estado === "vivo",
    x: f.x,
    y: f.y,
    ultimaComida: f.ultimaComida,
    ultimaBebida: f.ultimaBebida,
    gestandoDesde: f.gestandoDesde,
    gestacionDuracionDias: f.gestacionDuracionDias,
    nacioEn: f.nacioEn,
  };
}

// Vida/vidaMax/ataque (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30) viven
// FUERA de `AnimalReproductor` a propósito: son datos de combate, no de
// reproducción — `reproduccionFauna.ts` no necesita saber de ellos. Se
// acarrean aparte por id (`vidaPorId`, ver `resolverSector`) y se pegan a
// la fila aquí, en el único punto donde AnimalReproductor vuelve a Fila.
function convertirAnimalAFila(
  a: AnimalReproductor,
  mapaId: string,
  sectorX: number,
  sectorY: number,
  combate: { vida: number; vidaMax: number; ataque: number },
): FaunaSalvajeFila {
  return {
    id: a.id,
    mapaId,
    sectorX,
    sectorY,
    especieId: a.especieId,
    sexo: a.sexo,
    etapa: a.etapa,
    estado: a.vivo ? "vivo" : "muerto",
    x: a.x,
    y: a.y,
    ultimaComida: a.ultimaComida,
    ultimaBebida: a.ultimaBebida,
    gestandoDesde: a.gestandoDesde,
    gestacionDuracionDias: a.gestacionDuracionDias,
    nacioEn: a.nacioEn,
    vida: combate.vida,
    vidaMax: combate.vidaMax,
    ataque: combate.ataque,
  };
}

/** Determinista por índice del objeto bakeado — el mismo sector siempre exporta los mismos objetos en el mismo orden. */
function idInicial(mapaId: string, sectorX: number, sectorY: number, indice: number): string {
  return `${mapaId}:${sectorX}:${sectorY}:${indice}`;
}

function idNuevaCria(mapaId: string, sectorX: number, sectorY: number, ahora: number, n: number): string {
  return `${mapaId}:${sectorX}:${sectorY}:cria:${ahora}:${n}`;
}

/** Relleno de fauna "población infinita" (ver más abajo, paso 3bis) — tag propio para no chocar nunca con un id de cría ni con el id original del bake (`idInicial`, sin tag). */
function idRellenoInfinita(mapaId: string, sectorX: number, sectorY: number, ahora: number, n: number): string {
  return `${mapaId}:${sectorX}:${sectorY}:infinita:${ahora}:${n}`;
}

/** ¿Es esta fila la ORIGINAL del bake (id de `idInicial`, sin tag), viva o muerta? Se usa para sacar el límite real de población infinita de un sector (cuántas bakeó originalmente `decoracion.js` para esa especie) y las posiciones candidatas de respawn, SIN tener que releer el archivo de bake en cada activación — `filasPersistidas` ya guarda hasta las muertas para siempre (ver cabecera del módulo). */
function esIndividuoBakeOriginal(id: string): boolean {
  return !id.includes(":cria:") && !id.includes(":infinita:");
}

export interface ResultadoResolucionSector {
  /** individuos vivos Y muertos que hay que persistir (los muertos se guardan para no "resucitar" en la siguiente resolución). */
  individuos: FaunaSalvajeFila[];
  huevos: FaunaHuevoFila[];
}

/**
 * Resuelve un sector completo. `filasPersistidas` vacío + `ultimaResolucion`
 * null = primera vez que se activa este sector (genera la población base
 * desde lo bakeado). En caso contrario, `filasPersistidas` YA es el estado
 * completo del sector (bakeado ignorado) y se avanza el hueco de tiempo.
 */
export function resolverSector(params: {
  mapaId: string;
  sectorX: number;
  sectorY: number;
  objetosBakeados: ObjetoFaunaBakeado[];
  filasPersistidas: FaunaSalvajeFila[];
  huevosPersistidos: FaunaHuevoFila[];
  ultimaResolucion: number | null;
  ahora: number;
  catalogo: CatalogoEspecies;
  /** Vida/ataque por especie (docs/GDD_Mecanicas.md §5.4) — opcional para no
   * romper caller/tests antiguos; sin catálogo, toda especie usa el relleno
   * de `estadisticasCombatePorDefecto`. */
  catalogoCombate?: CatalogoCombateFauna;
  rnd?: () => number;
}): ResultadoResolucionSector {
  const { mapaId, sectorX, sectorY, objetosBakeados, filasPersistidas, huevosPersistidos, ultimaResolucion, ahora, catalogo } = params;
  const rnd = params.rnd ?? Math.random;
  const catalogoCombate = params.catalogoCombate ?? {};
  const combateDe = (especieId: string) => catalogoCombate[especieId] ?? estadisticasCombatePorDefecto();
  // Vida/vidaMax/ataque de los individuos YA existentes (persistidos): se
  // acarrean tal cual, NUNCA se recalculan desde catálogo — así el daño
  // sufrido en combate sobrevive a que el sector se desactive/reactive
  // (regla explícita: "mantienen su vida actual fija tras un combate").
  const combatePorId = new Map(filasPersistidas.map((f) => [f.id, { vida: f.vida, vidaMax: f.vidaMax, ataque: f.ataque }]));

  // Primera activación: población base 1:1 desde lo bakeado, sexo al azar,
  // recién "comida/bebida" (justo aparece, no tiene sentido que nazca con hambre).
  // Incluye TAMBIÉN especies de "población infinita" (insectos, peces,
  // aves, marinos... pedido streamer 2026-09-08: antes se descartaban del
  // todo aquí y nunca llegaban a existir como individuo real — el paso 3bis
  // más abajo es quien las mantiene rellenas hasta este mismo número tras
  // esta primera activación, SIN reproducirse (esas especies no pasan por
  // el paso 4 de apareamiento).
  let individuos: AnimalReproductor[];
  if (ultimaResolucion === null && filasPersistidas.length === 0) {
    individuos = objetosBakeados
      .map((obj, i) => {
        const especie = catalogo[obj.i];
        if (!especie) return null;
        const sexo: SexoFauna = rnd() < 0.5 ? "macho" : "hembra";
        const animal: AnimalReproductor = {
          id: idInicial(mapaId, sectorX, sectorY, i),
          especieId: obj.i,
          sexo,
          etapa: "adulto",
          vivo: true,
          x: obj.x,
          y: obj.y,
          ultimaComida: ahora,
          ultimaBebida: ahora,
          gestandoDesde: null,
          gestacionDuracionDias: null,
          nacioEn: null, // población base del bake: ya nace adulta, no "creció" en el sistema
        };
        return animal;
      })
      .filter((a): a is AnimalReproductor => a !== null);
    return {
      individuos: individuos.map((a) => {
        const c = combateDe(a.especieId);
        return convertirAnimalAFila(a, mapaId, sectorX, sectorY, { vida: c.vidaMaxima, vidaMax: c.vidaMaxima, ataque: c.ataque });
      }),
      huevos: [],
    };
  }

  individuos = filasPersistidas.map(convertirFilaAAnimal);
  let huevos: Huevo[] = huevosPersistidos.map((h) => ({
    id: h.id,
    especieMadreId: h.especieMadreId,
    x: h.x,
    y: h.y,
    puestoEn: h.puestoEn,
    duracionDias: h.duracionDias,
  }));
  const nuevos: AnimalReproductor[] = [];
  let contadorCrias = 0;

  // 1) Huevos que ya deberían haber eclosionado durante el hueco.
  const huevosRestantes: Huevo[] = [];
  for (const h of huevos) {
    if (huevoEclosiona(h, ahora)) {
      const especie = catalogo[h.especieMadreId];
      if (especie) {
        const parto = resolverParto(h.especieMadreId, especie);
        for (const especieCriaId of parto.criasEspecieId) {
          contadorCrias++;
          const id = idNuevaCria(mapaId, sectorX, sectorY, ahora, contadorCrias);
          const c = combateDe(especieCriaId);
          combatePorId.set(id, { vida: c.vidaMaxima, vidaMax: c.vidaMaxima, ataque: c.ataque });
          nuevos.push({
            id,
            especieId: especieCriaId,
            sexo: rnd() < 0.5 ? "macho" : "hembra",
            etapa: "cria",
            vivo: true,
            x: h.x,
            y: h.y,
            ultimaComida: ahora,
            ultimaBebida: ahora,
            gestandoDesde: null,
            gestacionDuracionDias: null,
            nacioEn: ahora,
          });
        }
      }
    } else {
      huevosRestantes.push(h);
    }
  }
  huevos = huevosRestantes;

  // 2) Gestaciones en curso que ya deberían haber parido.
  for (const a of individuos) {
    if (a.vivo && tocaDarALuz(a, ahora)) {
      const especie = catalogo[a.especieId];
      if (especie) {
        const parto = resolverParto(a.especieId, especie);
        for (const especieCriaId of parto.criasEspecieId) {
          contadorCrias++;
          const id = idNuevaCria(mapaId, sectorX, sectorY, ahora, contadorCrias);
          const c = combateDe(especieCriaId);
          combatePorId.set(id, { vida: c.vidaMaxima, vidaMax: c.vidaMaxima, ataque: c.ataque });
          nuevos.push({
            id,
            especieId: especieCriaId,
            sexo: rnd() < 0.5 ? "macho" : "hembra",
            etapa: "cria",
            vivo: true,
            x: a.x,
            y: a.y,
            ultimaComida: ahora,
            ultimaBebida: ahora,
            gestandoDesde: null,
            gestacionDuracionDias: null,
            nacioEn: ahora,
          });
        }
      }
      a.gestandoDesde = null;
      a.gestacionDuracionDias = null;
    }
  }

  // 3) Crías que ya maduraron en el hueco pasan a adulto (pedido
  // 2026-08-30, "las crías comen de sus padres hasta crecer" — implica
  // que en algún momento crecen). Recién adultas, cuentan como saciadas
  // (no tiene sentido que se conviertan en adulto ya "hambrientas").
  for (const a of individuos) {
    if (!a.vivo || a.etapa !== "cria") continue;
    const especie = catalogo[a.especieId];
    if (especie && tocaMadurar(a, especie.tamanoReproduccion, ahora)) {
      a.etapa = "adulto";
      a.ultimaComida = ahora;
      a.ultimaBebida = ahora;
    }
  }

  // 3bis) Fauna "población infinita" (insectos, peces, aves, marinos... —
  // pedido streamer 2026-09-08: "si se muere uno aparece otro, límite
  // constante"): NO gesta ni busca pareja (excluida a propósito del paso 4
  // de abajo), solo se rellena hasta el número que bakeó `decoracion.js`
  // originalmente para esta especie en este sector. Ese límite y las
  // posiciones candidatas de respawn salen de las filas YA persistidas
  // (`esIndividuoBakeOriginal` — el id original del bake, vivo o muerto,
  // nunca se borra, ver cabecera del módulo) para no tener que releer el
  // archivo de bake en cada activación: `activarSector` solo lo lee la
  // PRIMERA vez que se activa un sector (comportamiento ya establecido y
  // probado, no se toca aquí). Una tirada al resolver el hueco entero,
  // igual que crías/apareamiento — nunca una explosión de individuos por
  // haber pasado mucho tiempo sin nadie mirando.
  const porEspecieInfinita = new Map<string, { limite: number; posiciones: { x: number; y: number }[] }>();
  for (const a of individuos) {
    const especie = catalogo[a.especieId];
    if (!especie?.poblacionInfinita || !esIndividuoBakeOriginal(a.id)) continue;
    const entrada = porEspecieInfinita.get(a.especieId) ?? { limite: 0, posiciones: [] };
    entrada.limite++;
    entrada.posiciones.push({ x: a.x, y: a.y });
    porEspecieInfinita.set(a.especieId, entrada);
  }
  let contadorRelleno = 0;
  for (const [especieId, { limite, posiciones }] of porEspecieInfinita) {
    const vivosEspecie = individuos.filter((a) => a.vivo && a.especieId === especieId).length;
    const faltan = faltanParaCompletarPoblacion(vivosEspecie, limite);
    for (let k = 0; k < faltan; k++) {
      contadorRelleno++;
      const pos = posiciones[Math.floor(rnd() * posiciones.length)];
      const id = idRellenoInfinita(mapaId, sectorX, sectorY, ahora, contadorRelleno);
      const c = combateDe(especieId);
      combatePorId.set(id, { vida: c.vidaMaxima, vidaMax: c.vidaMaxima, ataque: c.ataque });
      nuevos.push({
        id,
        especieId,
        sexo: rnd() < 0.5 ? "macho" : "hembra",
        etapa: "adulto",
        vivo: true,
        x: pos.x,
        y: pos.y,
        ultimaComida: ahora,
        ultimaBebida: ahora,
        gestandoDesde: null,
        gestacionDuracionDias: null,
        nacioEn: null,
      });
    }
  }

  // 4) Nuevos apareamientos: mientras el sector estuvo inactivo se asume
  // que todos comieron/bebieron con normalidad (no se rastrea hambre sin
  // jugadores cerca) — UNA tirada por pareja elegible más cercana, nunca
  // una por cada día transcurrido (evita la explosión de población).
  const vivosAhora = individuos.filter((a) => a.vivo);
  // Se dan por saciados todos los vivos ANTES de buscar pareja: sin
  // jugadores cerca no se rastrea hambre real, así que el hueco de tiempo
  // no puede bloquear apareamientos solo por no haber comida registrada.
  for (const a of vivosAhora) {
    a.ultimaComida = ahora;
    a.ultimaBebida = ahora;
  }
  const yaIntentado = new Set<string>();
  for (const a of vivosAhora) {
    if (a.sexo !== "macho" || a.etapa !== "adulto" || yaIntentado.has(a.id)) continue;
    const especie = catalogo[a.especieId];
    if (!especie || especie.poblacionInfinita) continue; // población infinita no gesta/aparea — solo se rellena en el paso 3bis
    const candidatas = vivosAhora.filter((c) => c.id !== a.id && !yaIntentado.has(c.id));
    const pareja = buscarPareja(a, especie, candidatas, RADIO_APAREAMIENTO, ahora);
    if (!pareja) continue;
    yaIntentado.add(a.id);
    yaIntentado.add(pareja.id);
    const resultado = intentarAparearse(a, pareja, especie, ahora, rnd);
    if (resultado.exito && resultado.huevo) huevos.push(resultado.huevo);
  }

  const todos = [...individuos, ...nuevos];
  return {
    individuos: todos.map((a) => {
      const combate = combatePorId.get(a.id) ?? (() => {
        const c = combateDe(a.especieId);
        return { vida: c.vidaMaxima, vidaMax: c.vidaMaxima, ataque: c.ataque };
      })();
      return convertirAnimalAFila(a, mapaId, sectorX, sectorY, combate);
    }),
    huevos: huevos.map((h) => ({
      id: h.id,
      mapaId,
      sectorX,
      sectorY,
      especieMadreId: h.especieMadreId,
      x: h.x,
      y: h.y,
      puestoEn: h.puestoEn,
      duracionDias: h.duracionDias,
    })),
  };
}
