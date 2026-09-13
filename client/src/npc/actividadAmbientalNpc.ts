/**
 * Comportamiento ambiental de NPCs de rutina (poblacion/, docs/GDD_Agentes_
 * Moviles.md) — pedido streamer 2026-09-13: "los NPC que hacen acciones de
 * trabajo etc deberían tener animación correspondiente así no se ven
 * estáticos, deben estar animados si conversan entre ellos etc, y las
 * conversaciones se ven encima de sus cabezas como ya tenemos con otros NPC
 * evento de estos". `Npc.accion` (server/src/mundo/agentes.ts) ya replica
 * el tramo activo de la rutina horaria (`poblacion/catalogo/
 * perfilesSociales.json`), pero el cliente solo aplicaba la pose de
 * "trabajando" (rigHumanoide.ts) a `accion==="craftear"` (NPC tutorial
 * artesano) — cualquier aldeano real vendiendo/entrenando/rezando/
 * charlando se quedaba plantado como una estatua.
 *
 * Módulo PURO (sin THREE/DOM) a propósito, mismo criterio que
 * visibilidadNombres.ts — testeable con node --test sin arrastrar
 * worldScene.ts/tiempoMundo.ts.
 */

/**
 * Acciones de rutina en las que un NPC debería verse "ocupado" (pose de
 * trabajando: inclinado, brazos moviéndose) en vez de la postura de reposo
 * por defecto. Deja fuera a propósito: `pasear`/`patrullar` (ya animan con
 * la marcha real), `dormir`/`dormir_calle` (pose de dormir aparte),
 * `estatua` (un artista callejero que imita una estatua — DEBE quedarse
 * inmóvil, animarlo sería el bug contrario), `tambalear` (bamboleo de
 * borracho, gesto distinto), `pedir`/`pedir_sentado`/`ocio`/`vigilar`
 * (posturas de espera/quietud intencionadas, no "trabajo").
 */
const ACCIONES_OCUPADAS = new Set([
  "trabajar",
  "vender",
  "recaudar",
  "entrenar",
  "buscar_gallinas",
  "bendecir",
  "orar",
  "misa",
  "profetizar",
  "contar_historias",
  "cantar",
  "vigilar_difuntos",
  "socializar",
  "cotillear",
  "beber",
  "comer",
]);

/** true si esta `accion` de rutina debería aplicar la pose de "trabajando" del rig en vez de dejar al NPC plantado quieto. */
export function esAccionOcupada(accion: string | undefined | null): boolean {
  return !!accion && ACCIONES_OCUPADAS.has(accion);
}

/**
 * Catálogo de frases ambientales — NUNCA generadas en vivo/IA (coste cero,
 * determinista, mismo criterio que el pregón de los NPCs "especiales" en
 * poblacion/catalogo/especiales.json), solo para las acciones que son
 * literalmente "hablar con otros"/"hablar al grupo". Vocabulario del Lore
 * Canon real (jarl, Kaldrborg, la Corrupción, el Gran Éxodo —
 * personajes/catalogo/contexto_mundo.json) para que encajen con el resto
 * del mundo en vez de sonar genéricas.
 */
const LINEAS_CHARLA: Record<string, string[]> = {
  socializar: [
    "Qué día tan tranquilo, ¿eh?",
    "¿Has probado el pan de hoy?",
    "Este frío no hay quien lo aguante.",
    "La cosecha viene buena este año.",
    "¿Sabes algo del jarl últimamente?",
    "Mi espalda ya no es la de antes.",
  ],
  cotillear: [
    "Dicen que el herrero anda mal de dinero...",
    "¿Te has enterado de lo del molinero?",
    "No se lo digas a nadie, pero...",
    "La del pozo vio algo raro anoche.",
    "Cuentan que hay bandidos cerca del bosque.",
    "Ese forastero no me da buena espina.",
  ],
  contar_historias: [
    "...y así fue como el jarl cruzó el hielo.",
    "En tiempos del Gran Éxodo, dicen que...",
    "Nadie ha vuelto jamás de esa mazmorra.",
    "Mi abuelo luchó junto al primer jarl.",
    "La Corrupción del norte no perdona a nadie.",
  ],
  profetizar: [
    "¡El fin se acerca, arrepentíos!",
    "¡La Corrupción nos consumirá a todos!",
    "¡He visto el destino de Kaldrborg!",
    "¡Escuchad las señales de los cielos!",
    "¡Solo los justos sobrevivirán!",
  ],
};

/** Hash barato y determinista (sin dependencias) — solo para desincronizar NPCs entre sí, nunca para nada criptográfico. */
function hashTexto(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Cadencia de cambio de frase — algo más lenta que el pregón (13s) para no saturar una plaza con varios NPCs charlando a la vez. */
const PERIODO_CHARLA_SEG = 16;
/** Segundos, de cada ciclo, en los que se muestra la frase en vez del nombre. */
const VENTANA_MOSTRAR_SEG = 5;

/**
 * Frase de charla para este NPC en este instante, o `null` si esa `accion`
 * no conversa (nada que mostrar). Estable dentro de cada ciclo de
 * `PERIODO_CHARLA_SEG` (no cambia frame a frame) y distinta por NPC gracias
 * al hash de `slotId` sumado al ciclo — dos vecinos charlando no repiten
 * la misma frase a la vez.
 */
export function fraseCharla(accion: string | undefined | null, slotId: string, tSeg: number): string | null {
  if (!accion) return null;
  const lineas = LINEAS_CHARLA[accion];
  if (!lineas || lineas.length === 0) return null;
  const ciclo = Math.floor(tSeg / PERIODO_CHARLA_SEG) + hashTexto(slotId);
  return lineas[ciclo % lineas.length];
}

/** true mientras toque mostrar la frase de charla (en vez del nombre) en este instante — mismo patrón de alternancia que ya usa el pregón de los NPCs especiales. */
export function mostrandoCharla(slotId: string, tSeg: number): boolean {
  const desfase = (hashTexto(slotId) % 997) * 0.013;
  const fase = (tSeg + desfase) % PERIODO_CHARLA_SEG;
  return fase < VENTANA_MOSTRAR_SEG;
}
