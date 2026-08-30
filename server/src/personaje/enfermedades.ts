/**
 * Enfermedades del jugador — catarro (infección de herida) y gripe (frío de
 * invierno), pedido literal 2026-08-30. PURA (sin Colyseus/BD), mismo patrón
 * que anatomia.ts/vitales.ts: toma/devuelve datos, quien llama
 * (`RoomExteriorBase`) decide sobre qué `Player`/`Anatomia` aplicarlo.
 *
 * Decisiones de esta fase (docs/GDD_Enfermedades.md):
 * - El 10% de catarro por herida es un disparador NUEVO, ADICIONAL al 25% ya
 *   existente en `anatomia.ts::usarVenda` (vendar sin ungüento) — no lo
 *   sustituye. Cierra un hueco real: antes, una herida nunca vendada no
 *   arriesgaba infección jamás.
 * - "Catarro" es una condición GLOBAL del jugador (tose, tope de vida), no
 *   por zona — se deriva de "¿hay alguna zona infectada?" (`anatomia.ts::
 *   tieneAlgunaInfeccion`). Las 6 zonas siguen llevando su propio booleano
 *   `infectado` (panel médico, cirugía cura las 6 a la vez); este módulo solo
 *   añade el reloj/cura/consecuencia de la condición conjunta.
 * - "1 semana ingame" no existe como unidad en el código (todo vitales/
 *   anatomía corre en HORAS REALES) — se deriva de `assets/mundo/tiempo.json`
 *   (30 min reales = 1 día de juego): 7 días × 30 min = 210 min = 3.5h reales.
 * - Tope de vida por catarro: TECHO (nunca sube de la mitad de vidaMax),
 *   nunca un suelo — no impide que otra cosa (sangrado, inanición) la baje
 *   más. Se aplica cada tick, después de cualquier otro cambio de vida de
 *   ese mismo tick (comer/beber/curar no lo esquivan).
 * - Gripe por frío: tirada DE FLANCO (solo al pasar de "no frío" a "frío"),
 *   nunca cada tick mientras se mantiene frío — igual de "un solo golpe, una
 *   tirada" que el resto de eventos discretos del proyecto.
 */

/** Probabilidad de catarro al recibir una herida sangrante (ADICIONAL a la ya existente al vendar sin ungüento). */
export const PROB_CATARRO_POR_HERIDA = 0.1;
/** Probabilidad de gripe al exponerse al frío extremo, solo en invierno, solo en el flanco no-frío→frío. */
export const PROB_GRIPE_POR_FRIO_INVIERNO = 0.1;
/** Ungüentos que hay que tomarse (uno a uno) para curar el catarro del todo. */
export const UNGUENTOS_PARA_CURAR_CATARRO = 4;
/** 1 semana ingame en horas REALES (assets/mundo/tiempo.json: 30 min reales = 1 día de juego; 7 días = 210 min). */
export const HORAS_AUTOCURAR_ENFERMEDAD = 3.5;
/** Tope de vida mientras el catarro está activo: nunca sube de esta fracción de vidaMax. */
export const TOPE_VIDA_CATARRO = 0.5;
/** Multiplicador de velocidad mientras la gripe está activa (tiritar) — se combina con el resto de multiplicadores ya existentes. */
export const MULTIPLICADOR_VELOCIDAD_GRIPE = 0.5;

export interface EstadoEnfermedades {
  /** epoch ms real desde que empezó el catarro; null = sano. */
  catarroDesde: number | null;
  /** Cuántos ungüentos ya se ha tomado para curarlo (0..UNGUENTOS_PARA_CURAR_CATARRO-1 mientras sigue enfermo). */
  unguentosTomados: number;
  /** epoch ms real desde que empezó la gripe; null = sano. */
  gripeDesde: number | null;
  /** Flanco de exposición al frío — para tirar gripe solo al ENTRAR en frío, no cada tick que se mantiene. */
  expuestoFrioPrevio: boolean;
}

export function enfermedadesInicial(): EstadoEnfermedades {
  return { catarroDesde: null, unguentosTomados: 0, gripeDesde: null, expuestoFrioPrevio: false };
}

/** Tirada de catarro al recibir una herida sangrante — puro, el llamador decide sobre qué zona marcar `infectado`. */
export function rodarInfeccionPorHerida(rnd: () => number = Math.random): boolean {
  return rnd() < PROB_CATARRO_POR_HERIDA;
}

/** Arranca el reloj de catarro si no estaba ya corriendo (primera zona que queda infectada). Idempotente. */
export function iniciarCatarroSiCorresponde(estado: EstadoEnfermedades, hayInfeccionActiva: boolean, ahoraMs: number): void {
  if (hayInfeccionActiva && estado.catarroDesde == null) estado.catarroDesde = ahoraMs;
}

/**
 * Tirada de gripe por frío EN INVIERNO — de flanco: solo se tira la primera
 * vez que `enFrioAhora` pasa a true viniendo de false (una ráfaga de frío
 * cuenta como UN evento, no uno por tick mientras dura). Muta `estado` en
 * sitio (actualiza `expuestoFrioPrevio` siempre, tire o no).
 */
export function rodarGripePorFrio(
  estado: EstadoEnfermedades,
  enFrioAhora: boolean,
  esInvierno: boolean,
  ahoraMs: number,
  rnd: () => number = Math.random,
): void {
  const disparaTirada = enFrioAhora && esInvierno && !estado.expuestoFrioPrevio && estado.gripeDesde == null;
  if (disparaTirada && rnd() < PROB_GRIPE_POR_FRIO_INVIERNO) estado.gripeDesde = ahoraMs;
  estado.expuestoFrioPrevio = enFrioAhora;
}

/**
 * Cierra catarro/gripe si ya pasó 1 semana ingame sin curarse — perezoso,
 * mismo integrador horasTranscurridas/timestamps que el resto de curaciones
 * en curso (vendadoDesde/entablilladoDesde). El llamador decide qué más
 * limpiar (p.ej. `anatomia.ts::curarInfecciones` si `catarroCurado`).
 */
export function resolverAutocuracionEnfermedades(estado: EstadoEnfermedades, ahoraMs: number): { catarroCurado: boolean; gripeCurada: boolean } {
  const limiteMs = HORAS_AUTOCURAR_ENFERMEDAD * 3_600_000;
  let catarroCurado = false;
  let gripeCurada = false;
  if (estado.catarroDesde != null && ahoraMs - estado.catarroDesde >= limiteMs) {
    estado.catarroDesde = null;
    estado.unguentosTomados = 0;
    catarroCurado = true;
  }
  if (estado.gripeDesde != null && ahoraMs - estado.gripeDesde >= limiteMs) {
    estado.gripeDesde = null;
    gripeCurada = true;
  }
  return { catarroCurado, gripeCurada };
}

/**
 * Tomar un ungüento para curar el catarro (self-service, sin oficio — el
 * ungüento ya lo prepara el curandero, tomárselo no). Devuelve `true` si con
 * ESTE ungüento se acaba de curar del todo (el llamador debe entonces limpiar
 * `infectado` en las 6 zonas vía `anatomia.ts::curarInfecciones`). `false` si
 * no había catarro activo (el llamador no debería gastar el ítem) o si
 * todavía quedan dosis por tomar.
 */
export function tomarUnguentoCatarro(estado: EstadoEnfermedades): boolean {
  if (estado.catarroDesde == null) return false;
  estado.unguentosTomados++;
  if (estado.unguentosTomados >= UNGUENTOS_PARA_CURAR_CATARRO) {
    estado.catarroDesde = null;
    estado.unguentosTomados = 0;
    return true;
  }
  return false;
}

/** Tomar jarabe para curar la gripe al instante — un solo jarabe basta (a diferencia de las 4 dosis del catarro). `false` si no había gripe activa. */
export function tomarJarabeGripe(estado: EstadoEnfermedades): boolean {
  if (estado.gripeDesde == null) return false;
  estado.gripeDesde = null;
  return true;
}

export function tieneCatarro(estado: EstadoEnfermedades): boolean {
  return estado.catarroDesde != null;
}

export function tieneGripe(estado: EstadoEnfermedades): boolean {
  return estado.gripeDesde != null;
}

/**
 * Tope de vida por catarro: nunca sube de `TOPE_VIDA_CATARRO` de vidaMax
 * mientras esté activo, aunque coma/beba/le curen otra cosa ese mismo tick —
 * se llama DESPUÉS de cualquier otro cambio de vida del tick. Es un TECHO,
 * nunca un suelo: no le impide bajar más por sangrado/inanición/combate.
 */
export function aplicarTopeVidaPorCatarro(estado: EstadoEnfermedades, jugador: { vida: number; vidaMax: number }): void {
  if (estado.catarroDesde == null) return;
  const tope = jugador.vidaMax * TOPE_VIDA_CATARRO;
  if (jugador.vida > tope) jugador.vida = tope;
}

/** Multiplicador de velocidad por gripe (tiritar) — se combina multiplicando con el resto de multiplicadores ya existentes (fractura, crítico, montura...). */
export function multiplicadorVelocidadPorGripe(estado: EstadoEnfermedades): number {
  return estado.gripeDesde != null ? MULTIPLICADOR_VELOCIDAD_GRIPE : 1;
}
