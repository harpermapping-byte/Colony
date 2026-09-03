/**
 * Motor puro de combate táctico por turnos (docs/GDD_Combate.md, ✅
 * confirmado 2026-08-30) — iniciativa, orden de turnos, alcance y
 * resolución de daño sobre una arena NxN. Reutiliza `combate.ts`
 * (`calcularDanio`/`aplicarDanio`/`estaMuerto`) tal cual: NINGÚN sistema
 * de daño nuevo, solo la capa de turnos/rejilla que faltaba.
 *
 * Este mismo motor sirve para DOS caminos, sin duplicar lógica:
 *   1. Combate interactivo (jugador implicado): los mensajes
 *      `combate:iniciar/mover/accion/pasarTurno/huir` de una futura Room
 *      llaman a estas funciones una a una, esperando input real entre
 *      turnos — TODAVÍA SIN CABLEAR (helper puro listo, sin consumidor).
 *   2. Autosimulación (§7 del GDD, ningún jugador implicado — NPC vs
 *      animal, NPC vs NPC): `simularCombateAutomatico` resuelve el
 *      encuentro entero de una sentada, sin esperar a nadie.
 */
import { Arena, Casilla, distanciaChebyshev, esObstaculo, pasoHacia } from "./pathfindingArena";
import { aplicarDanio, calcularDanio, estaMuerto } from "./combate";
import { CatalogoItems, SlotsEquipo } from "../inventario/inventario";

export type Bando = "A" | "B";
export type EstadoUnidad = "activo" | "caido" | "huido";

export interface UnidadCombate {
  id: string;
  esJugador: boolean;
  bando: Bando;
  gx: number;
  gy: number;
  hp: number;
  hpMax: number;
  /** Recurso ÚNICO de turno: mover, atacar, usar objeto y magia salen todos de aquí (docs/GDD_Combate.md §9.3). */
  pa: number;
  paMax: number;
  iniciativa: number;
  estado: EstadoUnidad;
  ataqueFisico: number;
  /** Los animales no tienen defensa (docs/GDD_Mecanicas.md §5.4) — 0 para unidades animal. */
  defensaFisica: number;
  /** alcance en casillas (Chebyshev) del arma/ataque equipado. */
  alcance: number;
  /** docs/GDD_Caza.md — fauna NO peligrosa en modo caza: deambula sin rumbo, NUNCA ataca ni persigue, aunque el jugador esté a tiro. Ausente/false = IA normal (jugarTurnoIA). */
  pasivo?: boolean;
  /**
   * Habilidad por familia de arma (docs/GDD_Combate.md, pedido 2026-09-03:
   * "crealo con todo aquello que se pueda usar como arma... golpe especial
   * por familia") — snapshot tomado al crear la unidad desde
   * `items.json[armaEquipada].habilidadId` (ver `habilidadDeEquipo`), SOLO
   * jugador (fauna/enemigo/npc/compañero se quedan en "", sin árbol de
   * habilidades). "" = sin habilidad reconocida, `combate:accion` sin
   * `habilidadId` o con uno que no coincide con ESTE snapshot cae siempre
   * al ataque base — nunca se confía en lo que mande el cliente.
   */
  habilidadId?: string;
  /**
   * ¿Se movió esta unidad en SU turno más reciente? Reseteado a `false`
   * para todas las unidades activas en cada vuelta completa de turnos
   * (mismo punto que la regeneración de PA, `avanzarTurno`) — usado por
   * `hacha:tajoPesado` ("+daño si el objetivo no se movió") y por
   * `arco:apuntar` ("quedarse quieto y disparar dos veces": exige que el
   * PROPIO atacante no se haya movido este turno).
   */
  movioEsteTurno?: boolean;
  /**
   * Golpe de maza conectado (docs/GDD_Combate.md, `maza:aturdir`): pierde
   * su próxima acción — un jugador aturdido no puede atacar/mover/huir/usar
   * un objeto hasta que pase turno; una IA aturdida simplemente no actúa
   * este turno (`jugarTurnoIA` lo consume y limpia la bandera). Se limpia
   * también al avanzar el turno de la unidad (RoomExteriorBase.avanzarTurno).
   */
  aturdido?: boolean;
}

/** Iniciativa determinista: base del catálogo/atributo + variación pequeña por `rnd` (fijo en tests = reproducible). */
export function calcularIniciativa(base: number, rnd: () => number): number {
  return base + rnd() * 5;
}

/** Orden de turnos por iniciativa descendente — mismo criterio para ambos caminos (interactivo/autosimulado). */
export function ordenarTurnos(unidades: UnidadCombate[]): string[] {
  return [...unidades].sort((a, b) => b.iniciativa - a.iniciativa).map((u) => u.id);
}

/** Tirada de huida (docs/GDD_Combate.md, pedido streamer) — `rnd` inyectable para tests deterministas, mismo patrón que `calcularIniciativa`/`rodarInfeccionPorHerida`. */
export function tirarHuida(probabilidad: number, rnd: () => number = Math.random): boolean {
  return rnd() < probabilidad;
}

export function enAlcance(atacante: UnidadCombate, objetivo: UnidadCombate): boolean {
  return distanciaChebyshev({ gx: atacante.gx, gy: atacante.gy }, { gx: objetivo.gx, gy: objetivo.gy }) <= atacante.alcance;
}

/**
 * Munición a distancia (docs/GDD_Mecanicas.md §5.4, 2026-09-02) — el arma
 * en el slot `manoPrincipal` decide el `alcance` real de la unidad
 * (arco/ballesta/honda vs 1 a cuerpo a cuerpo) y si consume munición al
 * golpear. Puras: RoomExteriorBase las alimenta con SU `catalogoItems`/
 * `equipoInventario` (Maps de la room), y las usa tanto para construir la
 * `UnidadCombate` (alcanceDeEquipo) como para el chequeo/consumo en
 * `manejarCombateAccion` (municionDeEquipo).
 */
export function alcanceDeEquipo(catalogo: CatalogoItems, equipo: SlotsEquipo | undefined): number {
  const armaId = equipo?.manoPrincipal;
  if (!armaId) return 1;
  return catalogo[armaId]?.alcance ?? 1;
}

/** itemId de munición que consume el arma equipada al disparar (arco→flecha, ballesta→virote, honda→piedra) — undefined si es cuerpo a cuerpo o no consume nada. */
export function municionDeEquipo(catalogo: CatalogoItems, equipo: SlotsEquipo | undefined): string | undefined {
  const armaId = equipo?.manoPrincipal;
  if (!armaId) return undefined;
  return catalogo[armaId]?.municionId;
}

/**
 * `habilidadId` del arma equipada en `manoPrincipal` (docs/GDD_Combate.md,
 * pedido 2026-09-03) — "" si no lleva nada o el catálogo no le asignó
 * ninguna familia (herramientas nunca tienen este campo, fuera de alcance a
 * propósito). Mismo patrón exacto que `alcanceDeEquipo`/`municionDeEquipo`.
 */
export function habilidadDeEquipo(catalogo: CatalogoItems, equipo: SlotsEquipo | undefined): string {
  const armaId = equipo?.manoPrincipal;
  if (!armaId) return "";
  return catalogo[armaId]?.habilidadId ?? "";
}

/** Familia de una habilidad ("daga:puntoDebil" -> "daga") — "" si `habilidadId` está vacío. */
function familiaDe(habilidadId: string): string {
  return habilidadId.split(":")[0] ?? "";
}

/** Golpes por acción para esta habilidad — 2 para "arco:apuntar" ("quedarse quieto y disparar dos veces"), 1 para el resto. */
export function golpesDeHabilidad(habilidadId: string): number {
  return familiaDe(habilidadId) === "arco" ? 2 : 1;
}

/** PA EXTRA (por encima del coste base de un ataque) que exige esta habilidad — solo "arco:apuntar" cuesta más, por el segundo disparo. */
export function costeExtraPaDeHabilidad(habilidadId: string): number {
  return familiaDe(habilidadId) === "arco" ? 1 : 0;
}

/** Munición EXTRA (por encima de 1) que consume esta habilidad por golpe — "arco:apuntar" dispara dos veces, gasta el doble. */
export function municionExtraDeHabilidad(habilidadId: string): number {
  return familiaDe(habilidadId) === "arco" ? 1 : 0;
}

/** "arco:apuntar" exige que el propio atacante no se haya movido este turno ("quedarse quieto y disparar dos veces"). */
export function requiereQuietoHabilidad(habilidadId: string): boolean {
  return familiaDe(habilidadId) === "arco";
}

export interface ResultadoGolpe {
  objetivo: UnidadCombate;
  /** Daño de vida realmente aplicado (ya clamped a [0, hp]). */
  danio: number;
  /** Cuánto de `ataqueEfectivo` "paró" la defensa — lo que desgasta la armadura del objetivo (docs/GDD_Combate.md, desgaste). */
  absorbido: number;
}

/** Resuelve un golpe con ataque/defensa YA modificados por la habilidad que corresponda — núcleo compartido de `resolverAtaque`/`resolverAtaqueConHabilidad`. No muta ninguno de los dos argumentos. */
function golpear(objetivo: UnidadCombate, ataqueEfectivo: number, defensaEfectiva: number): ResultadoGolpe {
  const danio = calcularDanio(ataqueEfectivo, defensaEfectiva);
  const stats = aplicarDanio({ vida: objetivo.hp, vidaMax: objetivo.hpMax, ataque: 0, defensa: 0 }, danio);
  const absorbido = Math.max(0, ataqueEfectivo - danio);
  return {
    objetivo: { ...objetivo, hp: stats.vida, estado: estaMuerto({ vida: stats.vida }) ? "caido" : objetivo.estado },
    danio,
    absorbido,
  };
}

/** Aplica daño de `atacante` sobre `objetivo` con la fórmula ya existente — devuelve el objetivo actualizado (no muta). Ataque base ("golpear con lo que tengas"), sin ninguna habilidad. */
export function resolverAtaque(atacante: UnidadCombate, objetivo: UnidadCombate): UnidadCombate {
  return golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica).objetivo;
}

// Factores de las habilidades por familia (docs/GDD_Combate.md, pedido
// 2026-09-03: "usa tu criterio para asignar una mecánica con carácter a
// cada familia") — constantes de balance, ajustables sin tocar la forma.
const FACTOR_DEFENSA_DAGA = 0.7; // daga: golpe preciso, ignora 30% de la defensa (arma rápida y ligera, busca el hueco de la armadura)
const FACTOR_ATAQUE_ESPADA = 1.25; // espada: estocada técnica, +25% de ataque plano
const FACTOR_ATAQUE_HACHA_QUIETO = 1.4; // hacha: +40% de ataque si el objetivo no se movió en su último turno (castiga al que no maniobra)
const PROB_ATURDIR_MAZA = 0.25; // maza: 25% de aturdir al objetivo (pierde su próxima acción)

/**
 * Empuja `objetivo` 1 casilla en línea recta alejándose de `atacante`
 * (lanza: "golpe en línea que empuja") — no mueve nada si la casilla
 * destino es un obstáculo, está fuera de la arena o ya la ocupa otra unidad
 * activa (`ocupadas`, posiciones de TODAS las demás unidades vivas).
 */
function empujarLejosDe(atacante: UnidadCombate, objetivo: UnidadCombate, arena: Arena, ocupadas: Casilla[]): UnidadCombate {
  const dx = Math.sign(objetivo.gx - atacante.gx);
  const dy = Math.sign(objetivo.gy - atacante.gy);
  if (dx === 0 && dy === 0) return objetivo; // misma casilla (no debería pasar en combate real) — nada que empujar
  const destino: Casilla = { gx: objetivo.gx + dx, gy: objetivo.gy + dy };
  if (esObstaculo(arena, destino.gx, destino.gy)) return objetivo;
  if (ocupadas.some((c) => c.gx === destino.gx && c.gy === destino.gy)) return objetivo;
  return { ...objetivo, gx: destino.gx, gy: destino.gy };
}

/**
 * Golpe especial por familia de arma (docs/GDD_Combate.md, pedido
 * 2026-09-03) — mismo daño base que `resolverAtaque`, pero con una mecánica
 * de carácter añadida por familia:
 *   - `daga`: ignora parte de la defensa (golpe preciso).
 *   - `espada`: +daño plano (estocada técnica, la más "genérica").
 *   - `hacha`: +daño si el objetivo no se movió en su último turno.
 *   - `maza`: probabilidad baja de aturdir (pierde su próxima acción).
 *   - `baston`: reduce el PA restante del objetivo (golpe de barrido).
 *   - `lanza`: empuja al objetivo 1 casilla en línea (requiere `arena`/`ocupadas`).
 *   - `arco`/desconocida: sin modificador aquí — el "disparar dos veces" de
 *     `arco:apuntar` es responsabilidad del LLAMADOR (golpear dos veces con
 *     esta misma función, ver `golpesDeHabilidad`), no de esta función.
 * Familia vacía o no reconocida = idéntico a `resolverAtaque` (ataque base).
 */
export function resolverAtaqueConHabilidad(
  atacante: UnidadCombate,
  objetivo: UnidadCombate,
  habilidadId: string,
  arena: Arena,
  ocupadas: Casilla[] = [],
  rnd: () => number = Math.random,
): ResultadoGolpe {
  const familia = familiaDe(habilidadId);
  switch (familia) {
    case "daga":
      return golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica * FACTOR_DEFENSA_DAGA);
    case "espada":
      return golpear(objetivo, atacante.ataqueFisico * FACTOR_ATAQUE_ESPADA, objetivo.defensaFisica);
    case "hacha": {
      const factor = objetivo.movioEsteTurno ? 1 : FACTOR_ATAQUE_HACHA_QUIETO;
      return golpear(objetivo, atacante.ataqueFisico * factor, objetivo.defensaFisica);
    }
    case "maza": {
      const r = golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica);
      if (r.objetivo.estado !== "activo") return r; // ya cayó con el golpe — nada que aturdir
      const aturde = rnd() < PROB_ATURDIR_MAZA;
      return aturde ? { ...r, objetivo: { ...r.objetivo, aturdido: true } } : r;
    }
    case "baston": {
      const r = golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica);
      return { ...r, objetivo: { ...r.objetivo, pa: Math.max(0, r.objetivo.pa - 1) } };
    }
    case "lanza": {
      const r = golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica);
      if (r.objetivo.estado !== "activo") return r; // no empujes un cadáver
      return { ...r, objetivo: empujarLejosDe(atacante, r.objetivo, arena, ocupadas) };
    }
    default:
      return golpear(objetivo, atacante.ataqueFisico, objetivo.defensaFisica);
  }
}

/** El enemigo vivo más cercano de `unidades` a `u` (bando contrario), o null si no queda ninguno. */
function objetivoMasCercano(u: UnidadCombate, unidades: UnidadCombate[]): UnidadCombate | null {
  const enemigos = unidades.filter((x) => x.bando !== u.bando && x.estado === "activo");
  if (enemigos.length === 0) return null;
  return enemigos.reduce((mejor, c) =>
    distanciaChebyshev({ gx: u.gx, gy: u.gy }, { gx: c.gx, gy: c.gy }) <
    distanciaChebyshev({ gx: u.gx, gy: u.gy }, { gx: mejor.gx, gy: mejor.gy })
      ? c
      : mejor,
  );
}

// Deambular (docs/GDD_Caza.md): quieto o 1 paso a una casilla adyacente
// libre, elegido al azar — incluye "quieto" para que no sea un vaivén
// constante casilla a casilla.
const PASOS_DEAMBULAR: Casilla[] = [
  { gx: 0, gy: 0 }, { gx: 1, gy: 0 }, { gx: -1, gy: 0 }, { gx: 0, gy: 1 }, { gx: 0, gy: -1 },
];

/**
 * Turno de una presa (caza, docs/GDD_Caza.md): deambula sin rumbo por la
 * arena, NUNCA ataca ni persigue al jugador aunque esté a tiro — a
 * diferencia de `jugarTurnoIA`, ignora por completo `objetivoMasCercano`.
 * Un animal `peligroso:true` (jabalí, lobo, oso...) sigue usando la IA
 * normal — esta función es solo para la presa pasiva de un modo caza.
 */
function jugarTurnoIAPasiva(u: UnidadCombate, unidades: UnidadCombate[], arena: Arena, rnd: () => number): UnidadCombate[] {
  const paso = PASOS_DEAMBULAR[Math.floor(rnd() * PASOS_DEAMBULAR.length)];
  const destino: Casilla = { gx: u.gx + paso.gx, gy: u.gy + paso.gy };
  if (esObstaculo(arena, destino.gx, destino.gy)) return unidades;
  if (unidades.some((x) => x.id !== u.id && x.estado === "activo" && x.gx === destino.gx && x.gy === destino.gy)) return unidades;
  return unidades.map((x) => (x.id === u.id ? { ...x, gx: destino.gx, gy: destino.gy } : x));
}

/**
 * Juega el turno de UNA unidad con la IA simple ya descrita en el GDD
 * ("acercarse al enemigo vivo más cercano y atacar si está en alcance") —
 * extraído aparte para que lo use tanto `simularCombateAutomatico` como la
 * cascada de turnos de enemigo/fauna del combate INTERACTIVO
 * (`combate:pasarTurno`, cuando le toca a un `Enemigo`/`Fauna` sin cliente
 * que envíe mensajes). No muta `unidades`: devuelve la lista actualizada.
 */
export function jugarTurnoIA(idUnidad: string, unidades: UnidadCombate[], arena: Arena, rnd: () => number = Math.random): UnidadCombate[] {
  const u = unidades.find((x) => x.id === idUnidad);
  if (!u || u.estado !== "activo") return unidades;
  // Aturdido (maza:aturdir, docs/GDD_Combate.md): pierde esta acción entera
  // — ni se mueve ni ataca, solo se limpia la bandera (el jugador tiene el
  // guardia equivalente en RoomExteriorBase.manejarCombateAccion/Mover/Huir).
  if (u.aturdido) return unidades.map((x) => (x.id === u.id ? { ...x, aturdido: false } : x));
  if (u.pasivo) return jugarTurnoIAPasiva(u, unidades, arena, rnd);
  const objetivo = objetivoMasCercano(u, unidades);
  if (!objetivo) return unidades; // el otro bando ya cayó entero

  if (enAlcance(u, objetivo)) {
    const actualizado = resolverAtaque(u, objetivo);
    return unidades.map((x) => (x.id === actualizado.id ? actualizado : x));
  }
  // La IA usa TODO su PA restante en moverse cuando no puede atacar todavía
  // — sin reparto inteligente move-vs-ataque (v1, ver GDD_Combate §6).
  let pos: Casilla = { gx: u.gx, gy: u.gy };
  for (let paso = 0; paso < u.pa; paso++) {
    const siguiente = pasoHacia(arena, pos, { gx: objetivo.gx, gy: objetivo.gy });
    if (siguiente.gx === pos.gx && siguiente.gy === pos.gy) break; // atrapado
    pos = siguiente;
  }
  const movio = pos.gx !== u.gx || pos.gy !== u.gy;
  return unidades.map((x) => (x.id === u.id ? { ...x, gx: pos.gx, gy: pos.gy, movioEsteTurno: movio || x.movioEsteTurno } : x));
}

export interface ResultadoCombateAutomatico {
  unidades: UnidadCombate[];
  /** null = se alcanzó el tope de turnos sin que ningún bando cayera entero (raro: unidades que nunca se alcanzan). */
  bandoGanador: Bando | null;
  turnos: number;
}

const TOPE_TURNOS_AUTOSIMULACION = 50;

/**
 * Resuelve un combate ENTERO de una sentada (docs/GDD_Combate.md §7, pedido
 * explícito: "en combates de NPC contra animales o NPC vs NPC se
 * autosimule el combate") — IA idéntica en ambos bandos: acercarse al
 * enemigo vivo más cercano (`pasoHacia`, 1 paso por `mp` disponible) y
 * atacar si ya está en alcance. Determinista si `rnd` es fijo.
 *
 * Sin Schema, sin Room, sin red: quien llama a esto decide qué hacer con
 * el resultado (aplicar HP final a Fauna/Npc, generar cadáveres...) —
 * mismo patrón "mecanismo listo, disparador pendiente" que
 * `matarIndividuo`: hoy nada detecta un encuentro NPC-vs-animal/NPC para
 * llamar a esta función en producción.
 */
export function simularCombateAutomatico(
  bandoA: UnidadCombate[],
  bandoB: UnidadCombate[],
  arena: Arena,
  rnd: () => number = Math.random,
): ResultadoCombateAutomatico {
  let unidades = [...bandoA, ...bandoB].map((u) => ({ ...u }));

  for (let turno = 0; turno < TOPE_TURNOS_AUTOSIMULACION; turno++) {
    const quedanA = unidades.some((u) => u.bando === "A" && u.estado === "activo");
    const quedanB = unidades.some((u) => u.bando === "B" && u.estado === "activo");
    if (!quedanA) return { unidades, bandoGanador: "B", turnos: turno };
    if (!quedanB) return { unidades, bandoGanador: "A", turnos: turno };

    const orden = ordenarTurnos(unidades.filter((u) => u.estado === "activo"));
    for (const id of orden) {
      unidades = jugarTurnoIA(id, unidades, arena);
    }
  }
  return { unidades, bandoGanador: null, turnos: TOPE_TURNOS_AUTOSIMULACION };
}

export { esObstaculo };
export type { Arena, Casilla };
