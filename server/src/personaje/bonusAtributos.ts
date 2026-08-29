/**
 * Qué hace cada NIVEL de cada atributo (docs/GDD_Personaje.md §3.3, pedido
 * explícito 2026-08-30: "si tengo nivel 1 no me da bonus de nada, si tengo
 * nivel 10 sí, cada nivel que tenga"). Módulo PURO — cada función es
 * `bonus(nivel) -> valor`, monótona, con nivel 1 = el valor BASE sin ningún
 * bonus (nunca 0 en seco cuando el sistema ya tenía un mínimo, p.ej. vida
 * base 100) y nivel 10 = el máximo de la curva. Ninguna de estas funciones
 * toca BD/Colyseus — quien las llama (RoomExteriorBase, HubRoom) aplica el
 * resultado sobre el Schema/handler que corresponda.
 *
 * Solo hay función para los atributos que YA tienen un sistema real al que
 * enganchar el bonus — `sigilo` no tiene ninguna (no existe sistema de
 * sigilo en el servidor): inventar un bonus sin nada que module sería
 * inventar el sistema entero, no un número.
 */

/** Fuerza -> peso máximo transportable (kg, unidad ya usada por items/catalogo/items.json). Nivel 1 = 20 (base ya existente), nivel 10 = 56. */
export function pesoMaximoTransportable(nivelFuerza: number): number {
  return 20 + (nivelFuerza - 1) * 4;
}

/** Resistencia -> vida máxima del jugador. Nivel 1 = 100 (la base obligatoria, docs/GDD_Mecanicas.md §5.4), nivel 10 = 190. */
export function vidaMaximaPorResistencia(nivelResistencia: number): number {
  return 100 + (nivelResistencia - 1) * 10;
}

/** Destreza -> PA máximos en combate táctico (más acciones por turno — mover/atacar/objeto/magia, docs/GDD_Combate.md §9.3). Nivel 1-3 = 6 PA (base, PA_MAX_COMBATE en RoomExteriorBase.ts), sube +1 cada 3 niveles, nivel 10 = 9 PA. */
export function paMaxPorDestreza(nivelDestreza: number): number {
  return 6 + Math.floor((nivelDestreza - 1) / 3);
}

/** Inteligencia -> factor de velocidad de crafteo (multiplica, nunca divide — duracionMs = tiempoBaseSeg/factor). Nivel 1 = 1.0 (sin bonus), nivel 10 = 1.45 (45% más rápido). */
export function factorVelocidadCrafteo(nivelInteligencia: number): number {
  return 1 + (nivelInteligencia - 1) * 0.05;
}

/** Carisma -> cooldown de "hablar con un NPC" en ms (más interacciones seguidas). Nivel 1 = 3000ms (el cooldown ya existente), nivel 10 = 1200ms — nunca baja de 1000ms (cuota de la IA sigue mandando). */
export function cooldownNpcHablarMs(nivelCarisma: number): number {
  return Math.max(1000, 3000 - (nivelCarisma - 1) * 200);
}

/** Comercio -> descuento al comprar en un tenderete (0 a 1). Nivel 1 = 0 (precio de lista, sin bonus), nivel 10 = 0.18 (18% de descuento). */
export function descuentoComercio(nivelComercio: number): number {
  return Math.min(0.18, (nivelComercio - 1) * 0.02);
}
