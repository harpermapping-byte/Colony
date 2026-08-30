/**
 * Panel de agricultura — PLACEHOLDER de testeo (docs/GDD_Agricultura.md,
 * mismo criterio ya pactado para combate/mascotas/comercio/pesca:
 * "placeholder sencillo, la UI final se hace al final del proyecto").
 * Se muestra solo cuando el jugador está junto a un bancal/maceta
 * (`RenderConstrucciones.plantableMasCercana`, ver game.ts).
 */

export interface EstadoCultivoVista {
  construccionId: number;
  semillaId: string | null;
  itemIdCosecha: string | null;
  agua: number;
  fertilizante: number;
  diasParaCosecha: number | null;
  listo: boolean;
}

export interface OpcionesPanelCultivo {
  contenedor: HTMLElement;
  plantar(construccionId: number, instanciaId: number): void;
  regar(construccionId: number): void;
  abonar(construccionId: number): void;
  cosechar(construccionId: number): void;
}

export class PanelCultivo {
  private raiz: HTMLDivElement;
  private estado: EstadoCultivoVista | null = null;

  constructor(private opciones: OpcionesPanelCultivo) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "16px";
    this.raiz.style.bottom = "90px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "220px";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  /** Llamar con null cuando el jugador ya no está junto a ningún bancal/maceta. */
  actualizar(estado: EstadoCultivoVista | null) {
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
    const e = this.estado;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🌱 Bancal/maceta";
    this.raiz.appendChild(titulo);

    if (!e.semillaId) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.8";
      vacio.style.marginBottom = "6px";
      vacio.textContent = "Vacío — planta una semilla.";
      this.raiz.appendChild(vacio);

      const filaPlantar = document.createElement("div");
      filaPlantar.style.display = "flex";
      filaPlantar.style.gap = "6px";
      const input = document.createElement("input");
      input.type = "number";
      input.placeholder = "id semilla";
      input.style.width = "90px";
      filaPlantar.appendChild(input);
      const plantar = document.createElement("button");
      plantar.textContent = "Plantar";
      plantar.onclick = () => {
        const id = Number(input.value);
        if (Number.isFinite(id) && id > 0) this.opciones.plantar(e.construccionId, id);
        input.value = "";
      };
      filaPlantar.appendChild(plantar);
      this.raiz.appendChild(filaPlantar);
      return;
    }

    const info = document.createElement("div");
    info.style.marginBottom = "6px";
    info.textContent = `${e.itemIdCosecha ?? "?"} — 💧${Math.round(e.agua)} 🌿${Math.round(e.fertilizante)}${e.listo ? " — ¡listo!" : e.diasParaCosecha != null ? ` — ${e.diasParaCosecha}d` : ""}`;
    this.raiz.appendChild(info);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "6px";

    const regar = document.createElement("button");
    regar.textContent = "Regar";
    regar.onclick = () => this.opciones.regar(e.construccionId);
    botones.appendChild(regar);

    const abonar = document.createElement("button");
    abonar.textContent = "Abonar";
    abonar.onclick = () => this.opciones.abonar(e.construccionId);
    botones.appendChild(abonar);

    const cosechar = document.createElement("button");
    cosechar.textContent = "Cosechar";
    cosechar.disabled = !e.listo;
    cosechar.onclick = () => this.opciones.cosechar(e.construccionId);
    botones.appendChild(cosechar);

    this.raiz.appendChild(botones);
  }
}
