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

// Reclutamiento (docs/GDD_Faccion_Bandidos.md §7ter, pedido 2026-08-30: "si
// empiezan con 5 tropas... con el tiempo y esos recursos pueden, en vez de
// mejorar la ciudad, contratar más tropa/gente, con límite razonable") —
// tope de población total (todos los rangos) por asentamiento. Placeholder
// de balance, mismo criterio que el resto de números de referencia.
export const POBLACION_MAX = 20;
// Piedra no tenía NINGÚN sumidero hasta ahora (madera->muralla, hierro->
// equipo se documentó en §7ter que se acumulaban sin tope una vez maxados
// esos dos niveles) — reclutar le da uno real. Cada recluta nuevo sale con
// rango "recluta" (gente sin más, no un ascenso — un guardia/líder no se
// "contrata", se asciende, mecánica futura fuera de esta pasada).
export const COSTE_RECLUTAMIENTO_PIEDRA = 80;

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

/**
 * Cuántos reclutas nuevos justifica la piedra YA acumulada de este pulso,
 * sin pasar de `POBLACION_MAX` tropas totales — función PURA, no toca BD
 * (mismo criterio que `calcularTick`: se prueba sola contra números, quien
 * gasta la piedra y crea las filas de verdad es `ejecutarTickEconomia`).
 * Puede recomendar VARIOS de golpe si hay piedra de sobra acumulada (la
 * producción normal es lenta, pero adelantar muchos pulsos de golpe — un
 * test, o un asentamiento descubierto tarde — puede acumular mucha piedra).
 */
export function reclutasARecluter(asentamiento: Asentamiento, tropasVivas: number): number {
  const hueco = POBLACION_MAX - tropasVivas;
  if (hueco <= 0) return 0;
  return Math.min(hueco, Math.floor(asentamiento.piedra / COSTE_RECLUTAMIENTO_PIEDRA));
}

/**
 * Un pulso real: lee todos los asentamientos, aplica calcularTick, persiste.
 * Solo los que siguen en manos de la facción ("bandido") — un asentamiento
 * ya conquistado (§ conquista, abajo) pasa a "neutral" y esta economía de
 * guerra (recursos → muralla/equipo/reclutamiento) deja de aplicarle; su
 * propia progresión (donaciones/misiones) es otro sistema, fuera de
 * alcance aquí.
 */
export async function ejecutarTickEconomia(bd: IAlmacenDatos): Promise<void> {
  const asentamientos = await bd.listarAsentamientos();
  for (const a of asentamientos) {
    if (a.bando !== "bandido") continue;
    const tropas = await bd.listarTropas(a.id);
    const vivas = tropas.filter((t) => t.estado === "vivo").length;
    const siguiente = calcularTick(a, vivas);

    const nuevosReclutas = reclutasARecluter(siguiente, vivas);
    if (nuevosReclutas > 0) {
      siguiente.piedra -= nuevosReclutas * COSTE_RECLUTAMIENTO_PIEDRA;
      for (let i = 0; i < nuevosReclutas; i++) await bd.crearTropa(a.id, "recluta");
    }

    await bd.guardarAsentamiento(siguiente);
  }
}

// ---------------------------------------------------------------------------
// Conquista (docs/GDD_Faccion_Bandidos.md §7): si un jugador mata a la
// ÚLTIMA tropa viva de un asentamiento bandido, la facción lo pierde — pasa
// a "neutral" y su población civil se regenera con las MISMAS normas que
// cualquier otra aldea (poblacion/, mismo generador, mismo catálogo de
// oficios). Estructura/decoración NO se tocan: es la misma ciudad ya
// bakeada (mismo tier+semilla = mismo layout de edificios, determinista),
// solo cambia quién la habita.
//
// Nada llama a esto en producción todavía — el trigger real (un jugador
// matando tropas en combate) depende de un sistema de combate que sigue
// sin diseñar (GDD §2.4). Esta es la costura: en cuanto algo llame a
// marcarTropaMuertaYVerificarConquista en vez del bd.marcarTropaMuerta
// crudo, la conquista se dispara sola sin que ese futuro código sepa nada
// de repoblación.
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as path from "node:path";
import { tiempoMundo } from "./tiempoMundo";
import { narrarConquista } from "../ia/cronicaBandida";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const RUTA_EXPORTAR_ASENTAMIENTO = path.join(RAIZ_REPO, "poblacion", "src", "exportarAsentamiento.js");

interface ModuloExportarAsentamiento {
  exportarAsentamiento(tierId: string, semilla: string, opciones?: Record<string, unknown>): Promise<Record<string, unknown>>;
  escribirPoblacionDeMapa(resultado: Record<string, unknown>, carpetaMapa: string): { ruta: string; npcs: number };
}

/**
 * Regenera `poblacion.json` de un asentamiento ya bakeado, con la MISMA
 * ciudad (mismo tier+semilla, leídos de su propio indice.json — nunca se
 * inventan aquí) pero población civil nueva — mismo generador y mismas
 * normas que cualquier aldea neutral (GDD_Poblacion_NPCs.md), sin tocar
 * terreno/edificios/decoración. `rutaMapa` es la carpeta del asentamiento
 * (donde ya viven indice.json y los sectores bakeados).
 */
export async function repoblarAsentamientoConquistado(rutaMapa: string): Promise<{ ruta: string; npcs: number }> {
  const indice = JSON.parse(fs.readFileSync(path.join(rutaMapa, "indice.json"), "utf8")) as {
    tier?: string;
    semilla?: string;
  };
  if (!indice.tier || !indice.semilla) {
    throw new Error(`repoblarAsentamientoConquistado: "${rutaMapa}"/indice.json no trae tier/semilla`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { exportarAsentamiento, escribirPoblacionDeMapa } = require(RUTA_EXPORTAR_ASENTAMIENTO) as ModuloExportarAsentamiento;
  const resultado = await exportarAsentamiento(indice.tier, indice.semilla);
  return escribirPoblacionDeMapa(resultado, rutaMapa);
}

/**
 * Transición bandido -> neutral: guarda el cambio de bando, deja una
 * entrada de crónica (docs/GDD_Faccion_Bandidos.md §7quinquies: redactada
 * por IA con los nombres reales de quienes lo lograron, o el texto de
 * siempre si no hay IA configurada) y dispara la repoblación. Idempotente:
 * si el asentamiento YA es neutral, no hace nada (nunca reconquista dos
 * veces ni regenera población sobre población ya conquistada).
 */
export async function conquistarAsentamiento(
  bd: IAlmacenDatos,
  asentamiento: Asentamiento,
  rutaMapa: string,
  jugadoresGanadores: string[] = [],
): Promise<void> {
  if (asentamiento.bando !== "bandido") return;
  await bd.guardarAsentamiento({ ...asentamiento, bando: "neutral" });
  const dia = tiempoMundo().dia;
  const evento = await narrarConquista(asentamiento.id, jugadoresGanadores);
  if (jugadoresGanadores.length === 0) {
    await bd.registrarMemoriaLider(dia, evento, { tipo: "asentamiento_conquistado", asentamientoId: asentamiento.id });
  } else {
    for (const jugador of jugadoresGanadores) {
      await bd.registrarMemoriaLider(dia, evento, { tipo: "asentamiento_conquistado", asentamientoId: asentamiento.id, jugador });
    }
  }
  await repoblarAsentamientoConquistado(rutaMapa);
}

/**
 * El punto de entrada real para cuando exista combate: en vez de llamar a
 * `bd.marcarTropaMuerta` a secas, se llama a esto — marca la baja Y
 * comprueba sola si esa era la última tropa viva, disparando la conquista
 * si toca. `asentamientoId`/`rutaMapa` los conoce quien mata a la tropa
 * (la room del combate sabe en qué mapa/asentamiento está pasando).
 * `jugadoresGanadores` (docs/GDD_Faccion_Bandidos.md §7quinquies, pedido
 * 2026-08-30: "que la historia... nombres de jugadores... se recuerden") —
 * quien llama ya sabe qué jugadores estaban en el bando ganador del
 * combate real que mató esta tropa; vacío si no se pudo atribuir (p.ej.
 * autosimulación NPC-vs-fauna, sin jugador de por medio).
 */
export async function marcarTropaMuertaYVerificarConquista(
  bd: IAlmacenDatos,
  tropaId: string,
  asentamientoId: string,
  rutaMapa: string,
  jugadoresGanadores: string[] = [],
): Promise<{ conquistada: boolean }> {
  await bd.marcarTropaMuerta(tropaId);
  const tropas = await bd.listarTropas(asentamientoId);
  if (tropas.some((t) => t.estado === "vivo")) return { conquistada: false };

  const asentamiento = await bd.obtenerOCrearAsentamiento(asentamientoId);
  if (asentamiento.bando !== "bandido") return { conquistada: false }; // ya conquistada antes

  await conquistarAsentamiento(bd, asentamiento, rutaMapa, jugadoresGanadores);
  return { conquistada: true };
}
