/**
 * NPCs trabajadores contratables (docs/GDD_NPCs_Contratables.md, pedido
 * 2026-09-01): "cualquier jugador contrata NPCs trabajadores" desde el
 * reclutador de la capital — PURA (sin Colyseus/BD/fs), mismo patrón que
 * crafteo.ts/oficios.ts: números y funciones que RoomExteriorBase aplica
 * sobre las filas reales de `npcs_trabajadores`.
 */
import { OFICIOS_JUGADOR_VALIDOS } from "../personaje/oficios";

// --- Oficios contratables (jugador + "transporte") ---

/**
 * "transporte" como oficio de TRABAJADOR contratado (docs/GDD_NPCs_Contratables.md
 * §Fusión con transporte, pedido 2026-09-01) — decisión: NO se añade a
 * `OFICIOS_JUGADOR_VALIDOS` (server/src/personaje/oficios.ts), que gobierna
 * los 2 slots de oficio de JUGADOR (XP, nivel, mesas por nivel, bonos de
 * velocidad/cantidad — todo ligado a una sesión de jugador real). Un
 * trabajador contratado de oficio "transporte" no craftea nada ni sube de
 * nivel: opera una RUTA (server/src/mundo/agentes.ts::agregarAgenteTransportista),
 * conceptualmente distinto de los 10 oficios de mesa+receta. Un jugador
 * tampoco "transporta" bienes él mismo del mismo modo que forja o talla, así
 * que ofrecérselo como 3er slot de personaje no encajaría en ese sistema —
 * es exclusivo del catálogo de TRABAJADOR.
 */
export const OFICIO_TRANSPORTE = "transporte";

/**
 * "tendero" como oficio de TRABAJADOR contratado (docs/GDD_Mercado.md §12,
 * pedido posterior a v1: "para que esta tienda funcione deben contratar a un
 * tendero") — mismo criterio que "transporte" (§Fusión con transporte de
 * docs/GDD_NPCs_Contratables.md): NO se añade a `OFICIOS_JUGADOR_VALIDOS`
 * porque un tendero no craftea nada, no sube de nivel, no tiene mesas por
 * nivel — solo se PLANTA en un `puesto_mercado_jugador` (asignado con el
 * mismo `trabajador:asignarMesa` de siempre) para que la parte pública del
 * tenderete (escaparate/comprar) quede abierta (RoomExteriorBase.ts,
 * `tieneTenderoOperando`).
 */
export const OFICIO_TENDERO = "tendero";

/** Oficios contratables desde el reclutador: los 10 de jugador + "transporte" + "tendero". `oficiosValidos`/costes/salario usan ESTE set, nunca `OFICIOS_JUGADOR_VALIDOS` directamente. */
export const OFICIOS_TRABAJADOR_VALIDOS: ReadonlySet<string> = new Set<string>([...OFICIOS_JUGADOR_VALIDOS, OFICIO_TRANSPORTE, OFICIO_TENDERO]);

// --- Coste de contratación (creciente por oficio adicional) ---

/** Coste del PRIMER oficio. Cada oficio adicional cuesta más que el anterior (ver costeContratacionTrabajador) — "cuantos más oficios, más caro" del pedido. */
export const COSTE_BASE_OFICIO_TRABAJADOR = 100;
/** +50% del coste base por cada oficio por encima del primero — progresión simple, fácil de razonar para el jugador (nada de exponenciales). */
export const INCREMENTO_POR_OFICIO_ADICIONAL = 0.5;

/**
 * Coste total en Farycoins de contratar un trabajador con `numOficios`
 * oficios: suma de `coste_base * (1 + incremento*(i-1))` para i=1..n — el
 * oficio i-ésimo cuesta más que el (i-1)-ésimo, así que el coste MARGINAL
 * crece con cada oficio añadido (no solo el total). Con los valores por
 * defecto: 1 oficio = 100, 2 = 250, 3 = 450, 4 = 700...
 */
export function costeContratacionTrabajador(numOficios: number): number {
  let total = 0;
  for (let i = 1; i <= numOficios; i++) total += COSTE_BASE_OFICIO_TRABAJADOR * (1 + INCREMENTO_POR_OFICIO_ADICIONAL * (i - 1));
  return Math.round(total);
}

/**
 * Un tendero EN SOLITARIO (docs/GDD_Mercado.md §12, pedido explícito: "el
 * costo de este NPC es menor que el resto") cuesta menos de contratar Y de
 * mantener que cualquier trabajador de 1 oficio normal — no craftea nada, su
 * único trabajo es plantarse en el puesto para que la tienda esté abierta.
 * Combinado con OTRO oficio (p.ej. ["tendero","herrero"]) no aplica ningún
 * descuento — usa la fórmula normal, mismo criterio que el resto de
 * combinaciones (excepción NARROW, documentada aquí a propósito porque
 * rompe el invariante "nunca mira el NOMBRE del oficio" que sienta
 * docs/GDD_NPCs_Contratables.md §Fusión con transporte — este pedido lo
 * pide explícitamente para tendero solo).
 */
export const COSTE_TENDERO_SOLO = 40;
export const SALARIO_TENDERO_SOLO = 8;

function esTenderoEnSolitario(oficios: readonly string[]): boolean {
  return oficios.length === 1 && oficios[0] === OFICIO_TENDERO;
}

/** Coste real de contratar con esta lista exacta de oficios — envuelve `costeContratacionTrabajador` aplicando el descuento de tendero-solo. Usar SIEMPRE que se conozca la lista real (contratación); `costeContratacionTrabajador(numOficios)` se queda para la vista genérica "por cantidad" del catálogo, que no conoce oficios concretos. */
export function costeContratarOficios(oficios: readonly string[]): number {
  if (esTenderoEnSolitario(oficios)) return COSTE_TENDERO_SOLO;
  return costeContratacionTrabajador(oficios.length);
}

/** `true` si la lista es un subconjunto no vacío, sin duplicados, de los oficios contratables (los 10 de jugador + "transporte", `OFICIOS_TRABAJADOR_VALIDOS`). */
export function oficiosValidos(oficios: string[]): boolean {
  if (oficios.length === 0) return false;
  if (new Set(oficios).size !== oficios.length) return false;
  return oficios.every((o) => OFICIOS_TRABAJADOR_VALIDOS.has(o));
}

/** ¿puede este trabajador operar una receta de este oficio? — reusa el mismo catálogo cerrado que un jugador (requisito §6 del pedido: "reutiliza la validación de oficio que ya existe"). */
export function puedeOperarOficio(oficiosTrabajador: string[], oficioReceta: string): boolean {
  return oficiosTrabajador.includes(oficioReceta);
}

// --- Salario mensual ---

/** Farycoins/mes por oficio del trabajador — un trabajador con más oficios también cuesta más de mantener, no solo más de contratar. */
export const SALARIO_BASE_MES_POR_OFICIO = 15;

export function salarioMensualTrabajador(numOficios: number): number {
  return SALARIO_BASE_MES_POR_OFICIO * Math.max(1, numOficios);
}

/** Salario real de esta lista exacta de oficios — igual que `costeContratarOficios`, aplica el descuento de tendero-solo (COSTE_TENDERO_SOLO/SALARIO_TENDERO_SOLO) antes de caer a la fórmula normal por cantidad. */
export function salarioMensualDeOficios(oficios: readonly string[]): number {
  if (esTenderoEnSolitario(oficios)) return SALARIO_TENDERO_SOLO;
  return salarioMensualTrabajador(oficios.length);
}

/**
 * Días de mundo entre un pago y el siguiente — MISMO calendario que
 * `assets/mundo/tiempo.json` (`diasPorMes`, hoy 30) pero como constante
 * propia: este módulo es puro (no puede importar el JSON de assets sin
 * arrastrar una dependencia de rutas relativas de servidor), y el streamer
 * puede cambiar el calendario del mundo sin que esto se desincronice si
 * algún día se prefiere un ciclo de "salario" distinto al de "mes" — hoy
 * son el mismo número a propósito.
 */
export const DIAS_POR_MES_TRABAJADOR = 30;

export interface TrabajadorParaPago {
  id: number;
  oficios: string[];
  fechaContratacionDia: number;
  ultimoPagoDia: number;
}

export interface ResultadoPayroll {
  /** `false` = todavía no toca pagar a este dueño — no hacer nada (ni cobrar ni despedir). */
  tocaPagar: boolean;
  /** Farycoins que se cobrarán de golpe (suma de `aPagar`) — 0 si `tocaPagar` es `false` o si todos se despiden. */
  costeTotal: number;
  /** Trabajadores que siguen activos tras esta resolución (cobrados, `ultimoPagoDia` debe pasar a `diaActual`). */
  aPagar: TrabajadorParaPago[];
  /** Trabajadores que se despiden por no llegar el dinero — el llamante debe borrarlos de BD y del mundo. */
  aDespedir: TrabajadorParaPago[];
}

/**
 * Cálculo PURO y perezoso del día de pago (docs/GDD_NPCs_Contratables.md
 * §Salario) — mismo espíritu que `resolverIngresoDiarioNpc`: nadie llama
 * esto en un cron, se resuelve por comparación de días cuando alguien mira
 * (aquí: el tick periódico de trabajadores del room, agrupado por dueño).
 *
 * "De golpe" (pedido literal: "si tiene 10, paga a los 10 juntos ese día"):
 * el ANCLA del ciclo de pago de un dueño es el `ultimoPagoDia` MÁS ANTIGUO
 * entre sus trabajadores activos — así, aunque se contraten en días
 * distintos, el primer pago sincroniza a todo el grupo en la misma fecha
 * para siempre después (un trabajador nuevo se pliega al ciclo del grupo,
 * puede que cobre un pelín antes de cumplir su primer mes completo — efecto
 * secundario aceptado a cambio de la simplicidad de un solo ciclo por
 * dueño, documentado aquí en vez de escondido).
 *
 * Si el saldo no alcanza para pagar a todos, se despide primero a los
 * CONTRATADOS MÁS RECIENTES (`fechaContratacionDia` descendente) hasta que
 * el resto quepa en `saldoDisponible` — decisión de diseño (el pedido dejaba
 * elegir entre "más caros" o "más recientes"): despedir por antigüedad
 * protege a los trabajadores más asentados/productivos del jugador, que es
 * la lectura más intuitiva de "se me fue el dinero, pierdo lo último que
 * contraté" — un trabajador de un solo día nunca desplaza a uno de varios
 * meses solo por ser más barato de mantener.
 */
export function resolverPayroll(trabajadores: TrabajadorParaPago[], diaActual: number, saldoDisponible: number): ResultadoPayroll {
  if (trabajadores.length === 0) return { tocaPagar: false, costeTotal: 0, aPagar: [], aDespedir: [] };

  const anclaMinima = Math.min(...trabajadores.map((t) => t.ultimoPagoDia));
  if (diaActual - anclaMinima < DIAS_POR_MES_TRABAJADOR) {
    return { tocaPagar: false, costeTotal: 0, aPagar: [], aDespedir: [] };
  }

  const ordenadosPorAntiguedad = [...trabajadores].sort((a, b) => a.fechaContratacionDia - b.fechaContratacionDia);
  const aDespedir: TrabajadorParaPago[] = [];
  let aPagar = ordenadosPorAntiguedad;
  let costeTotal = aPagar.reduce((s, t) => s + salarioMensualDeOficios(t.oficios), 0);
  // se despide desde el FINAL de la lista ordenada por antigüedad (el más reciente) mientras no quepa en el saldo
  while (costeTotal > saldoDisponible && aPagar.length > 0) {
    const masReciente = aPagar[aPagar.length - 1];
    aDespedir.push(masReciente);
    aPagar = aPagar.slice(0, -1);
    costeTotal = aPagar.reduce((s, t) => s + salarioMensualDeOficios(t.oficios), 0);
  }
  return { tocaPagar: true, costeTotal, aPagar, aDespedir };
}
