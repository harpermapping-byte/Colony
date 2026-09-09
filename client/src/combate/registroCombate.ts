/**
 * Registro flotante de eventos de combate (pedido streamer 2026-09-09:
 * "cuando mueres no sale [texto de] resultado herido") — panelCombate.ts es
 * un placeholder de testeo que solo repinta números de HP en cada patch;
 * nunca hubo ningún mensaje discreto de "le has dado X de daño"/"has
 * recibido un golpe"/"has caído". Este módulo es independiente del panel a
 * propósito: `panelCombate.renderizar()` borra `innerHTML` entero en CADA
 * cambio de estado (onStateChange dispara con cualquier patch, no solo de
 * combate), así que un log seguido ahí se autodestruiría constantemente —
 * un overlay aparte con su propio DOM persistente evita ese problema sin
 * tocar el panel existente.
 *
 * También recoge `combate:error`/`combate:armaRota`, que hasta ahora solo
 * se logueaban en consola del navegador (nunca visibles jugando).
 *
 * Paleta madera/pergamino (pedido streamer 2026-09-09: "TODA pantalla que
 * salga... debe salir así con esta estética") — son toasts efímeros que
 * aparecen y desaparecen solos, así que NO llevan `crearMarcoPanel` (no
 * encaja un marco persistente con X en algo que se autodestruye); solo se
 * retoca la paleta de color/fuente/borde de cada línea a las variables de
 * temaPaneles.css. Se conserva la distinción visual por tipo (crítica para
 * leer un combate de un vistazo: "he dado daño" vs "he caído") reusando los
 * dos tonos que YA existen en el tema para eso — `--panel-acento` (dorado,
 * el mismo que ya marca énfasis en cabeceras/bordes de panel) y
 * `--error-color` (el mismo rojo que ya usa `.panel-colony-error`) — en vez
 * de inventar hex nuevos ajenos al tema.
 */

const DURACION_MS = 4500;
const MAX_VISIBLES = 4;

const COLOR_POR_TIPO: Record<string, string> = {
  danoHecho: "var(--panel-acento)",
  danoRecibido: "var(--panel-texto)",
  muerte: "var(--error-color)",
  error: "var(--error-color)",
  info: "var(--panel-texto-tenue)",
};

export class RegistroCombate {
  private readonly raiz: HTMLDivElement;

  constructor(contenedor: HTMLElement) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.bottom = "140px"; // por encima del panel de acciones (panelCombate.ts, bottom:16px + su propia altura)
    this.raiz.style.transform = "translateX(-50%)";
    this.raiz.style.display = "flex";
    this.raiz.style.flexDirection = "column";
    this.raiz.style.gap = "4px";
    this.raiz.style.pointerEvents = "none";
    this.raiz.style.alignItems = "center";
    contenedor.appendChild(this.raiz);
  }

  /** Añade una línea que se desvanece sola — nunca más de MAX_VISIBLES a la vez (las más viejas se quitan antes de tiempo si hace falta sitio). */
  mostrar(texto: string, tipo: keyof typeof COLOR_POR_TIPO = "info"): void {
    while (this.raiz.children.length >= MAX_VISIBLES) this.raiz.removeChild(this.raiz.firstChild!);
    const linea = document.createElement("div");
    linea.textContent = texto;
    linea.style.background = "var(--panel-bg-cabecera)";
    linea.style.color = COLOR_POR_TIPO[tipo] ?? COLOR_POR_TIPO.info;
    linea.style.font = "var(--panel-fuente)";
    linea.style.padding = "5px 10px";
    linea.style.borderRadius = "4px";
    linea.style.border = "1px solid var(--panel-borde-tallado)";
    linea.style.whiteSpace = "nowrap";
    linea.style.transition = "opacity 0.6s linear";
    this.raiz.appendChild(linea);
    setTimeout(() => {
      linea.style.opacity = "0";
      setTimeout(() => linea.remove(), 650);
    }, DURACION_MS);
  }
}
