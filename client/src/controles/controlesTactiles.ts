/**
 * Controles táctiles para jugar desde el navegador de un móvil/tablet
 * (pedido streamer: "¿sería factible hacer controles para la versión web
 * para poder jugar desde el móvil?"). Ver `deteccionControl.ts` para el
 * criterio de cuándo se muestran.
 *
 * Integración de BAJO RIESGO, mismo espíritu que `configTeclas.ts` (que ya
 * resolvió el mismo problema para el teclado): en vez de reescribir el
 * switch gigante de `game.ts::keydown` (~25 comparaciones ya probadas) o
 * exponer su `Set<string> teclas` privado, este módulo DISPARA los mismos
 * `KeyboardEvent` reales que produciría un teclado físico, sobre `window` —
 * el listener de siempre los procesa exactamente igual, sin distinguir su
 * origen. Dos modos de uso:
 * - `establecerTeclaMantenida(tecla, activa)`: para el joystick (movimiento
 *   continuo, WASD/Shift) — dispara "keydown" una vez al activarse y
 *   "keyup" una vez al soltar, igual que mantener pulsada una tecla real.
 * - `dispararTecla(tecla)`: para los botones de una sola acción (atacar,
 *   interactuar...) — "keydown"+"keyup" seguidos, igual que un toque rápido.
 *
 * El joystick es FIJO (no "flotante" bajo el primer toque) — más simple de
 * implementar bien y suficiente para un control de 8 direcciones que ya no
 * necesita más precisión que WASD. Se lee por EJES con zona muerta, nunca
 * velocidad analógica real (el juego no la tiene — cada tecla es binaria),
 * salvo la magnitud del arrastre para decidir "correr" (Shift), que
 * reemplaza tener que buscar hueco para un botón de correr aparte.
 */
import { crearMarcoPanel, crearBoton } from "../ui/panelBase";
import { ACCIONES_REASIGNABLES, obtenerTeclaAsignada } from "../ajustes/configTeclas";

/** Acciones de depuración de la Test Zone — no tienen sitio en un control pensado para jugar de verdad. */
const IDS_EXCLUIDOS_DEBUG = new Set(["cofrePrueba", "panelDebugAdmin"]);

/** Radio máximo de recorrido del nudo del joystick, en píxeles — el resto del layout (tamaño de la base) vive en CSS. */
const RADIO_MAXIMO_NUDO = 42;
/** Por debajo de esta fracción del radio máximo, ninguna dirección cuenta como pulsada (evita "temblor" cerca del centro). */
const UMBRAL_ZONA_MUERTA = 0.2;
/** Por encima de esta fracción del radio máximo, además de la dirección se activa "correr" (Shift) — empujar más a fondo el joystick para correr. */
const UMBRAL_CORRER = 0.72;
/** Componente de eje (normalizado 0..1) a partir del cual ESE eje cuenta como pulsado — dos ejes a la vez dan diagonal, igual que W+D en teclado. */
const UMBRAL_EJE = 0.35;

function dispararTecla(tecla: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: tecla }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: tecla }));
}

export interface OpcionesControlesTactiles {
  contenedor: HTMLElement;
}

export class ControlesTactiles {
  private readonly raiz: HTMLDivElement;
  private readonly nudo: HTMLDivElement;
  private readonly panelMas;

  /** Teclas de movimiento/correr que el joystick tiene "mantenidas" ahora mismo — solo dispara keydown/keyup en los CAMBIOS, igual que un teclado real. */
  private readonly teclasMantenidas = new Set<string>();
  private punteroActivoId: number | null = null;

  constructor(opciones: OpcionesControlesTactiles) {
    this.raiz = document.createElement("div");
    this.raiz.className = "controles-tactiles";
    this.raiz.dataset.testid = "controles-tactiles-raiz";
    this.raiz.style.display = "none"; // arranca oculto — game.ts decide cuándo mostrarlo según deteccionControl.ts
    opciones.contenedor.appendChild(this.raiz);

    // --- Joystick (bottom-left) ---
    const base = document.createElement("div");
    base.className = "controles-tactiles-joystick-base";
    base.dataset.testid = "controles-tactiles-joystick";
    this.nudo = document.createElement("div");
    this.nudo.className = "controles-tactiles-joystick-nudo";
    base.appendChild(this.nudo);
    this.raiz.appendChild(base);

    base.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.punteroActivoId = e.pointerId;
      this.actualizarJoystick(e.clientX, e.clientY, base);
    });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.punteroActivoId) return;
      this.actualizarJoystick(e.clientX, e.clientY, base);
    });
    const soltar = (e: PointerEvent) => {
      if (e.pointerId !== this.punteroActivoId) return;
      this.punteroActivoId = null;
      this.nudo.style.transform = "translate(0, 0)";
      for (const tecla of [...this.teclasMantenidas]) this.establecerTeclaMantenida(tecla, false);
    };
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);

    // --- Acciones rápidas (bottom-right) ---
    const acciones = document.createElement("div");
    acciones.className = "controles-tactiles-acciones";
    const accionAtacar = ACCIONES_REASIGNABLES.find((a) => a.id === "atacar")!;
    const accionInteractuar = ACCIONES_REASIGNABLES.find((a) => a.id === "interactuarPuerta")!;
    acciones.appendChild(this.crearBotonAccion("⚔️", accionAtacar.etiqueta, () => dispararTecla(obtenerTeclaAsignada(accionAtacar.id))));
    acciones.appendChild(this.crearBotonAccion("✋", accionInteractuar.etiqueta, () => dispararTecla(obtenerTeclaAsignada(accionInteractuar.id))));
    const botonMas = this.crearBotonAccion("☰", "Más acciones", () => this.panelMas.alternar());
    botonMas.dataset.testid = "controles-tactiles-mas";
    acciones.appendChild(botonMas);
    this.raiz.appendChild(acciones);

    // --- Panel "más acciones": el resto del catálogo reasignable, ninguna hace falta memorizar ---
    this.panelMas = crearMarcoPanel({ contenedor: this.raiz, titulo: "Acciones", icono: "🎮", ancho: "240px", left: "50%", top: "50%" });
    this.panelMas.raiz.style.transform = "translate(-50%, -50%)";
    this.panelMas.raiz.style.maxHeight = "70vh";
    this.panelMas.raiz.style.overflowY = "auto";
    for (const accion of ACCIONES_REASIGNABLES) {
      if (IDS_EXCLUIDOS_DEBUG.has(accion.id)) continue;
      const boton = crearBoton(accion.etiqueta, () => dispararTecla(obtenerTeclaAsignada(accion.id)));
      boton.style.display = "block";
      boton.style.width = "100%";
      boton.style.marginBottom = "4px";
      boton.style.textAlign = "left";
      this.panelMas.cuerpo.appendChild(boton);
    }
  }

  /** Muestra u oculta el overlay entero — llamar desde `deteccionControl.ts::onCambioControlesTactiles`. */
  actualizarVisibilidad(activo: boolean): void {
    this.raiz.style.display = activo ? "block" : "none";
    if (!activo) {
      // soltar cualquier tecla que se hubiera quedado mantenida a media pulsación
      for (const tecla of [...this.teclasMantenidas]) this.establecerTeclaMantenida(tecla, false);
      this.nudo.style.transform = "translate(0, 0)";
      this.punteroActivoId = null;
    }
  }

  private crearBotonAccion(icono: string, titulo: string, onPulsar: () => void): HTMLButtonElement {
    const boton = document.createElement("button");
    boton.className = "controles-tactiles-boton";
    boton.textContent = icono;
    boton.title = titulo;
    // "pointerdown" en vez de "click": respuesta inmediata sin esperar al
    // evento de clic sintetizado por el navegador tras el toque — mismo
    // criterio que el joystick, que también reacciona a pointerdown.
    boton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onPulsar();
    });
    return boton;
  }

  private establecerTeclaMantenida(tecla: string, activa: boolean): void {
    const yaActiva = this.teclasMantenidas.has(tecla);
    if (activa === yaActiva) return;
    if (activa) {
      this.teclasMantenidas.add(tecla);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: tecla }));
    } else {
      this.teclasMantenidas.delete(tecla);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: tecla }));
    }
  }

  private actualizarJoystick(clientX: number, clientY: number, base: HTMLDivElement): void {
    const rect = base.getBoundingClientRect();
    const centroX = rect.left + rect.width / 2;
    const centroY = rect.top + rect.height / 2;
    const dx = clientX - centroX;
    const dy = clientY - centroY;
    const distancia = Math.hypot(dx, dy);
    const distanciaRecortada = Math.min(distancia, RADIO_MAXIMO_NUDO);
    const angulo = Math.atan2(dy, dx);
    const nudoX = Math.cos(angulo) * distanciaRecortada;
    const nudoY = Math.sin(angulo) * distanciaRecortada;
    this.nudo.style.transform = `translate(${nudoX}px, ${nudoY}px)`;

    const magnitud = distanciaRecortada / RADIO_MAXIMO_NUDO;
    if (magnitud < UMBRAL_ZONA_MUERTA) {
      this.establecerTeclaMantenida("d", false);
      this.establecerTeclaMantenida("a", false);
      this.establecerTeclaMantenida("s", false);
      this.establecerTeclaMantenida("w", false);
      this.establecerTeclaMantenida("shift", false);
      return;
    }
    const ejeX = distancia > 0 ? dx / distancia : 0;
    const ejeY = distancia > 0 ? dy / distancia : 0;
    this.establecerTeclaMantenida("d", ejeX > UMBRAL_EJE);
    this.establecerTeclaMantenida("a", ejeX < -UMBRAL_EJE);
    this.establecerTeclaMantenida("s", ejeY > UMBRAL_EJE);
    this.establecerTeclaMantenida("w", ejeY < -UMBRAL_EJE);
    this.establecerTeclaMantenida("shift", magnitud > UMBRAL_CORRER);
  }
}
