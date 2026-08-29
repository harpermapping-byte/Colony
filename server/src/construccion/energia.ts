/**
 * Red motriz (docs/GDD_Motriz.md): potencia mecánica que fluye por
 * adyacencia de CASILLA entre piezas con campo `energia` de catálogo — sin
 * estructura de grafo propia, se recorre el mismo `ContextoConstruccion.
 * ocupacion` que ya usan parcelas/construcciones (regla 7 CLAUDE.md: las
 * listas crecen, el código no — cero estructura nueva para algo que ya
 * existe).
 *
 * Cálculo perezoso puro (regla 1 CLAUDE.md): `potenciaDisponibleEnCasillas`
 * se llama SOLO en el instante en que algo pregunta "¿tengo potencia?"
 * (empezar una acción con tiempo sobre una mesa de profesión, o el mensaje
 * opcional `motriz:consultar`) — nunca hay un tick ni un caché que
 * mantener vivo. El BFS es barato (tope de nodos) y se tira al acabar.
 */

import { ContextoConstruccion } from "./construccion";
import { EntradaConstruible } from "./catalogo";

export interface PotenciaResultado {
  /** Suma de `produce` de toda fuente alcanzada sin cruzar un corte (freno activado, o palanca apuntando a otro canal). */
  disponible: number;
  /** Nº de piezas fuente encontradas — útil para depurar/mostrar en UI. */
  fuentes: number;
}

// Acotado a propósito: una red de una parcela normal tiene decenas de
// piezas, nunca cientos — evita que una red patológicamente grande cueste
// más que un cálculo O(1) esperado dentro del hilo de un mensaje de cliente.
const TOPE_NODOS = 200;

type Direccion = 0 | 1 | 2 | 3; // 0=Norte 1=Este 2=Sur 3=Oeste

function vecinosDeCasilla(clave: number, ancho: number, alto: number): { clave: number; direccion: Direccion }[] {
  const x = clave % ancho;
  const y = Math.floor(clave / ancho);
  const vecinos: { clave: number; direccion: Direccion }[] = [];
  if (y > 0) vecinos.push({ clave: clave - ancho, direccion: 0 });
  if (x < ancho - 1) vecinos.push({ clave: clave + 1, direccion: 1 });
  if (y < alto - 1) vecinos.push({ clave: clave + ancho, direccion: 2 });
  if (x > 0) vecinos.push({ clave: clave - 1, direccion: 3 });
  return vecinos;
}

/**
 * BFS de potencia disponible alrededor de `clavesMesa` (típicamente la
 * huella de la pieza que consulta): recorre piezas vecinas con campo
 * `energia`, sumando cada fuente alcanzada sin cruzar un corte. Las propias
 * casillas de `clavesMesa` no se tratan como nodos de red — solo se usan
 * como punto de partida — así una mesa de profesión con `energia.consume`
 * (que no tiene `transmite`) igualmente mira a SUS vecinos.
 */
export function potenciaDisponibleEnCasillas(
  ctx: ContextoConstruccion,
  catalogo: Map<string, EntradaConstruible>,
  clavesMesa: number[],
): PotenciaResultado {
  const visitados = new Set<number>(clavesMesa);
  const cola: number[] = [];
  for (const clave of clavesMesa) {
    for (const v of vecinosDeCasilla(clave, ctx.mapa.ancho, ctx.mapa.alto)) {
      if (!visitados.has(v.clave)) cola.push(v.clave);
    }
  }

  let disponible = 0;
  let fuentes = 0;
  let visitas = 0;
  // Una construcción con huella >1x1 (un molino de 9x10, p.ej.) ocupa varias
  // CLAVES pero es UNA sola pieza — sin esto, cada casilla de su huella se
  // visitaría como nodo propio y su `produce` se sumaría una vez por
  // casilla en vez de una vez por construcción (bug real encontrado antes
  // de enviar, con el molino_agua del E2E).
  const procesados = new Set<number>();

  while (cola.length > 0 && visitas < TOPE_NODOS) {
    const clave = cola.shift()!;
    if (visitados.has(clave)) continue;
    visitados.add(clave);
    visitas++;

    const id = ctx.ocupacion.get(clave);
    if (id === undefined) continue;
    const viva = ctx.vivas.get(id);
    if (!viva) continue;
    const en = catalogo.get(viva.objeto)?.energia;
    if (!en) continue; // pieza sin campo energia: no conduce ni produce

    const primeraVezEstaConstruccion = !procesados.has(id);
    procesados.add(id);
    if (primeraVezEstaConstruccion && en.produce) {
      disponible += en.produce;
      fuentes++;
    }
    if (!en.transmite && !en.produce) continue; // nodo de consumo puro: no reenvía

    const extra = viva.extra as { frenado?: boolean; canalActivo?: number } | null;
    if (en.interrumpible && extra?.frenado) continue; // freno activado: corta aquí, no expande

    const canalActivo = en.canales !== undefined ? (extra?.canalActivo ?? 0) : undefined;
    for (const v of vecinosDeCasilla(clave, ctx.mapa.ancho, ctx.mapa.alto)) {
      if (canalActivo !== undefined && v.direccion !== canalActivo) continue; // palanca de cambios: solo el canal seleccionado
      if (!visitados.has(v.clave)) cola.push(v.clave);
    }
  }

  return { disponible, fuentes };
}

/**
 * Gancho para cualquier futura acción con tiempo (crafteo, mejora...) sobre
 * una mesa de profesión: llamar UNA VEZ al EMPEZAR la acción, nunca en cada
 * frame — mismo espíritu que `aplicarDesgasteInactividad` (inventario/
 * desgaste.ts). Sin sistema de crafteo aún en el proyecto, esta función es
 * el contrato que ese sistema futuro consumirá tal cual.
 */
export function factorVelocidadPorEnergia(
  ctx: ContextoConstruccion,
  catalogo: Map<string, EntradaConstruible>,
  mesa: { objeto: string; claves: number[] },
): number {
  const entrada = catalogo.get(mesa.objeto);
  const consumo = entrada?.energia?.consume;
  if (!consumo) return 1; // mesa sin campo energia: comportamiento de hoy, sin cambios
  const { disponible } = potenciaDisponibleEnCasillas(ctx, catalogo, mesa.claves);
  return disponible >= consumo ? (entrada!.energia!.multiplicador ?? 1) : 1;
}
