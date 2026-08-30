/**
 * Panel de pesca — PLACEHOLDER de testeo (docs/GDD_Pesca.md, mismo criterio
 * ya pactado para combate/mascotas/comercio: "placeholder sencillo, la UI
 * final se hace al final del proyecto"). Solo un estado de texto + botón de
 * cancelar; la boya de verdad se ve en el mundo 3D (ver game.ts).
 */

export type EstadoPescaVista = "esperando" | "picando" | null;

export interface OpcionesPanelPesca {
  contenedor: HTMLElement;
  cancelar(): void;
}

export class PanelPesca {
  private raiz: HTMLDivElement;
  private estado: EstadoPescaVista = null;

  constructor(private opciones: OpcionesPanelPesca) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.bottom = "90px";
    this.raiz.style.transform = "translateX(-50%)";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "8px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.display = "flex";
    this.raiz.style.alignItems = "center";
    this.raiz.style.gap = "10px";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  actualizar(estado: EstadoPescaVista) {
    this.estado = estado;
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";
    if (!this.estado) {
      this.raiz.hidden = true;
      return;
    }
    this.raiz.hidden = false;

    const texto = document.createElement("span");
    texto.textContent = this.estado === "picando" ? "🐟 ¡Pica! Pulsa U" : "🎣 Pescando... esperando una picada";
    this.raiz.appendChild(texto);

    const cancelar = document.createElement("button");
    cancelar.textContent = "Cancelar";
    cancelar.onclick = () => this.opciones.cancelar();
    this.raiz.appendChild(cancelar);
  }
}
