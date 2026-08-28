/**
 * Tick de economía de la facción bandida (docs/GDD_Faccion_Bandidos.md,
 * fase 1: datos + tick, sin IA ni patrullas en vivo todavía). Cálculo
 * perezoso puro — sin 3D, sin física, solo aritmética + persistencia
 * (IAlmacenDatos) — mismo espíritu que tiempoMundo()/GestorAgentes: nada
 * de reconstruir esto por casilla ni por jugador conectado.
 *
 * `calcularTick` es una función PURA (estado actual + nº de tropas vivas →
 * estado siguiente) a propósito: así se prueba sin tocar SQLite, y
 * `ejecutarTickEconomia` es el único punto que lee/escribe de verdad.
 */
import { Asentamiento, IAlmacenDatos } from "../datos/bd";

// Guarnición inicial de un asentamiento bandido la primera vez que se
// descubre (RegionRoom lo llama al cargar una región cuyo indice.json trae
// tier "asentamiento_hostil") — un puñado fijo, no aleatorio: la variedad
// real la da la economía viva a partir de aquí, no el reparto inicial.
const GUARNICION_INICIAL: { rango: "lider" | "guardia" | "recluta"; cantidad: number }[] = [
  { rango: "lider", cantidad: 1 },
  { rango: "guardia", cantidad: 2 },
  { rango: "recluta", cantidad: 4 },
];

/**
 * Idempotente: crea la fila de asentamiento y su guarnición inicial la
 * PRIMERA vez que se referencia un id (ya sea porque RegionRoom cargó esa
 * región, o porque un test/script lo pide) — llamadas siguientes con el
 * mismo id no tocan nada si ya hay tropas.
 */
export async function asegurarAsentamientoBandido(bd: IAlmacenDatos, id: string): Promise<Asentamiento> {
  const asentamiento = await bd.obtenerOCrearAsentamiento(id, "bandido");
  const tropas = await bd.listarTropas(id);
  if (tropas.length === 0) {
    for (const { rango, cantidad } of GUARNICION_INICIAL) {
      for (let i = 0; i < cantidad; i++) await bd.crearTropa(id, rango);
    }
  }
  return asentamiento;
}

// Por tropa viva del asentamiento (recluta/guardia/lider cuentan igual en
// esta primera pasada — matizar por rango cuando haga falta).
export const COMIDA_CONSUMO_POR_TROPA = 2;
export const MADERA_GENERADA_POR_TROPA = 3;
export const PIEDRA_GENERADA_POR_TROPA = 1;
export const HIERRO_GENERADO_POR_TROPA = 1;

// Solo 2 niveles de muralla — son los 2 materiales reales que ya existen
// (empalizada/muralla_piedra, baker/catalogo/terrenos.json) — no tiene
// sentido un nivel 3 sin un tercer material bakeado.
export const NIVEL_MURALLA_MAX = 2;
export const COSTE_MURALLA_NIVEL2_MADERA = 500;

// 3 niveles de equipo (garrote/túnica, cota/espada, placas/hacha) — coste
// en hierro por cada subida, acumulativo (subir a 3 exige haber subido a 2 antes).
export const NIVEL_EQUIPO_MAX = 3;
export const COSTE_EQUIPO_NIVEL2_HIERRO = 150;
export const COSTE_EQUIPO_NIVEL3_HIERRO = 400;

function costeSiguienteNivelEquipo(nivelActual: number): number | null {
  if (nivelActual === 1) return COSTE_EQUIPO_NIVEL2_HIERRO;
  if (nivelActual === 2) return COSTE_EQUIPO_NIVEL3_HIERRO;
  return null; // ya está al máximo
}

/**
 * Un tick = un "pulso" de economía (diario/horario según lo tickee quien
 * llame) — NO calcula tiempo transcurrido real, cada llamada es un pulso
 * fijo, mismo criterio que GestorAgentes.tick(dt) recibiendo un delta de
 * quien orquesta, no leyendo el reloj él mismo.
 */
export function calcularTick(actual: Asentamiento, tropasVivas: number): Asentamiento {
  const siguiente: Asentamiento = { ...actual };

  // Consumo de comida por población — si no llega, el asentamiento pasa
  // hambre (comida a 0, sin producción extra) en vez de números negativos;
  // morir de hambre de verdad es mecánica de combate/vitales, fuera de
  // alcance de esta fase (GDD §2.4/Backlog "Sistema de personaje").
  const consumo = tropasVivas * COMIDA_CONSUMO_POR_TROPA;
  siguiente.comida = Math.max(0, siguiente.comida - consumo);

  siguiente.madera += tropasVivas * MADERA_GENERADA_POR_TROPA;
  siguiente.piedra += tropasVivas * PIEDRA_GENERADA_POR_TROPA;
  siguiente.hierro += tropasVivas * HIERRO_GENERADO_POR_TROPA;

  if (siguiente.nivelMuralla < NIVEL_MURALLA_MAX && siguiente.madera >= COSTE_MURALLA_NIVEL2_MADERA) {
    siguiente.madera -= COSTE_MURALLA_NIVEL2_MADERA;
    siguiente.nivelMuralla += 1;
  }

  const costeEquipo = costeSiguienteNivelEquipo(siguiente.nivelEquipo);
  if (costeEquipo !== null && siguiente.hierro >= costeEquipo) {
    siguiente.hierro -= costeEquipo;
    siguiente.nivelEquipo += 1;
  }

  return siguiente;
}

/** Un pulso real: lee todos los asentamientos, aplica calcularTick, persiste. */
export async function ejecutarTickEconomia(bd: IAlmacenDatos): Promise<void> {
  const asentamientos = await bd.listarAsentamientos();
  for (const a of asentamientos) {
    const tropas = await bd.listarTropas(a.id);
    const vivas = tropas.filter((t) => t.estado === "vivo").length;
    const siguiente = calcularTick(a, vivas);
    await bd.guardarAsentamiento(siguiente);
  }
}
