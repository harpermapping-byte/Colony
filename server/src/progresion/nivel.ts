/**
 * Curva de nivel por XP compartida — antes vivía solo en crafteo.ts (nivel de
 * oficio, docs/GDD_Crafteo.md §6). docs/GDD_Personaje.md reusa EXACTAMENTE el
 * mismo mecanismo para el nivel de cada atributo del personaje: "el nivel se
 * deriva de XP, nunca se persiste en sí" es un principio, no algo propio del
 * crafteo — de ahí que se mueva aquí y ambos consumidores importen de un
 * único sitio (nunca dupliques una fuente de verdad).
 */

/**
 * Genera una curva de niveles por números triangulares: el umbral de cada
 * nivel crece un `incrementoBase` MÁS que el salto anterior —
 * `umbral(n) = incrementoBase * (n-1) * n / 2` — así cada nivel exige más
 * XP que el anterior (nunca lineal) sin necesitar una tabla escrita a
 * mano. Con `incrementoBase=100` genera EXACTAMENTE los mismos 6 umbrales
 * que ya usaba oficios (`[0,100,300,600,1000,1500]`) — la fórmula no es
 * nueva, es la que ya estaba ahí puesta en limpio para poder reusarla con
 * otro `nivelMax` (los atributos, pedido 2026-08-30: "que tenga de 1 a 10
 * niveles con más exp por nivel, no sea que se levee muy rápido").
 */
export function generarUmbrales(nivelMax: number, incrementoBase: number): number[] {
  const umbrales: number[] = [];
  for (let n = 1; n <= nivelMax; n++) {
    umbrales.push((incrementoBase * (n - 1) * n) / 2);
  }
  return umbrales;
}

/**
 * PLACEHOLDER de balance (mismo criterio que pesoMaximoTransportable,
 * tiempoBaseSeg...): números de referencia a afinar, no una decisión
 * cerrada. Nivel 1 = sin XP. Oficios: máximo nivel 10 (antes 6, pedido
 * 2026-08-30 "afinar oficio" — exclusividad real de 2 oficios elegidos,
 * mesas desbloqueadas por nivel, bono de velocidad+cantidad de crafteo).
 * Umbral del nivel 10 = 4050 XP (`generarUmbrales(10,90)`), pensado para que
 * un jugador DEDICADO (farmeo activo de XP de oficio, varias horas/día)
 * llegue al tope en ~2 semanas, y uno CASUAL (sesiones cortas, XP de rebote
 * al craftear/recolectar sin perseguirlo) tarde ~1 mes — con
 * `XP_POR_CRAFTEO=20` (RoomExteriorBase.ts) eso son ~200 crafteos/recolectas
 * de un dedicado o ~135/mes de un casual, ambos plausibles a ese ritmo.
 */
export const UMBRALES_NIVEL = generarUmbrales(10, 90);

/**
 * Atributos del personaje (docs/GDD_Personaje.md, pedido 2026-08-30):
 * máximo nivel 10, MISMO incremento base que oficios (100) pero con más
 * niveles — el umbral del nivel 10 (4500 XP) es 3x el antiguo tope de
 * oficios (1500 XP en nivel 6), así que llegar al máximo de un atributo
 * cuesta deliberadamente más que subir de oficio.
 */
export const UMBRALES_NIVEL_ATRIBUTO = generarUmbrales(10, 100);

/**
 * Nivel derivado de XP — nunca se persiste el nivel en sí, siempre se
 * calcula de la XP guardada. `umbrales` por defecto es la curva de
 * oficios (compatibilidad con el resto del código que ya llamaba
 * `nivelDeXp(xp)` sin segundo argumento); los atributos pasan
 * `UMBRALES_NIVEL_ATRIBUTO` explícitamente.
 */
export function nivelDeXp(xp: number, umbrales: number[] = UMBRALES_NIVEL): number {
  let nivel = 1;
  for (let i = 1; i < umbrales.length; i++) {
    if (xp >= umbrales[i]) nivel = i + 1;
  }
  return nivel;
}
