/**
 * Panel de injertos — PLACEHOLDER de testeo (docs/GDD_Agricultura.md §4,
 * mismo criterio de placeholder que el resto de esta pasada). Aparece
 * solo al acercarse a una `mesa_injertos`. Combina dos semillas por id de
 * instancia (sin rejilla arrastrable todavía, fase 3 de inventario).
 */

export interface OpcionesPanelInjerto {
  contenedor: HTMLElement;
  crear(construccionId: number, instanciaIdA: number, instanciaIdB: number): void;
}

export class PanelInjerto {
  private raiz: HTMLDivElement;
  private construccionId: number | null = null;

  constructor(private opciones: OpcionesPanelInjerto) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.right = "16px";
    this.raiz.style.bottom = "90px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  /** null cuando el jugador ya no está junto a ninguna mesa de injertos. */
  actualizar(construccionId: number | null) {
    this.construccionId = construccionId;
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";
    if (this.construccionId == null) {
      this.raiz.hidden = true;
      return;
    }
    this.raiz.hidden = false;
    const id = this.construccionId;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🧬 Mesa de injertos";
    this.raiz.appendChild(titulo);

    const ayuda = document.createElement("div");
    ayuda.style.fontSize = "11px";
    ayuda.style.opacity = "0.8";
    ayuda.style.marginBottom = "6px";
    ayuda.textContent = "Combina dos semillas cualesquiera en una especie nueva.";
    this.raiz.appendChild(ayuda);

    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.gap = "6px";
    const inputA = document.createElement("input");
    inputA.type = "number";
    inputA.placeholder = "semilla A";
    inputA.style.width = "80px";
    const inputB = document.createElement("input");
    inputB.type = "number";
    inputB.placeholder = "semilla B";
    inputB.style.width = "80px";
    fila.appendChild(inputA);
    fila.appendChild(inputB);
    const boton = document.createElement("button");
    boton.textContent = "Injertar";
    boton.onclick = () => {
      const a = Number(inputA.value);
      const b = Number(inputB.value);
      if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) this.opciones.crear(id, a, b);
      inputA.value = "";
      inputB.value = "";
    };
    fila.appendChild(boton);
    this.raiz.appendChild(fila);
  }
}
