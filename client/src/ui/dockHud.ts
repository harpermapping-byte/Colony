/**
 * Dock de iconos del HUD (pedido streamer 2026-09-09: "HUD limpia con algún
 * emoticono que abre esa pestaña"). Franja fija abajo-centro, un botón por
 * panel registrado — clic alterna abrir/cerrar ESE panel. Los paneles ya
 * migrados conservan además su tecla de siempre (I, M, Tab...); los paneles
 * nuevos que no tienen tecla propia (decisión streamer 2026-09-09) se abren
 * SOLO desde aquí.
 *
 * No conoce el contenido de ningún panel — solo llama a `alternar()`/
 * `estaAbierto()` sobre lo que `registrar()` le pasa (cualquier
 * `MarcoPanel` de panelBase.ts cumple esta forma sin cambios).
 */

export interface PanelRegistrable {
  alternar(): void;
  estaAbierto(): boolean;
  onCambioEstado(cb: () => void): void;
}

export class DockHud {
  private readonly raiz: HTMLDivElement;
  private readonly botones = new Map<string, HTMLButtonElement>();

  constructor(contenedor: HTMLElement) {
    this.raiz = document.createElement("div");
    this.raiz.className = "dock-hud";
    contenedor.appendChild(this.raiz);
  }

  /** Registra un panel ya construido bajo un id único — crea su icono en el dock. Llamar una vez por panel, al construirlo. */
  registrar(id: string, panel: PanelRegistrable, meta: { icono: string; titulo: string }) {
    if (this.botones.has(id)) {
      console.warn(`DockHud: "${id}" ya estaba registrado`);
      return;
    }
    const boton = document.createElement("button");
    boton.className = "dock-hud-icono";
    boton.textContent = meta.icono;
    boton.title = meta.titulo;
    boton.dataset.abierto = "false";
    boton.onclick = () => panel.alternar();
    this.raiz.appendChild(boton);
    this.botones.set(id, boton);

    panel.onCambioEstado(() => {
      boton.dataset.abierto = String(panel.estaAbierto());
    });
  }

  /** Badge rojo de notificación pendiente (invitación de gremio, novedad en el cofre...) — puramente informativo, no bloquea el uso normal del panel. */
  marcarNotificacion(id: string, activo: boolean) {
    const boton = this.botones.get(id);
    if (!boton) return;
    let badge = boton.querySelector<HTMLSpanElement>(".dock-hud-icono-badge");
    if (activo && !badge) {
      badge = document.createElement("span");
      badge.className = "dock-hud-icono-badge";
      boton.appendChild(badge);
    } else if (!activo && badge) {
      badge.remove();
    }
  }
}
