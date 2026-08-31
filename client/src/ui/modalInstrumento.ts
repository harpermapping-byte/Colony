/**
 * Modal de instrumento musical (docs/GDD_Instrumentos.md, spec literal del
 * streamer): ventana flotante con el nombre del instrumento, un
 * `<input type="text">` para pegar la URL directa de un .mid, y los botones
 * "Tocar" / "Cerrar". El servidor NUNCA convierte nada — "el usuario se
 * encarga de convertirlo [el midi] en alguna página" (pedido explícito) —
 * este modal solo recoge la URL ya convertida y la manda tal cual.
 *
 * Instancia única, reusada por los 4 instrumentos (mismo criterio que
 * MenuInteraccion): se repuebla el título cada vez que se abre.
 */

export interface OpcionesModalInstrumento {
  /** El jugador pulsó "Tocar" con una URL no vacía — el modal ya se cerró solo. */
  tocar(midiUrl: string): void;
}

export class ModalInstrumento {
  private readonly fondo: HTMLDivElement;
  private readonly caja: HTMLDivElement;
  private readonly titulo: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly lineaError: HTMLDivElement;

  constructor(private readonly opciones: OpcionesModalInstrumento) {
    this.fondo = document.createElement("div");
    this.fondo.style.position = "fixed";
    this.fondo.style.inset = "0";
    this.fondo.style.background = "rgba(0,0,0,0.45)";
    this.fondo.style.display = "none";
    this.fondo.style.alignItems = "center";
    this.fondo.style.justifyContent = "center";
    this.fondo.style.zIndex = "60";
    this.fondo.onclick = (e) => { if (e.target === this.fondo) this.ocultar(); };

    this.caja = document.createElement("div");
    this.caja.style.background = "#1c1a22";
    this.caja.style.color = "#eee8f0";
    this.caja.style.font = "13px sans-serif";
    this.caja.style.border = "1px solid #4a4560";
    this.caja.style.borderRadius = "8px";
    this.caja.style.padding = "18px 20px";
    this.caja.style.minWidth = "280px";
    this.caja.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
    this.fondo.appendChild(this.caja);

    this.titulo = document.createElement("div");
    this.titulo.style.fontWeight = "bold";
    this.titulo.style.fontSize = "15px";
    this.titulo.style.marginBottom = "12px";
    this.caja.appendChild(this.titulo);

    const etiquetaInput = document.createElement("div");
    etiquetaInput.textContent = "URL directa del archivo .mid:";
    etiquetaInput.style.opacity = "0.8";
    etiquetaInput.style.marginBottom = "4px";
    this.caja.appendChild(etiquetaInput);

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "https://.../cancion.mid";
    this.input.style.width = "100%";
    this.input.style.boxSizing = "border-box";
    this.input.style.padding = "6px 8px";
    this.input.style.marginBottom = "10px";
    this.input.style.background = "#0f0e14";
    this.input.style.color = "inherit";
    this.input.style.border = "1px solid #4a4560";
    this.input.style.borderRadius = "4px";
    this.input.onkeydown = (e) => { if (e.key === "Enter") this.confirmarTocar(); };
    this.caja.appendChild(this.input);

    this.lineaError = document.createElement("div");
    this.lineaError.style.color = "#e2704a";
    this.lineaError.style.marginBottom = "8px";
    this.lineaError.style.display = "none";
    this.caja.appendChild(this.lineaError);

    const filaBotones = document.createElement("div");
    filaBotones.style.display = "flex";
    filaBotones.style.gap = "8px";
    filaBotones.style.justifyContent = "flex-end";
    const btnCancelar = document.createElement("button");
    btnCancelar.textContent = "Cerrar";
    btnCancelar.onclick = () => this.ocultar();
    filaBotones.appendChild(btnCancelar);
    const btnTocar = document.createElement("button");
    btnTocar.textContent = "Tocar";
    btnTocar.onclick = () => this.confirmarTocar();
    filaBotones.appendChild(btnTocar);
    this.caja.appendChild(filaBotones);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.visible()) this.ocultar();
    });

    document.body.appendChild(this.fondo);
  }

  visible(): boolean {
    return this.fondo.style.display !== "none";
  }

  mostrar(nombreInstrumento: string): void {
    this.titulo.textContent = nombreInstrumento;
    this.input.value = "";
    this.lineaError.style.display = "none";
    this.fondo.style.display = "flex";
    this.input.focus();
  }

  ocultar(): void {
    this.fondo.style.display = "none";
  }

  /** Error al intentar reproducir (fetch/parseo fallido, o rechazo del servidor) — reabre con el mensaje sin perder la URL escrita. */
  mostrarError(motivo: string): void {
    this.lineaError.textContent = motivo;
    this.lineaError.style.display = "block";
    this.fondo.style.display = "flex";
  }

  private confirmarTocar(): void {
    const url = this.input.value.trim();
    if (!url) {
      this.mostrarError("Pega antes una URL de .mid.");
      return;
    }
    this.ocultar(); // spec literal: al pulsar Tocar, la ventana modal se cierra
    this.opciones.tocar(url);
  }
}
