/**
 * Luz ambiente por hora del día en interiores (docs/Backlog_Mecanicas_Futuras.md,
 * "Luz ambiente por hora del día en interiores"; docs/GDD_Bakeador_Interiores.md
 * §7bis): cada ventana ya bakeada trae su `aporteLuz` resuelto
 * (interiores/src/colocarElementos.js) — este módulo solo combina la SUMA
 * de aporteLuz de una sala con la hora del reloj de mundo.
 *
 * Mismo patrón "cero red" que tiempoMundo.ts/clima.ts (docs/GDD_Clima.md
 * §2, patrón A): cliente y servidor calcularían el MISMO resultado sin
 * sincronizar nada por red si algún día el servidor también lo necesitara
 * (Sigilo/IA de NPC, backlog) — hoy solo lo usa el cliente, porque ya tiene
 * el JSON completo de cada sala en memoria al pintarla
 * (client/src/render3d/interiorVisual.ts), así que no hace falta ni un
 * campo nuevo en ningún Schema de Colyseus ni un mensaje nuevo.
 *
 * Importa la CONSTANTE directamente de `assets/mundo/tiempo.json` (no de
 * `client/src/mundo/tiempoMundo.ts`, que lee `location.search` al cargar el
 * módulo — rompe en un entorno de test sin DOM) — misma fuente única, solo
 * evita ese efecto de carga.
 */
import tiempoJson from "../../../assets/mundo/tiempo.json";

const HORA_AMANECER = tiempoJson.horaAmanecer;
const HORA_ANOCHECER = tiempoJson.horaAnochecer;

/** Suelo nocturno — nunca 0 del todo (luz de luna), pedido explícito del backlog ("de noche no entra nada, o solo un poco de luz de luna"). */
export const NIVEL_LUZ_LUNA = 0.15;

/**
 * Nivel de luz EXTERIOR (0..1) para una hora de mundo (0..24 fraccional):
 * interpola LUNA→1.0→LUNA entre el amanecer y el anochecer (coseno/seno,
 * mismo criterio que ya usa `client/src/render3d/cicloDia.ts` y
 * `server/src/mundo/clima.ts` para curvas hora→magnitud) y se queda en el
 * suelo de luna el resto de la noche.
 */
export function nivelLuzExterior(hora: number): number {
  if (hora < HORA_AMANECER || hora >= HORA_ANOCHECER) return NIVEL_LUZ_LUNA;
  const t = (hora - HORA_AMANECER) / (HORA_ANOCHECER - HORA_AMANECER); // 0..1
  const curvaDia = Math.sin(t * Math.PI); // 0 en los bordes del día, 1 al mediodía solar
  return NIVEL_LUZ_LUNA + (1 - NIVEL_LUZ_LUNA) * curvaDia;
}

/** Tope de luzAmbienteSala — una sala nunca queda "más luminosa que el propio exterior". */
export const TOPE_LUZ_AMBIENTE = 1;

/**
 * Luz ambiente (0..1) de una sala, dada la hora y la SUMA de `aporteLuz` de
 * sus ventanas: `nivelLuzExterior(hora) × √sumaAporteLuz`, acotado a
 * `TOPE_LUZ_AMBIENTE`. Raíz cuadrada (no lineal) a propósito — pedido
 * explícito del backlog: "una sala con 4 ventanas pequeñas no debería
 * quedar más luminosa que una con una ventana grande al mediodía". Con
 * `aporteLuz` típico ≈1 por ventana media/grande, 4 ventanas dan √4=2 vs.
 * 1 ventana da √1=1 — sigue habiendo diferencia real, pero con
 * rendimientos decrecientes en vez de escalar lineal (4 ventanas
 * "deberían" dar 4×, absurdamente por encima de cualquier tope razonable).
 * Una sala SIN ventana (sumaAporteLuz de bodega, o cualquier sala con
 * `permiteVentanas:false`) da 0 siempre, sea cual sea la hora — "una sala
 * sin ventana nunca recibe luz ambiente" (GDD_Bakeador_Interiores §7bis).
 */
export function luzAmbienteSala(hora: number, sumaAporteLuz: number): number {
  if (sumaAporteLuz <= 0) return 0;
  const crudo = nivelLuzExterior(hora) * Math.sqrt(sumaAporteLuz);
  return Math.min(TOPE_LUZ_AMBIENTE, crudo);
}
