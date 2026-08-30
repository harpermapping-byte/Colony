/**
 * Lógica de construcción — PURA (sin Colyseus ni fs) para testearla sola,
 * igual que mundo/colisiones.ts. Implementa las validaciones del
 * GDD_Construccion §5 TAL CUAL (el GDD es el contrato):
 *
 *   1. El emisor es dueño de la parcela que contiene (x,y) — o jarl.
 *   1bis. Si el tipo es `proyectoJarl` (proyecto especial del jarl): solo el
 *      jarl, solo en parcela `tipo:"especial"`, tope 1 por asentamiento.
 *   2. La huella ROTADA entera cae dentro de ESA misma parcela.
 *   3. Todas sus casillas son TIERRA transitable (ni agua, ni sólido del
 *      bake, ni otra construcción).
 *   4. La parcela no supera su topeProps.
 *
 * La colisión viva: al colocar con `colision: true` las casillas se
 * endurecen a SOLIDO en la rejilla; `casillasBase` guarda la copia del bake
 * para poder RESTAURAR el valor original al recoger (una casilla endurecida
 * por construcción vuelve a ser la tierra que era, no un TIERRA a ciegas).
 */

import { MundoColision, TIPO } from "../mundo/colisiones";
import { IndiceParcelas, parcelaEn, topeDe, tipoDe } from "./parcelas";
import { EntradaConstruible } from "./catalogo";

/** Lo mínimo que la validación necesita saber de una propiedad (bd.Propiedad encaja). */
export interface PropiedadMinima {
  dueno: string | null;
}

/** Construcción ya aplicada a la rejilla (estado vivo en memoria de la room). */
export interface ConstruccionViva {
  id: number;
  propiedad: string;
  objeto: string;
  categoria: string;
  x: number;
  y: number;
  rot: number;
  variante: number;
  colision: boolean;
  /** claves numéricas y*ancho+x de las casillas que ocupa (huella ya rotada) */
  claves: number[];
  /** JSON libre (interior generado, estado de producción — docs/GDD_Produccion.md) — mismo campo que ya guarda `construcciones.extra` en BD, mantenido en memoria para leer/mutar sin round-trip por cada toque. */
  extra?: Record<string, unknown> | null;
}

export interface ContextoConstruccion {
  mapa: MundoColision;
  /** copia del bake ANTES de aplicar construcciones — para restaurar al recoger */
  casillasBase: Uint8Array;
  parcelas: IndiceParcelas;
  /** propiedadId (= parcelaId en v1) → dueño; ausente = sin fila en BD = del jarl */
  propiedades: Map<string, PropiedadMinima>;
  /** clave numérica de casilla → id de la construcción que la ocupa */
  ocupacion: Map<number, number>;
  /** construcciones aplicadas, por id */
  vivas: Map<number, ConstruccionViva>;
  /** cuántas construcciones tiene cada propiedad (para topeProps en O(1)) */
  conteoPorPropiedad: Map<string, number>;
  /** nombres de jarl ya normalizados (trim + lowercase) */
  jarls: Set<string>;
}

export interface PeticionColocacion {
  nombre: string; // identidad v1 = nombre del jugador
  entrada: EntradaConstruible;
  x: number;
  y: number;
  rot: number;
}

export type ResultadoValidacion =
  | { ok: true; parcelaId: string; claves: number[] }
  | { ok: false; motivo: string };

/** Jarl según env JARL_NOMBRES — comparación insensible a mayúsculas/espacios. */
export function esJarl(ctx: ContextoConstruccion, nombre: string): boolean {
  return ctx.jarls.has(nombre.trim().toLowerCase());
}

/**
 * Mismo chequeo que `esJarl`, pero SIN necesitar un ContextoConstruccion —
 * para sitios donde el jarl actúa fuera de construcción/parcelas (docs/
 * GDD_Propiedades.md: revocar un inmueble/habitación, entrar a una vivienda
 * ajena) y que por tanto pueden ejecutarse en CUALQUIER aldea/POI, no solo
 * en las que tienen `parcelasReservadas` habilitado (ctx puede no existir ahí).
 */
export function esJarlGlobal(nombre: string): boolean {
  const jarls = (process.env.JARL_NOMBRES ?? "")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0);
  return jarls.includes(nombre.trim().toLowerCase());
}

/**
 * Huella [ancho, largo] tras rotar rot cuartos de vuelta horarios: la caja
 * es simétrica, así que solo importa la paridad — rot impar intercambia ejes
 * ([h, w], como documenta el esquema SQL del GDD §2).
 */
export function huellaRotada(huella: [number, number], rot: number): [number, number] {
  return rot % 2 !== 0 ? [huella[1], huella[0]] : [huella[0], huella[1]];
}

/** Casillas globales que ocupa la huella rotada con esquina noroeste en (x,y). */
export function casillasDe(
  x: number,
  y: number,
  huella: [number, number],
  rot: number
): { x: number; y: number }[] {
  const [ancho, largo] = huellaRotada(huella, rot);
  const casillas: { x: number; y: number }[] = [];
  for (let dy = 0; dy < largo; dy++) {
    for (let dx = 0; dx < ancho; dx++) {
      casillas.push({ x: x + dx, y: y + dy });
    }
  }
  return casillas;
}

export function validarColocacion(
  ctx: ContextoConstruccion,
  peticion: PeticionColocacion
): ResultadoValidacion {
  const { nombre, entrada, x, y, rot } = peticion;

  // 1. dueño de la parcela de (x,y) — o jarl (que puede construir en cualquiera)
  const parcelaId = parcelaEn(ctx.parcelas, x, y);
  if (!parcelaId) return { ok: false, motivo: "fuera de parcela" };
  const dueno = ctx.propiedades.get(parcelaId)?.dueno ?? null; // sin fila = del jarl
  if (dueno !== nombre && !esJarl(ctx, nombre)) {
    return { ok: false, motivo: "no eres el dueño de esta parcela" };
  }

  // 1bis. proyectos especiales del jarl (docs/Backlog_Mecanicas_Futuras.md,
  // "Proyectos especiales del jarl"): solo el jarl los levanta (nunca un
  // dueño normal, aunque la parcela especial no tenga dueño asignado), y
  // solo en una parcela `tipo:"especial"` reservada para esto (docs/
  // GDD_Ciudad_Capital.md §3) — nunca una parcela normal de jugador.
  if (entrada.proyectoJarl === true) {
    if (!esJarl(ctx, nombre)) {
      return { ok: false, motivo: "solo el jarl puede levantar un proyecto especial" };
    }
    if (tipoDe(ctx.parcelas, parcelaId) !== "especial") {
      return { ok: false, motivo: "los proyectos especiales solo van en una parcela especial reservada" };
    }
    // tope de 1 por asentamiento SOLO para el edificio en sí (`ctx` ya viene
    // scoped a la room/asentamiento) — las piezas sueltas categoria:"exterior"
    // del mismo proyecto (estatua+pedestal+leones..., postes de muelle...)
    // son decoración que legítimamente necesita varias copias (un par de
    // leones, varios postes de amarre); las limita el topeProps normal de la
    // parcela, no este tope de "uno por asentamiento".
    if (entrada.categoria === "edificio") {
      for (const viva of ctx.vivas.values()) {
        if (viva.objeto === entrada.id) {
          return { ok: false, motivo: "ya existe un proyecto especial de este tipo en el asentamiento" };
        }
      }
    }
  }

  // 2. huella rotada entera dentro de ESA MISMA parcela
  const casillas = casillasDe(x, y, entrada.huella, rot);
  const claves: number[] = [];
  for (const c of casillas) {
    if (parcelaEn(ctx.parcelas, c.x, c.y) !== parcelaId) {
      return { ok: false, motivo: "la huella se sale de la parcela" };
    }
    claves.push(c.y * ctx.mapa.ancho + c.x);
  }

  // 3. todas TIERRA transitable y libres (el bake ya endureció sus sólidos
  //    en la rejilla; lo construido vive aparte en `ocupacion` para que las
  //    piezas SIN colisión también reserven sitio y no se solapen)
  for (const clave of claves) {
    if (ctx.mapa.casillas[clave] !== TIPO.TIERRA) {
      return { ok: false, motivo: "casilla no construible (agua u obstáculo)" };
    }
    if (ctx.ocupacion.has(clave)) {
      return { ok: false, motivo: "casilla ocupada por otra construcción" };
    }
  }

  // 4. tope de props de la parcela
  const actuales = ctx.conteoPorPropiedad.get(parcelaId) ?? 0;
  if (actuales >= topeDe(ctx.parcelas, parcelaId)) {
    return { ok: false, motivo: "tope de construcciones de la parcela alcanzado" };
  }

  // 5. red motriz (docs/GDD_Motriz.md): una fuente "agua" (molino de agua)
  // exige un cauce ORTOGONALMENTE ADYACENTE a la huella — único caso donde
  // esta validación mira más allá de la propia huella, así que se hace al
  // final, sobre las `claves` ya confirmadas válidas.
  if (entrada.energia?.fuente === "agua" && !hayAguaAdyacente(ctx, casillas, claves)) {
    return { ok: false, motivo: "el molino de agua necesita un cauce junto a su huella" };
  }

  // Pesca pasiva (docs/GDD_Pesca.md): trampa/cangrejera/batea, mismo
  // requisito de "agua junto a la huella" que el molino de agua — reusa la
  // misma comprobación, ninguna casilla de la propia huella puede ser agua
  // (construcción siempre en tierra) pero necesita el cauce/orilla al lado.
  if (entrada.requiereAgua && !hayAguaAdyacente(ctx, casillas, claves)) {
    return { ok: false, motivo: "esto necesita agua junto a su huella" };
  }

  // Cocina v2 (docs/GDD_Cocina.md, olla_grande/estructura_palos): variante
  // de "algo concreto adyacente a la huella" pero mirando CONSTRUCCIONES en
  // vez de terreno — mismo criterio que hayAguaAdyacente.
  if (entrada.requiereConstruibleAdyacente) {
    const tipos = Array.isArray(entrada.requiereConstruibleAdyacente)
      ? entrada.requiereConstruibleAdyacente
      : [entrada.requiereConstruibleAdyacente];
    if (!hayConstruibleAdyacente(ctx, casillas, claves, tipos)) {
      return { ok: false, motivo: `esto necesita ${tipos.join(" o ")} junto a su huella` };
    }
  }

  return { ok: true, parcelaId, claves };
}

/** ¿Alguna casilla ORTOGONALMENTE adyacente (fuera de la propia huella) tiene una construcción cuyo `objeto` está en `tipos`? */
function hayConstruibleAdyacente(
  ctx: ContextoConstruccion,
  casillas: { x: number; y: number }[],
  claves: number[],
  tipos: string[],
): boolean {
  const dentro = new Set(claves);
  const buscados = new Set(tipos);
  for (const c of casillas) {
    const vecinos = [
      { x: c.x, y: c.y - 1 },
      { x: c.x, y: c.y + 1 },
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
    ];
    for (const v of vecinos) {
      if (v.x < 0 || v.y < 0 || v.x >= ctx.mapa.ancho || v.y >= ctx.mapa.alto) continue;
      const clave = v.y * ctx.mapa.ancho + v.x;
      if (dentro.has(clave)) continue;
      const idConstruccion = ctx.ocupacion.get(clave);
      if (idConstruccion == null) continue;
      const viva = ctx.vivas.get(idConstruccion);
      if (viva && buscados.has(viva.objeto)) return true;
    }
  }
  return false;
}

/** ¿Alguna casilla ORTOGONALMENTE adyacente (fuera de la propia huella) es agua? */
function hayAguaAdyacente(
  ctx: ContextoConstruccion,
  casillas: { x: number; y: number }[],
  claves: number[],
): boolean {
  const dentro = new Set(claves);
  for (const c of casillas) {
    const vecinos = [
      { x: c.x, y: c.y - 1 },
      { x: c.x, y: c.y + 1 },
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
    ];
    for (const v of vecinos) {
      if (v.x < 0 || v.y < 0 || v.x >= ctx.mapa.ancho || v.y >= ctx.mapa.alto) continue;
      const clave = v.y * ctx.mapa.ancho + v.x;
      if (dentro.has(clave)) continue; // dentro de la propia huella, no cuenta como "adyacente"
      const tipo = ctx.mapa.casillas[clave];
      if (tipo === TIPO.AGUA || tipo === TIPO.AGUA_PROFUNDA) return true;
    }
  }
  return false;
}

export interface PeticionColocacionPlantilla {
  nombre: string;
  entrada: EntradaConstruible;
  x: number;
  y: number;
  rot: number;
}

export type ResultadoValidacionPlantilla = { ok: true; claves: number[] } | { ok: false; motivo: string };

/**
 * Plantillas del jarl (docs/GDD_Produccion.md): mecanismo PARALELO a
 * validarColocacion, no una variante — nunca exige estar dentro de una
 * parcela (al contrario: EXIGE estar fuera de cualquier parcela existente,
 * "el jarl asigna parcelas... aparte tendrá un sistema de plantillas de
 * edificios en exterior, en un radio grande alrededor de la capital, fuera
 * no podrá" — pedido literal del streamer). `capital`/`radioMax` los
 * resuelve el llamador (el punto de spawn/ciudad de ESTA región, sea el Hub
 * o la ciudad capital real vía RegionRoom — agnóstico de cuál es cuál).
 */
export function validarColocacionPlantilla(
  ctx: ContextoConstruccion,
  peticion: PeticionColocacionPlantilla,
  capital: { x: number; y: number },
  radioMax: number,
): ResultadoValidacionPlantilla {
  const { nombre, entrada, x, y, rot } = peticion;

  // 1. solo el jarl coloca plantillas
  if (!esJarl(ctx, nombre)) return { ok: false, motivo: "solo el jarl coloca plantillas" };

  // 2. dentro del radio a la capital (centro de la huella, no la esquina)
  const [ancho, largo] = huellaRotada(entrada.huella, rot);
  const centroX = x + ancho / 2;
  const centroY = y + largo / 2;
  if (Math.hypot(centroX - capital.x, centroY - capital.y) > radioMax) {
    return { ok: false, motivo: "fuera del radio de plantillas de la capital" };
  }

  // 3. huella rotada entera: tierra transitable, libre, y FUERA de cualquier
  //    parcela ya pintada (una plantilla nunca pisa terreno de jugador)
  const casillas = casillasDe(x, y, entrada.huella, rot);
  const claves: number[] = [];
  for (const c of casillas) {
    if (parcelaEn(ctx.parcelas, c.x, c.y) !== undefined) {
      return { ok: false, motivo: "hay una parcela ahí — las plantillas van fuera de las parcelas" };
    }
    const clave = c.y * ctx.mapa.ancho + c.x;
    if (ctx.mapa.casillas[clave] !== TIPO.TIERRA) {
      return { ok: false, motivo: "casilla no construible (agua u obstáculo)" };
    }
    if (ctx.ocupacion.has(clave)) {
      return { ok: false, motivo: "casilla ocupada por otra construcción" };
    }
    claves.push(clave);
  }

  return { ok: true, claves };
}

/**
 * Aplica una construcción YA validada (o cargada de la BD al arrancar) a la
 * rejilla viva: reserva sus casillas y las endurece si tiene colisión.
 */
export function aplicarColocacion(
  ctx: ContextoConstruccion,
  datos: {
    id: number;
    propiedad: string;
    objeto: string;
    categoria: string;
    x: number;
    y: number;
    rot: number;
    variante: number;
    colision: boolean;
    huella: [number, number];
    extra?: Record<string, unknown> | null;
  }
): ConstruccionViva {
  const claves = casillasDe(datos.x, datos.y, datos.huella, datos.rot).map(
    (c) => c.y * ctx.mapa.ancho + c.x
  );
  const viva: ConstruccionViva = {
    id: datos.id,
    propiedad: datos.propiedad,
    objeto: datos.objeto,
    categoria: datos.categoria,
    x: datos.x,
    y: datos.y,
    rot: datos.rot,
    variante: datos.variante,
    colision: datos.colision,
    claves,
    extra: datos.extra ?? null,
  };
  for (const clave of claves) {
    ctx.ocupacion.set(clave, datos.id);
    // solo se endurece suelo firme (misma prudencia que el bake: nunca
    // convertir agua en pared aunque la BD trajera un dato raro)
    if (datos.colision && ctx.mapa.casillas[clave] === TIPO.TIERRA) {
      ctx.mapa.casillas[clave] = TIPO.SOLIDO;
    }
  }
  ctx.vivas.set(datos.id, viva);
  ctx.conteoPorPropiedad.set(datos.propiedad, (ctx.conteoPorPropiedad.get(datos.propiedad) ?? 0) + 1);
  return viva;
}

/**
 * Quita una construcción: restaura sus casillas DESDE la copia base del bake
 * (no hay solapes entre construcciones, así que restaurar no pisa a nadie) y
 * libera la ocupación. Devuelve la construcción quitada, o undefined si no existía.
 */
export function quitarConstruccion(
  ctx: ContextoConstruccion,
  id: number
): ConstruccionViva | undefined {
  const viva = ctx.vivas.get(id);
  if (!viva) return undefined;
  for (const clave of viva.claves) {
    ctx.ocupacion.delete(clave);
    ctx.mapa.casillas[clave] = ctx.casillasBase[clave];
  }
  ctx.vivas.delete(id);
  const restante = (ctx.conteoPorPropiedad.get(viva.propiedad) ?? 1) - 1;
  if (restante <= 0) ctx.conteoPorPropiedad.delete(viva.propiedad);
  else ctx.conteoPorPropiedad.set(viva.propiedad, restante);
  return viva;
}
