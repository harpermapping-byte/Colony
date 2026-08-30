/**
 * Oficio de jugador — segunda pasada (docs/GDD_Profesiones.md, pedido
 * 2026-08-30: "Oficio de jugador sigue sin coste ni exclusividad real...
 * añadirle stats de suciedad"). PURA (sin Colyseus/BD), mismo patrón que
 * vitales.ts/anatomia.ts: números y funciones que RoomExteriorBase aplica
 * sobre el `Player` real.
 *
 * Diseño acordado con el streamer:
 * - Cada jugador tiene EXACTAMENTE 2 slots de oficio (`oficio1`/`oficio2` en
 *   Player, "" = vacío), elegidos hablando con el NPC "maestro de oficios"
 *   (plantado a mano por el admin, ver `server/src/mundo/npcsFijos.ts`).
 * - Elegir un slot VACÍO es gratis. Cambiar un slot YA ocupado cuesta
 *   `PRECIO_CAMBIO_OFICIO` Farycoins y REINICIA a 0 la XP del oficio que se
 *   quita (`jugador_oficios`, server/src/datos/bd.ts) — el nuevo oficio
 *   también arranca a 0 (nivel 1 real, sin atajos).
 * - La XP de oficio SOLO se otorga si el jugador tiene ese oficio elegido en
 *   uno de sus 2 slots (`tieneOficio`) — antes cualquiera podía subir XP en
 *   cualquier oficio sin haberlo "elegido", que era la raíz de la falta de
 *   exclusividad. El crafteo en sí (mesa+nivel+insumos) sigue abierto a
 *   cualquiera como hasta ahora — lo que cambia es que solo progresas de
 *   verdad (más nivel, más mesas, más bono) en TUS 2 oficios.
 */

// LOS 10 oficios finales (docs/GDD_Profesiones.md §0) — misma lista cerrada
// que ya vivía en RoomExteriorBase.ts, movida aquí para que este módulo no
// dependa de la room.
export const OFICIOS_JUGADOR_VALIDOS = new Set([
  "herrero", "carpintero", "ingeniero", "picapedrero", "molinero", "cazador", "cocinero", "curandero", "curtidor", "joyero",
]);

/** ¿el jugador tiene este oficio en alguno de sus 2 slots? */
export function tieneOficio(oficio1: string, oficio2: string, oficio: string): boolean {
  return oficio1 === oficio || oficio2 === oficio;
}

/**
 * PLACEHOLDER de balance: coste en Farycoins de reemplazar un slot YA
 * ocupado (elegir el primer/segundo oficio en un slot vacío sigue siendo
 * gratis). Pedido 2026-08-30 (ronda 3): "reduce el coste a 50 farycoins,
 * primer cambio; si cambia más veces es exponencial el precio sube" — el
 * PRIMER cambio de la cuenta cuesta `PRECIO_BASE_CAMBIO_OFICIO`, cada
 * cambio siguiente DUPLICA el precio del anterior (50, 100, 200, 400...).
 * `cambios` es `Jugador.cambiosOficio` (persistido, nunca baja) ANTES de
 * cobrar este cambio — 0 en el primero.
 */
export const PRECIO_BASE_CAMBIO_OFICIO = 50;
export function precioCambioOficio(cambios: number): number {
  return PRECIO_BASE_CAMBIO_OFICIO * 2 ** Math.max(0, cambios);
}

/**
 * Mesas por nivel de oficio (docs/GDD_Profesiones.md §0, 4 tiers ya
 * diseñados: N1..N4) — pedido 2026-08-30: "nivel 0 tienes mesas nivel 1, a
 * nivel 3 o 4 nivel 2, a nivel 5 o 6 nivel 3, a nivel 8 nivel 4". Se toma el
 * extremo alto de cada rango (más conservador): estos son los
 * `nivelOficioMinimo.nivel` reales que llevan las mesas del catálogo
 * (`interiores/catalogo/elementos.json`), MISMA norma para los 10 oficios.
 */
export const NIVEL_MESA: Record<1 | 2 | 3 | 4, number> = { 1: 1, 2: 4, 3: 6, 4: 8 };

// Nivel máximo real de oficio (UMBRALES_NIVEL ya tiene 10 escalones, ver progresion/nivel.ts).
export const NIVEL_MAX_OFICIO = 10;

/**
 * Bono de velocidad de crafteo por nivel de oficio — pedido 2026-08-30:
 * "poco a poco aumenten velocidad de crafteo... a nivel 10 velocidad al
 * 50%", MISMA norma en los 10 oficios. Lineal entre nivel 1 (0%) y nivel 10
 * (+50%) — solo aplica si `tieneOficio` para ese `receta.oficio` (ver
 * RoomExteriorBase.manejarCrafteoIniciar). Multiplica el factor de energía/
 * inteligencia de siempre, nunca lo sustituye.
 */
export function bonusVelocidadCrafteoPorNivelOficio(nivel: number): number {
  return (0.5 * (Math.max(1, Math.min(NIVEL_MAX_OFICIO, nivel)) - 1)) / (NIVEL_MAX_OFICIO - 1);
}

/**
 * Bono de CANTIDAD entregada al completar un crafteo, por nivel de oficio —
 * mismo pedido: "a nivel 10... cantidad de objeto recibido x2". Lineal entre
 * nivel 1 (+0%, x1) y nivel 10 (+100%, x2). Se congela al INICIAR el
 * crafteo (mismo criterio que `bonusModulosAdyacentes.cantidad` ya
 * congelado en `EstadoCrafteo.bonusCantidad`) para que subir de nivel a
 * mitad de un crafteo en curso no cambie el resultado ya reservado.
 */
export function bonusCantidadCrafteoPorNivelOficio(nivel: number): number {
  return (Math.max(1, Math.min(NIVEL_MAX_OFICIO, nivel)) - 1) / (NIVEL_MAX_OFICIO - 1);
}

// --- Suciedad (docs/GDD_Personaje.md §3.6, pedido 2026-08-30: "que si
// trabajas o haces acciones suba y cuando llegue a niveles altos te cobren
// más los npc de tienda y suelten frases") ---

/** A partir de aquí (0-100) se considera "sucio" para precios/frases de NPC. */
export const UMBRAL_SUCIEDAD_MOLESTO = 60;

/** Recargo sobre el precio de compra a un NPC tendero cuando el jugador va sucio. */
export const RECARGO_TIENDA_SUCIEDAD = 0.25;

/** Cuánto ensucia cada acción de trabajo (crafteo completado, recolección exitosa) — placeholder de balance. */
export const SUCIEDAD_POR_CRAFTEO = 3;
export const SUCIEDAD_POR_RECOLECTAR = 1.5;

/** Ritmo al que se limpia solo nadando/buceando (puntos de suciedad por hora real) — "nadando en el agua durante X tiempo". */
export const RITMO_LIMPIEZA_AGUA_POR_HORA = 40;

/**
 * Frases que suelta el NPC TENDERO al comerciar con un jugador sucio
 * (pedido literal: "de por dios lávate, hueles a perro mojado" + 10-15 más).
 */
export const FRASES_VENDEDOR_SUCIO: string[] = [
  "Por dios, ¡lávate! Hueles a perro mojado.",
  "¿Te has bañado este mes siquiera?",
  "Aléjate un poco, que se me agria la leche.",
  "Con ese olor me espantas a la clientela.",
  "¿Eso que llevas encima es barro o es tu piel?",
  "Como sigas así te voy a cobrar un extra por aguantar el tufo.",
  "¡Puaj! Ve a darte un chapuzón antes de volver por aquí.",
  "No sé si vienes a comprar o a que te entierren.",
  "Hueles peor que el establo del fondo, te lo digo con cariño.",
  "¿Sabes que existe el agua, verdad? Pruébala alguna vez.",
  "Como te acerques más te desmayas tú o me desmayo yo.",
  "Con esa pinta pareces recién salido de una fosa.",
  "Un baño no te mataría, más bien te salvaría la reputación.",
  "Cuidado, que las moscas ya te están siguiendo.",
];

/**
 * Frases que sueltan NPCs cualquiera al pasar cerca de un jugador sucio
 * (pedido literal: 20 frases, "algunas muy ofensivas otras muy graciosas").
 */
export const FRASES_NPC_SUCIO: string[] = [
  "¿Quién ha dejado un queso podrido por aquí?",
  "¡Uf! Creo que se ha muerto algo cerca...",
  "Voy a cambiar de calle, este olor no es normal.",
  "¿Ese eres tú o llevas un cadáver a cuestas?",
  "Con ese tufo espantas hasta a los cuervos.",
  "Alguien debería avisarle que existe el jabón.",
  "Me está entrando dolor de cabeza solo de olerte.",
  "¡Por todos los dioses, tápate o tápame la nariz!",
  "Hasta el cerdo del vecino huele mejor que tú.",
  "¿Te has revolcado en el estiércol a propósito?",
  "Con ese aroma no hace falta espantar a los lobos, ya se van solos.",
  "Deberían cobrarte impuesto por contaminación.",
  "Ay madre, creo que se me han caído las flores del susto.",
  "Perdona, ¿pero tú a qué hueles? A demonio de las cloacas, diría yo.",
  "No te acerques tanto, que aún no he comido.",
  "Se nota que el río te tiene manía.",
  "Con ese olor podrías espantar a un ejército entero.",
  "¿Has pensado en dedicarte a ahuyentar plagas? Se te da genial.",
  "Vaya tufo... ¿eso es sudor, barro o las dos cosas?",
  "Yo de ti buscaría el lago más cercano y no saldría en un rato.",
];
