/**
 * Sistema anatómico — heridas por zona, sangrado/fractura/infección/
 * amputación, curación de campo vs. cirugía (pedido 2026-08-30, adaptado de
 * un spec externo genérico a la arquitectura real de este proyecto). PURA
 * (sin Colyseus/BD): toma/devuelve datos, quien llama (`RoomExteriorBase`)
 * decide sobre qué `Player` aplicarlo — mismo patrón que `vitales.ts`/`combate.ts`.
 *
 * Decisiones de arquitectura, no negociables sin volver a preguntar:
 * - `Player.vida/vidaMax` sigue siendo la ÚNICA fuente de HP (docs/GDD_Mecanicas.md
 *   §5.4) — el sangrado/infección le restan a ESA vida por el mismo canal que
 *   cualquier otro daño, nunca un HP paralelo por zona.
 * - SIN tick de servidor propio: el drenaje por sangrado/infección y la
 *   resolución de "ya terminó de curar" son PEREZOSOS, con el mismo
 *   integrador `horasTranscurridas` que `tickVitales`/`aplicarInanicion`
 *   (vitales.ts) — se llaman desde el MISMO loop de movimiento que ya
 *   existe, nunca un setInterval nuevo.
 * - Alcance: solo JUGADORES llevan estado anatómico. Animales/NPCs siguen
 *   con el modelo de vida plana de `combate.ts` — añadir 6 zonas a cada
 *   bicho de cada combate sería mucho alcance nuevo sin pedirlo, y ni
 *   fauna ni NPCs van al curandero.
 */

export type Zona = "cabeza" | "torso" | "brazoIzq" | "brazoDer" | "piernaIzq" | "piernaDer";
export const ZONAS: readonly Zona[] = ["cabeza", "torso", "brazoIzq", "brazoDer", "piernaIzq", "piernaDer"];
/** Solo las extremidades se pueden amputar — cabeza/torso no tiene sentido (y sería letal directo). */
export const ZONAS_AMPUTABLES: readonly Zona[] = ["brazoIzq", "brazoDer", "piernaIzq", "piernaDer"];

/** `magico`/`fuego` reservados para cuando existan armas de ese tipo (CLAUDE.md §7, "las listas crecen") — sin efecto propio todavía, ningún arma del catálogo los usa. */
export type TipoDano = "cortante" | "contundente" | "perforante" | "magico" | "fuego";

export interface EstadoZona {
  /** Sangrando activo — drena vida cada hora real (ver aplicarDrenajeAnatomico). */
  sangrado: boolean;
  /** Fractura activa — penaliza velocidad (pierna) o bloquea combate/equipo/crafteo (brazo). */
  fractura: boolean;
  /** Infección activa — drena vida (más despacio que sangrar) y NO la cura el autocuidado, solo cirugía. */
  infectado: boolean;
  amputado: boolean;
  /** Prótesis instalada sobre una zona amputada — anula la penalización de esa zona, visual de madera en el cliente. */
  protesis: boolean;
  /** epoch ms real desde que se vendó — fase "cicatrizando" con malus leve hasta que pasen HORAS_CURAR_VENDA; null = no está vendada ahora mismo. */
  vendadoDesde: number | null;
  /** epoch ms real desde que se entablilló — mismo criterio que vendadoDesde, HORAS_CURAR_TABLILLA. */
  entablilladoDesde: number | null;
}

export type Anatomia = Record<Zona, EstadoZona>;

export function zonaInicial(): EstadoZona {
  return { sangrado: false, fractura: false, infectado: false, amputado: false, protesis: false, vendadoDesde: null, entablilladoDesde: null };
}

export function anatomiaInicial(): Anatomia {
  const a = {} as Anatomia;
  for (const z of ZONAS) a[z] = zonaInicial();
  return a;
}

// --- Probabilidades por golpe (pedidas literalmente por el streamer 2026-08-30) ---
/** Cortante Y perforante: probabilidad de sangrado por golpe conectado. */
export const PROB_SANGRADO = 0.2;
/** Solo cortante: probabilidad de amputar la zona golpeada (si es amputable), tirada INDEPENDIENTE del sangrado. "100 golpes cortantes, 1 amputa de media, pero es aleatorio" — pedido literal. */
export const PROB_AMPUTACION_CORTANTE = 0.01;
/** Solo contundente: probabilidad de fractura por golpe conectado. */
export const PROB_FRACTURA_CONTUNDENTE = 0.1;
/** Vendar sin ungüento: probabilidad de que la herida se infecte durante la cicatrización — placeholder de balance, fácil de ajustar. */
export const PROB_INFECCION_SIN_UNGUENTO = 0.25;

/** Zona golpeada — sorteo uniforme entre las 6, sin ponderar todavía (torso/cabeza más grandes en la realidad, pero simplificado a propósito en v1). */
export function elegirZonaGolpeada(rnd: () => number = Math.random): Zona {
  return ZONAS[Math.floor(rnd() * ZONAS.length)];
}

export interface ResultadoGolpe {
  zona: Zona;
  sangrado: boolean;
  fractura: boolean;
  amputacion: boolean;
}

/** Resuelve las tiradas de un golpe conectado — PURO, no muta nada, el llamador decide si aplicarlo (p.ej. solo si el objetivo es jugador y sigue vivo tras el golpe). */
export function resolverGolpeAnatomico(tipoDano: TipoDano, rnd: () => number = Math.random): ResultadoGolpe {
  const zona = elegirZonaGolpeada(rnd);
  let sangrado = false;
  let fractura = false;
  let amputacion = false;
  if (tipoDano === "cortante" || tipoDano === "perforante") {
    sangrado = rnd() < PROB_SANGRADO;
  }
  if (tipoDano === "cortante") {
    amputacion = ZONAS_AMPUTABLES.includes(zona) && rnd() < PROB_AMPUTACION_CORTANTE;
  }
  if (tipoDano === "contundente") {
    fractura = rnd() < PROB_FRACTURA_CONTUNDENTE;
  }
  return { zona, sangrado, fractura, amputacion };
}

/** Aplica un golpe ya resuelto sobre la zona correspondiente de la anatomía — muta `zonaEstado` en sitio. Amputar limpia la fractura de esa zona (ya no hay hueso que romper) y su curación en curso. */
export function aplicarGolpe(zonaEstado: EstadoZona, resultado: ResultadoGolpe): void {
  if (resultado.sangrado) {
    zonaEstado.sangrado = true;
    zonaEstado.vendadoDesde = null; // un golpe nuevo reabre la herida si estaba cicatrizando
  }
  if (resultado.fractura && !zonaEstado.amputado) {
    zonaEstado.fractura = true;
    zonaEstado.entablilladoDesde = null;
  }
  if (resultado.amputacion) {
    zonaEstado.amputado = true;
    zonaEstado.fractura = false;
    zonaEstado.entablilladoDesde = null;
  }
}

// --- Drenaje y curación perezosos (mismo integrador que vitales.ts::tickVitales) ---

/** Vida perdida por hora real por CADA zona sangrando activa. */
export const DRENAJE_SANGRADO_POR_HORA = 3;
/** Vida perdida por hora real por CADA zona infectada — más despacio que sangrar, pero no se detiene con la venda. */
export const DRENAJE_INFECCION_POR_HORA = 1.5;
/** Horas reales hasta que una venda cicatriza del todo (sangrado ya se detuvo al vendar; esto es el resto del proceso). */
export const HORAS_CURAR_VENDA = 3;
/** Horas reales hasta que una tablilla suelda del todo. */
export const HORAS_CURAR_TABLILLA = 6;
/** Por debajo de este % de vidaMax, el jugador entra en estado crítico. */
export const UMBRAL_CRITICO = 0.1;

/** Drena vida por sangrado/infección activos — perezoso, se llama desde el MISMO tick de movimiento que ya usa tickVitales, con el mismo `horasTranscurridas`. */
export function aplicarDrenajeAnatomico(anatomia: Anatomia, estado: { vida: number }, horasTranscurridas: number): void {
  if (horasTranscurridas <= 0) return;
  let sangrando = 0;
  let infectadas = 0;
  for (const z of ZONAS) {
    if (anatomia[z].sangrado) sangrando++;
    if (anatomia[z].infectado) infectadas++;
  }
  const drenaje = (sangrando * DRENAJE_SANGRADO_POR_HORA + infectadas * DRENAJE_INFECCION_POR_HORA) * horasTranscurridas;
  if (drenaje > 0) estado.vida = Math.max(0, estado.vida - drenaje);
}

/** Cierra la fase de "cicatrizando" de venda/tablilla cuando ya pasó su tiempo — perezoso, mismo tick que el drenaje. No hace falta pasar horasTranscurridas: compara contra `ahoraMs` directamente (igual que `estaHirviendo` en cocina.ts). */
export function resolverCuracionesEnCurso(anatomia: Anatomia, ahoraMs: number): void {
  for (const z of ZONAS) {
    const zona = anatomia[z];
    if (zona.vendadoDesde != null && ahoraMs - zona.vendadoDesde >= HORAS_CURAR_VENDA * 3_600_000) zona.vendadoDesde = null;
    if (zona.entablilladoDesde != null && ahoraMs - zona.entablilladoDesde >= HORAS_CURAR_TABLILLA * 3_600_000) zona.entablilladoDesde = null;
  }
}

export function estaCritico(vida: number, vidaMax: number): boolean {
  return vidaMax > 0 && vida / vidaMax < UMBRAL_CRITICO;
}

/** Al menos una zona infectada — la condición GLOBAL de "catarro" (docs/GDD_Enfermedades.md) se deriva de esto, no vive aquí como campo propio. */
export function tieneAlgunaInfeccion(anatomia: Anatomia): boolean {
  return ZONAS.some((z) => anatomia[z].infectado);
}

/** Limpia `infectado` en las 6 zonas — llamado al curar el catarro (4 ungüentos o 1 semana ingame), NUNCA toca sangrado/fractura/cicatrización (eso sigue siendo cosa de vendar/entablillar/cirugía). */
export function curarInfecciones(anatomia: Anatomia): void {
  for (const z of ZONAS) anatomia[z].infectado = false;
}

// --- Penalizaciones ---

/** Una pierna cuenta como "comprometida" si está fracturada, o amputada sin prótesis. */
function piernaComprometida(anatomia: Anatomia, z: Zona): boolean {
  return anatomia[z].fractura || (anatomia[z].amputado && !anatomia[z].protesis);
}

/** -75% de velocidad con cualquier pierna comprometida (pedido literal); varias piernas comprometidas no se acumulan doble. Combinar con el resto de multiplicadores de velocidad ya existentes (montura, terreno...). */
export function multiplicadorVelocidadPorFractura(anatomia: Anatomia): number {
  return piernaComprometida(anatomia, "piernaIzq") || piernaComprometida(anatomia, "piernaDer") ? 0.25 : 1;
}

/** Malus leve mientras una zona sigue "cicatrizando" tras vendar/entablillar (autocuidado es peor que la cirugía, pedido explícito) — placeholder de balance. */
export const MULTIPLICADOR_VELOCIDAD_CURANDO = 0.9;

export function multiplicadorVelocidadPorCuracion(anatomia: Anatomia): number {
  const curando = ZONAS.some((z) => anatomia[z].vendadoDesde != null || anatomia[z].entablilladoDesde != null);
  return curando ? MULTIPLICADOR_VELOCIDAD_CURANDO : 1;
}

/** Multiplicador extra mientras el jugador está en estado crítico (además de la penalización de piernas). */
export const MULTIPLICADOR_VELOCIDAD_CRITICO = 0.5;

/** Un brazo comprometido (fracturado, o amputado sin prótesis) bloquea atacar/equipar armas/usar herramientas — "solo permite consumibles/curarte a ti mismo", pedido literal. */
export function brazoInutilizado(anatomia: Anatomia): boolean {
  const comprometido = (z: Zona) => anatomia[z].fractura || (anatomia[z].amputado && !anatomia[z].protesis);
  return comprometido("brazoIzq") || comprometido("brazoDer");
}

// --- Acciones de curación ---

/**
 * Vendar (autocuidado, CUALQUIER jugador sobre sí mismo u otro, sin oficio):
 * detiene el sangrado activo al instante, entra en la fase de cicatrización
 * (`vendadoDesde`). Sin ungüento, tirada de riesgo de infección — "la mejor
 * forma es cirugía, si no, vendando con ungüentos para evitar infecciones".
 * `false` si no había nada que vendar (zona sin sangrado activo).
 */
export function usarVenda(zonaEstado: EstadoZona, conUnguento: boolean, ahoraMs: number, rnd: () => number = Math.random): boolean {
  if (!zonaEstado.sangrado) return false;
  zonaEstado.sangrado = false;
  zonaEstado.vendadoDesde = ahoraMs;
  if (!conUnguento && rnd() < PROB_INFECCION_SIN_UNGUENTO) zonaEstado.infectado = true;
  return true;
}

/** Entablillar (autocuidado, igual que vendar): detiene la penalización de fractura al instante, entra en fase de "soldando" (`entablilladoDesde`). `false` si no había fractura activa. */
export function usarTablilla(zonaEstado: EstadoZona, ahoraMs: number): boolean {
  if (!zonaEstado.fractura) return false;
  zonaEstado.fractura = false;
  zonaEstado.entablilladoDesde = ahoraMs;
  return true;
}

/**
 * Cirugía (oficio curandero, mesa_cirugia + camilla/cama + instrumental,
 * ver RoomExteriorBase.ts): cura TODO al instante en todas las zonas —
 * sangrado, fractura, infección, y las fases de cicatrización en curso.
 * NO toca amputado/protesis (eso es `instalarProtesis`, verbo aparte). El
 * llamador decide aparte si además restaura vida por sacar de crítico.
 */
export function operarCirugia(anatomia: Anatomia): void {
  for (const z of ZONAS) {
    const zona = anatomia[z];
    zona.sangrado = false;
    zona.fractura = false;
    zona.infectado = false;
    zona.vendadoDesde = null;
    zona.entablilladoDesde = null;
  }
}

/** Instala una prótesis de madera sobre una zona amputada — anula su penalización, el cliente cambia la malla visual. `false` si la zona no está amputada o ya tiene prótesis. */
export function instalarProtesis(zonaEstado: EstadoZona): boolean {
  if (!zonaEstado.amputado || zonaEstado.protesis) return false;
  zonaEstado.protesis = true;
  return true;
}
