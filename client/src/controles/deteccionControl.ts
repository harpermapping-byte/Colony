/**
 * Detección de controles táctiles (pedido streamer: "¿sería factible hacer
 * controles para la versión web para poder jugar desde el móvil?").
 *
 * Detectar "esto es un móvil" por ANCHO DE PANTALLA es frágil en las dos
 * direcciones: una tablet grande mide como un portátil pequeño, y una
 * ventana de escritorio redimensionada mide como un móvil. El criterio real
 * — y el que usa cualquier sitio responsive moderno — es de qué tipo es el
 * PUNTERO PRINCIPAL del dispositivo: `matchMedia("(pointer: coarse)")` es
 * `true` cuando el input primario es un dedo (impreciso, "grueso") y `false`
 * cuando es un ratón/trackpad (preciso). Con eso solo, un PC de escritorio
 * con ratón NUNCA ve los controles táctiles (aunque se achique la ventana o
 * se abra en un monitor pequeño) y un móvil/tablet real SIEMPRE los ve, sin
 * ninguna lista de user-agents ni de anchos "mágicos" que mantener.
 *
 * Override manual en Ajustes (auto/siempre/nunca, mismo patrón de
 * localStorage que `configAjustes.ts`) para los casos raros que la detección
 * sola no puede acertar — una tablet con teclado+ratón Bluetooth conectados
 * a la vez, o simplemente querer probar los controles táctiles en un PC.
 */

export type ModoControlesTactiles = "auto" | "siempre" | "nunca";

const CLAVE_MODO = "ajustesControlesTactiles";

export function obtenerModoControlesGuardado(): ModoControlesTactiles {
  const crudo = localStorage.getItem(CLAVE_MODO);
  return crudo === "siempre" || crudo === "nunca" ? crudo : "auto";
}

export function guardarModoControles(modo: ModoControlesTactiles): void {
  try {
    localStorage.setItem(CLAVE_MODO, modo);
  } catch {
    // localStorage puede fallar (modo privado, cuota) — el ajuste solo dura esta sesión, ver mismo comentario en configAjustes.ts
  }
  for (const cb of suscriptores) cb();
}

/** ¿El dispositivo real tiene un dedo como puntero principal? Sin `matchMedia` (entorno de test) se asume que no. */
export function esPunteroTactilReal(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** Lógica pura, testeable sin DOM: decide si los controles deben mostrarse dado el modo guardado y si el dispositivo real es táctil. */
export function resolverControlesActivos(modo: ModoControlesTactiles, esTactilReal: boolean): boolean {
  if (modo === "siempre") return true;
  if (modo === "nunca") return false;
  return esTactilReal;
}

export function controlesTactilesActivos(): boolean {
  return resolverControlesActivos(obtenerModoControlesGuardado(), esPunteroTactilReal());
}

const suscriptores: (() => void)[] = [];

/** Avisa cuando cambia algo que puede alterar `controlesTactilesActivos()` — el override guardado en Ajustes, o el propio hardware (un ratón/mando Bluetooth que se conecta o desconecta). */
export function onCambioControlesTactiles(cb: () => void): void {
  suscriptores.push(cb);
}

if (typeof matchMedia === "function") {
  matchMedia("(pointer: coarse)").addEventListener?.("change", () => {
    for (const cb of suscriptores) cb();
  });
}
