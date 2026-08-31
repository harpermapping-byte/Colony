/**
 * Menú de interacción genérico por clic sobre un objeto construido
 * (docs/GDD_Instrumentos.md — pedido explícito del streamer: "haces click
 * sobre el objeto en la web y se abre mini pantallita ... con las opciones
 * de interacción, iremos añadiendo aquí para evitar bindear de tanta
 * tecla"). NO es solo para instrumentos: cualquier interacción futura sobre
 * un objeto colocado se cuelga aquí (una entrada más en la lista de
 * opciones) en vez de reservar una tecla nueva — game.ts decide QUÉ
 * opciones ofrecer según el objeto clicado, este módulo solo sabe pintar
 * una lista y devolver el clic. Instancia única, reposicionada y repoblada
 * en cada clic (mismo patrón que los paneles placeholder del proyecto:
 * DOM crudo, sin framework).
 */

export interface OpcionMenuInteraccion {
  etiqueta: string;
  accion(): void;
}

export class MenuInteraccion {
  private readonly raiz: HTMLDivElement;

  constructor() {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "fixed";
    this.raiz.style.zIndex = "50";
    this.raiz.style.background = "rgba(12,12,18,0.94)";
    this.raiz.style.color = "#e8e8f0";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #4a4a5a";
    this.raiz.style.minWidth = "170px";
    this.raiz.style.padding = "4px";
    this.raiz.style.display = "none";
    this.raiz.style.userSelect = "none";
    document.body.appendChild(this.raiz);

    // clic fuera del menú (o cualquier tecla Escape) lo cierra — mismo
    // criterio que un menú contextual normal
    window.addEventListener("mousedown", (e) => {
      if (this.raiz.style.display === "none") return;
      if (e.target instanceof Node && this.raiz.contains(e.target)) return;
      this.ocultar();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.ocultar();
    });
  }

  visible(): boolean {
    return this.raiz.style.display !== "none";
  }

  /**
   * Muestra el menú en coordenadas de PANTALLA (clientX/clientY del clic
   * que lo abrió), con un título (nombre del objeto) y una opción por
   * interacción disponible. Lista vacía = no hay nada que ofrecer = no se
   * muestra nada (el clic no hace ruido si el objeto no es interactivo).
   */
  mostrar(clientX: number, clientY: number, titulo: string, opciones: OpcionMenuInteraccion[]): void {
    if (opciones.length === 0) {
      this.ocultar();
      return;
    }
    this.raiz.innerHTML = "";

    const encabezado = document.createElement("div");
    encabezado.style.fontWeight = "bold";
    encabezado.style.padding = "5px 8px";
    encabezado.style.opacity = "0.85";
    encabezado.style.borderBottom = "1px solid rgba(255,255,255,0.15)";
    encabezado.style.marginBottom = "2px";
    encabezado.textContent = titulo;
    this.raiz.appendChild(encabezado);

    for (const opcion of opciones) {
      const boton = document.createElement("button");
      boton.textContent = opcion.etiqueta;
      boton.style.display = "block";
      boton.style.width = "100%";
      boton.style.textAlign = "left";
      boton.style.padding = "6px 8px";
      boton.style.margin = "1px 0";
      boton.style.background = "transparent";
      boton.style.color = "inherit";
      boton.style.font = "inherit";
      boton.style.border = "none";
      boton.style.borderRadius = "3px";
      boton.style.cursor = "pointer";
      boton.onmouseenter = () => { boton.style.background = "rgba(255,255,255,0.14)"; };
      boton.onmouseleave = () => { boton.style.background = "transparent"; };
      boton.onclick = () => { this.ocultar(); opcion.accion(); };
      this.raiz.appendChild(boton);
    }

    // clamp para que no se salga de la ventana si el clic fue cerca del borde
    const anchoAprox = 190;
    const altoAprox = 40 + opciones.length * 30;
    const left = Math.min(clientX, window.innerWidth - anchoAprox - 8);
    const top = Math.min(clientY, window.innerHeight - altoAprox - 8);
    this.raiz.style.left = `${Math.max(4, left)}px`;
    this.raiz.style.top = `${Math.max(4, top)}px`;
    this.raiz.style.display = "block";
  }

  ocultar(): void {
    this.raiz.style.display = "none";
  }
}
