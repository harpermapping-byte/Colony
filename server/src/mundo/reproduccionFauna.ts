/**
 * Reproducción de fauna — pedido del streamer 2026-08-30: que los
 * animales (salvajes primero, domésticos más adelante con otra mecánica
 * todavía por acotar) tengan población real y persistente, y se
 * reproduzcan solos si nadie los mata a todos.
 *
 * Módulo PURO (sin Colyseus, sin BD, sin tick propio) para poder testear
 * determinismo y mantenerlo desacoplado de dónde vive cada animal — la
 * integración en vivo (spawn/streaming por sector en el Hub) es un paso
 * aparte, todavía no hecho.
 *
 * Cálculo perezoso, como el resto del proyecto (tiempoMundo, rutinas de
 * NPC — "las listas crecen, el código no" también aplica aquí: nada de
 * esto corre en un bucle de fondo). Todo se resuelve comparando un "día de
 * mundo" fraccional (día entero + hora/24, mismo formato que
 * tiempoMundo()) contra el momento en que se CONSULTA un animal — al
 * cargar su sector, al interactuar con él — nunca tick a tick para toda la
 * población.
 */

export type TamanoReproduccion = "pequeno" | "mediano" | "grande";
export type Dieta = "herbivoro" | "carnivoro" | "omnivoro";

// Días in-game de gestación por tamaño (pedido del streamer: pequeños 3
// días, medianos 5-8, grandes 15-20 — dejado como constante única para
// ajustar de un sitio si en pruebas se ve que la población crece
// demasiado rápido o demasiado lento).
export const GESTACION_DIAS: Record<TamanoReproduccion, { min: number; max: number }> = {
  pequeno: { min: 3, max: 3 },
  mediano: { min: 5, max: 8 },
  grande: { min: 15, max: 20 },
};

// Cuántos días in-game puede pasar un adulto sin renovar el "ya comí/ya
// bebí" antes de dejar de estar disponible para aparearse (pedido
// 2026-08-30, "1 vez al día beber agua... herbívoros [comen] algo del
// suelo, carnívoros cada más días, con comer una vez se pueden tirar 6
// días sin comer"): el agua es igual para todos — de granja o salvajes,
// da igual la dieta —, la comida depende de la dieta de la especie.
export const VENTANA_AGUA_DIAS = 1;
export const VENTANA_COMIDA_HERBIVORO_DIAS = 1;
export const VENTANA_COMIDA_CARNIVORO_DIAS = 6;

export function ventanaComidaDias(dieta: Dieta): number {
  return dieta === "carnivoro" ? VENTANA_COMIDA_CARNIVORO_DIAS : VENTANA_COMIDA_HERBIVORO_DIAS;
}

// Tiempo in-game hasta que una cría se convierte en adulto (pedido
// 2026-08-30, "las crías comen de sus padres hasta crecer" — implica que
// en algún momento crecen; cifra de referencia por tamaño, a ajustar
// igual que la gestación).
export const MADURACION_DIAS: Record<TamanoReproduccion, number> = {
  pequeno: 10,
  mediano: 20,
  grande: 40,
};

export type Sexo = "macho" | "hembra";
export type Etapa = "cria" | "adulto";

/** Los campos del catálogo (baker/catalogo/animales.json) que necesita este módulo. */
export interface EspecieReproductiva {
  tamanoReproduccion: TamanoReproduccion;
  poneHuevos: boolean;
  dieta: Dieta;
  /** id de catálogo de la cría, si existe una entrada propia (no todas la tienen todavía). */
  criaId?: string;
  /** crías por camada — por defecto 1; roedores (ratas/ratones...) van a 2. */
  criasPorCamada?: number;
}

export interface AnimalReproductor {
  id: string;
  especieId: string;
  sexo: Sexo;
  etapa: Etapa;
  vivo: boolean;
  x: number;
  y: number;
  /** día de mundo fraccional (dia + hora/24) de la última vez que comió/bebió. */
  ultimaComida: number;
  ultimaBebida: number;
  /** día de mundo en que empezó a gestar; null si no está gestando. SOLO
   * aplica a especies que NO ponen huevos — las ovíparas quedan libres
   * enseguida y lo que gesta es el huevo (ver `Huevo`), no la madre. */
  gestandoDesde: number | null;
  /** duración concreta (ya sorteada dentro del rango de la especie) del embarazo en curso. */
  gestacionDuracionDias: number | null;
  /** día de mundo en que nació esta cría; null en la población base (nunca "nació" en el sistema, ya es adulta). Solo se usa para decidir cuándo madura. */
  nacioEn: number | null;
}

export function diaFraccional(dia: number, hora: number): number {
  return dia + hora / 24;
}

/** ¿Necesita beber? Las crías NUNCA (comen/beben de sus padres hasta crecer). */
export function necesitaAgua(a: AnimalReproductor, ahora: number): boolean {
  if (a.etapa === "cria") return false;
  return ahora - a.ultimaBebida > VENTANA_AGUA_DIAS;
}

/** ¿Necesita comer? Las crías NUNCA — ver `necesitaAgua`. La ventana depende de la dieta de la especie. */
export function necesitaComida(a: AnimalReproductor, especie: EspecieReproductiva, ahora: number): boolean {
  if (a.etapa === "cria") return false;
  return ahora - a.ultimaComida > ventanaComidaDias(especie.dieta);
}

/** ¿Puede este animal participar en un intento de apareamiento ahora mismo? */
export function elegibleParaAparearse(a: AnimalReproductor, especie: EspecieReproductiva, ahora: number): boolean {
  if (!a.vivo || a.etapa !== "adulto" || a.gestandoDesde !== null) return false;
  return !necesitaAgua(a, ahora) && !necesitaComida(a, especie, ahora);
}

/** Busca la pareja elegible más cercana de la misma especie y sexo opuesto dentro de un radio. */
export function buscarPareja(
  animal: AnimalReproductor,
  especie: EspecieReproductiva,
  candidatos: AnimalReproductor[],
  radio: number,
  ahora: number,
): AnimalReproductor | null {
  let mejor: AnimalReproductor | null = null;
  let mejorDist = Infinity;
  for (const c of candidatos) {
    if (c.id === animal.id || c.especieId !== animal.especieId || c.sexo === animal.sexo) continue;
    if (!elegibleParaAparearse(c, especie, ahora)) continue;
    const d = Math.hypot(c.x - animal.x, c.y - animal.y);
    if (d <= radio && d < mejorDist) {
      mejorDist = d;
      mejor = c;
    }
  }
  return mejor;
}

/** ¿Ya maduró esta cría lo bastante como para pasar a adulto? */
export function tocaMadurar(a: AnimalReproductor, tamano: TamanoReproduccion, ahora: number): boolean {
  return a.etapa === "cria" && a.nacioEn !== null && ahora - a.nacioEn >= MADURACION_DIAS[tamano];
}

export function sortearDuracionGestacion(tamano: TamanoReproduccion, rnd: () => number = Math.random): number {
  const { min, max } = GESTACION_DIAS[tamano];
  return min + rnd() * (max - min);
}

export interface Huevo {
  id: string;
  /** especie de la madre que lo puso — de ahí sale el criaId al eclosionar. */
  especieMadreId: string;
  x: number;
  y: number;
  puestoEn: number;
  duracionDias: number;
}

/**
 * Intenta el apareamiento entre dos individuos ya emparejados por
 * `buscarPareja` — 50% de posibilidades de que cuaje (pedido explícito).
 * Si cuaja: en especies que NO ponen huevos, la hembra queda gestando
 * (bloqueada para nuevos intentos hasta el parto); en las que SÍ ponen
 * huevos, la hembra queda libre de inmediato y se devuelve el huevo
 * recién puesto (es responsabilidad de quien llame colocarlo en el
 * mundo). `rnd` inyectado para tests deterministas.
 */
export function intentarAparearse(
  macho: AnimalReproductor,
  hembra: AnimalReproductor,
  especie: EspecieReproductiva,
  ahora: number,
  rnd: () => number = Math.random,
): { exito: false } | { exito: true; huevo: Huevo | null } {
  if (macho.sexo !== "macho" || hembra.sexo !== "hembra") {
    throw new Error("intentarAparearse espera (macho, hembra) en ese orden");
  }
  if (!elegibleParaAparearse(macho, especie, ahora) || !elegibleParaAparearse(hembra, especie, ahora)) return { exito: false };
  if (rnd() >= 0.5) return { exito: false };

  const duracion = sortearDuracionGestacion(especie.tamanoReproduccion, rnd);
  if (especie.poneHuevos) {
    return {
      exito: true,
      huevo: {
        id: `huevo:${hembra.id}:${ahora}`,
        especieMadreId: hembra.especieId,
        x: hembra.x,
        y: hembra.y,
        puestoEn: ahora,
        duracionDias: duracion,
      },
    };
  }
  hembra.gestandoDesde = ahora;
  hembra.gestacionDuracionDias = duracion;
  return { exito: true, huevo: null };
}

/** ¿Ya tocó dar a luz? (solo especies que NO ponen huevos — ver `huevoEclosiona` para las que sí). */
export function tocaDarALuz(a: AnimalReproductor, ahora: number): boolean {
  return a.gestandoDesde !== null && ahora - a.gestandoDesde >= (a.gestacionDuracionDias ?? Infinity);
}

export function huevoEclosiona(h: Huevo, ahora: number): boolean {
  return ahora - h.puestoEn >= h.duracionDias;
}

export interface ResultadoParto {
  /** ids de especie de cada cría nacida — normalmente 1, más en camadas (roedores). */
  criasEspecieId: string[];
}

/**
 * Resuelve un parto o una eclosión: crías con `especieId` = `criaId` del
 * catálogo si existe, o la MISMA especie del progenitor marcada etapa
 * "cria" si esa especie concreta todavía no tiene una entrada de cría
 * propia en el catálogo (no las 145 especies reproductoras la tienen
 * todavía — el sistema no depende de que la tengan).
 */
export function resolverParto(especieProgenitorId: string, especie: EspecieReproductiva): ResultadoParto {
  const n = especie.criasPorCamada ?? 1;
  const criaEspecieId = especie.criaId ?? especieProgenitorId;
  return { criasEspecieId: Array(n).fill(criaEspecieId) as string[] };
}

/**
 * Fauna de "población infinita" (insectos y pequeños invertebrados,
 * pedido explícito: "los insectos son infinitos, si se muere uno aparece
 * otro, límite constante") — no gestan ni buscan pareja, solo se rellena
 * hasta el tope cuando hace falta.
 */
export function faltanParaCompletarPoblacion(vivos: number, limite: number): number {
  return Math.max(0, limite - vivos);
}
