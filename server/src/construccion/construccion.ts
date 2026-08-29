/**
 * Lógica de construcción — PURA (sin Colyseus ni fs) para testearla sola,
 * igual que mundo/colisiones.ts. Implementa las validaciones del
 * GDD_Construccion §5 TAL CUAL (el GDD es el contrato):
 *
 *   1. El emisor es dueño de la parcela que contiene (x,y) — o jarl.
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
import { IndiceParcelas, parcelaEn, topeDe } from "./parcelas";
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

  return { ok: true, parcelaId, claves };
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
