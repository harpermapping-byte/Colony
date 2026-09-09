/**
 * Reasignación de teclas (pedido streamer 2026-09-09: "una zona de ajustes
 * donde blindear las teclas... a acciones del juego"). Diseño de bajo
 * riesgo, pensado para NO tocar el switch gigante de `game.ts::keydown`
 * (~25 comparaciones literales `k === "..."` ya probadas): en vez de
 * reescribir cada comparación, se REMAPEA LA ENTRADA — `resolverTeclaLogica`
 * traduce la tecla FÍSICA que el jugador acaba de pulsar a la tecla LÓGICA
 * que el código de siempre espera, en un ÚNICO punto (justo tras
 * `const k = e.key.toLowerCase()`). Sin ninguna reasignación guardada,
 * `resolverTeclaLogica(x) === x` siempre — cero cambio de comportamiento.
 *
 * Movimiento (WASD/flechas/Shift) queda FUERA a propósito: son ejes
 * continuos leídos directamente en `bucle()`, no "acciones" de un disparo,
 * y remapearlos multiplicaría el riesgo de romper el control base del
 * juego para un beneficio que nadie pidió. H (hablar con NPC + talar
 * árbol) y Espacio (golpe de forja + salto montado) comparten literal en
 * el código real — se reasignan como una sola entrada "combinada" para no
 * poder separar sin querer dos acciones que hoy viven bajo la misma tecla.
 */

export interface AccionReasignable {
  id: string;
  etiqueta: string;
  teclaDefecto: string; // ya en minúscula, mismo formato que e.key.toLowerCase()
}

export const ACCIONES_REASIGNABLES: AccionReasignable[] = [
  { id: "bucear", etiqueta: "Bucear / bajar de nivel", teclaDefecto: "q" },
  { id: "subirNivel", etiqueta: "Subir de nivel", teclaDefecto: "e" },
  { id: "construccion", etiqueta: "Modo construcción", teclaDefecto: "b" },
  { id: "mapa", etiqueta: "Mapa de mundo", teclaDefecto: "m" },
  { id: "plantillasJarl", etiqueta: "Plantillas del jarl", teclaDefecto: "z" },
  { id: "reclutador", etiqueta: "Reclutador", teclaDefecto: "r" },
  { id: "inventario", etiqueta: "Inventario / equipo", teclaDefecto: "i" },
  { id: "resumen", etiqueta: "Resumen (lo que tienes)", teclaDefecto: "tab" },
  { id: "interactuarPuerta", etiqueta: "Cruzar puerta / sentarse", teclaDefecto: "f" },
  { id: "atacar", etiqueta: "Atacar", teclaDefecto: "c" },
  { id: "unirseCombate", etiqueta: "Unirse a combate cercano", teclaDefecto: "v" },
  { id: "interactuarH", etiqueta: "Hablar con NPC + talar árbol", teclaDefecto: "h" },
  { id: "accionEspacio", etiqueta: "Golpe de forja + saltar montado", teclaDefecto: " " },
  { id: "lootear", etiqueta: "Lootear cadáver", teclaDefecto: "l" },
  { id: "desollar", etiqueta: "Desollar cadáver", teclaDefecto: "k" },
  { id: "despiezar", etiqueta: "Despiezar cadáver", teclaDefecto: "o" },
  { id: "alimentarMascota", etiqueta: "Dar de comer a mascota", teclaDefecto: "g" },
  { id: "comerciar", etiqueta: "Proponer comercio", teclaDefecto: "t" },
  { id: "pescar", etiqueta: "Pescar", teclaDefecto: "u" },
  { id: "ponerMontura", etiqueta: "Poner montura", teclaDefecto: "n" },
  { id: "montar", etiqueta: "Montar / desmontar", teclaDefecto: "x" },
  { id: "colocarBarco", etiqueta: "Colocar barco", teclaDefecto: "j" },
  { id: "montarBarco", etiqueta: "Montar / desmontar barco", teclaDefecto: "p" },
  { id: "cofrePrueba", etiqueta: "Cofre de prueba (Test Zone)", teclaDefecto: "y" },
  { id: "panelDebugAdmin", etiqueta: "Panel debug admin (Test Zone)", teclaDefecto: "f9" },
];

const CLAVE_LOCALSTORAGE = "configTeclas";

/** Teclas que nunca se pueden asignar a una acción — son el movimiento base del juego. */
const TECLAS_RESERVADAS_MOVIMIENTO = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"]);

function leerConfigGuardada(): Record<string, string> {
  try {
    const crudo = localStorage.getItem(CLAVE_LOCALSTORAGE);
    return crudo ? JSON.parse(crudo) : {};
  } catch {
    return {};
  }
}

function guardarConfig(config: Record<string, string>): void {
  try {
    localStorage.setItem(CLAVE_LOCALSTORAGE, JSON.stringify(config));
  } catch {
    // localStorage puede fallar (modo privado, cuota) — la reasignación
    // simplemente no persiste entre sesiones, el juego sigue jugable.
  }
}

/** Tecla física actualmente asignada a una acción (el default si nunca se tocó). */
export function obtenerTeclaAsignada(accionId: string): string {
  const guardada = leerConfigGuardada()[accionId];
  if (guardada) return guardada;
  return ACCIONES_REASIGNABLES.find((a) => a.id === accionId)?.teclaDefecto ?? "";
}

/** Nunca coincide con ninguna tecla real de `e.key.toLowerCase()` — usado para "apagar" la tecla por defecto de una acción ya reasignada a otro sitio (ver construirMapaInverso). */
const TECLA_APAGADA = "\u0000"; // caracter de control invisible, nunca resultado real de e.key.toLowerCase()

/**
 * Mapa tecla física -> tecla lógica que el código de `game.ts` espera,
 * reconstruido cada vez que cambia algo (barato, ~24 entradas). No basta
 * con mapear "la tecla nueva -> la lógica de siempre": si no se APAGA
 * también la tecla POR DEFECTO de la acción reasignada, las DOS teclas
 * (la vieja y la nueva) dispararían la misma acción a la vez — bug real
 * encontrado con un e2e antes de dar esto por bueno.
 */
function construirMapaInverso(): Map<string, string> {
  const mapa = new Map<string, string>();
  const config = leerConfigGuardada();
  const teclasDefectoReasignadas = new Set<string>();
  for (const accion of ACCIONES_REASIGNABLES) {
    const teclaFisica = config[accion.id] ?? accion.teclaDefecto;
    mapa.set(teclaFisica, accion.teclaDefecto);
    if (teclaFisica !== accion.teclaDefecto) teclasDefectoReasignadas.add(accion.teclaDefecto);
  }
  for (const teclaDefecto of teclasDefectoReasignadas) {
    if (!mapa.has(teclaDefecto)) mapa.set(teclaDefecto, TECLA_APAGADA);
  }
  return mapa;
}

/**
 * Traduce lo que el jugador ACABA de pulsar (`e.key.toLowerCase()`) a la
 * tecla lógica que el switch de `game.ts` compara — único punto de
 * integración, llamar justo tras calcular `k`. Sin reasignaciones
 * guardadas, siempre devuelve el mismo valor de entrada.
 */
export function resolverTeclaLogica(teclaFisica: string): string {
  return construirMapaInverso().get(teclaFisica) ?? teclaFisica;
}

export type ResultadoAsignar = { ok: true } | { ok: false; motivo: string };

/** Reasigna `accionId` a `teclaNueva` (ya en minúscula) — rechaza duplicados y teclas de movimiento reservadas. */
export function asignarTecla(accionId: string, teclaNueva: string): ResultadoAsignar {
  if (TECLAS_RESERVADAS_MOVIMIENTO.has(teclaNueva)) {
    return { ok: false, motivo: "esa tecla es del movimiento (WASD/flechas/Shift), no se puede reasignar" };
  }
  if (teclaNueva === "escape") {
    return { ok: false, motivo: "Escape está reservado para cerrar paneles" };
  }
  const config = leerConfigGuardada();
  for (const accion of ACCIONES_REASIGNABLES) {
    if (accion.id === accionId) continue;
    const teclaDeOtra = config[accion.id] ?? accion.teclaDefecto;
    if (teclaDeOtra === teclaNueva) {
      return { ok: false, motivo: `esa tecla ya la usa "${accion.etiqueta}"` };
    }
  }
  config[accionId] = teclaNueva;
  guardarConfig(config);
  return { ok: true };
}

/** Deshace TODAS las reasignaciones — vuelve a los valores por defecto de siempre. */
export function restablecerTeclas(): void {
  guardarConfig({});
}
