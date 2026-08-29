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
  ap: number;
  apMax: number;
  mp: number;
  mpMax: number;
  iniciativa: number;
  estado: EstadoUnidad;
  ataqueFisico: number;
  /** Los animales no tienen defensa (docs/GDD_Mecanicas.md §5.4) — 0 para unidades animal. */
  defensaFisica: number;
  /** alcance en casillas (Chebyshev) del arma/ataque equipado. */
  alcance: number;
}

/** Iniciativa determinista: base del catálogo/atributo + variación pequeña por `rnd` (fijo en tests = reproducible). */
export function calcularIniciativa(base: number, rnd: () => number): number {
  return base + rnd() * 5;
}

/** Orden de turnos por iniciativa descendente — mismo criterio para ambos caminos (interactivo/autosimulado). */
export function ordenarTurnos(unidades: UnidadCombate[]): string[] {
  return [...unidades].sort((a, b) => b.iniciativa - a.iniciativa).map((u) => u.id);
}

export function enAlcance(atacante: UnidadCombate, objetivo: UnidadCombate): boolean {
  return distanciaChebyshev({ gx: atacante.gx, gy: atacante.gy }, { gx: objetivo.gx, gy: objetivo.gy }) <= atacante.alcance;
}

/** Aplica daño de `atacante` sobre `objetivo` con la fórmula ya existente — devuelve el objetivo actualizado (no muta). */
export function resolverAtaque(atacante: UnidadCombate, objetivo: UnidadCombate): UnidadCombate {
  const danio = calcularDanio(atacante.ataqueFisico, objetivo.defensaFisica);
  const stats = aplicarDanio({ vida: objetivo.hp, vidaMax: objetivo.hpMax, ataque: 0, defensa: 0 }, danio);
  return { ...objetivo, hp: stats.vida, estado: estaMuerto({ vida: stats.vida }) ? "caido" : objetivo.estado };
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
      const u = unidades.find((x) => x.id === id)!;
      if (u.estado !== "activo") continue;
      const objetivo = objetivoMasCercano(u, unidades);
      if (!objetivo) break; // el otro bando ya cayó entero a mitad de ronda

      if (enAlcance(u, objetivo)) {
        const actualizado = resolverAtaque(u, objetivo);
        unidades = unidades.map((x) => (x.id === actualizado.id ? actualizado : x));
      } else {
        let pos: Casilla = { gx: u.gx, gy: u.gy };
        for (let paso = 0; paso < u.mp; paso++) {
          const siguiente = pasoHacia(arena, pos, { gx: objetivo.gx, gy: objetivo.gy });
          if (siguiente.gx === pos.gx && siguiente.gy === pos.gy) break; // atrapado
          pos = siguiente;
        }
        unidades = unidades.map((x) => (x.id === u.id ? { ...x, gx: pos.gx, gy: pos.gy } : x));
      }
    }
  }
  return { unidades, bandoGanador: null, turnos: TOPE_TURNOS_AUTOSIMULACION };
}

export { esObstaculo };
export type { Arena, Casilla };
