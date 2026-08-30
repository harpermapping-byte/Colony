/**
 * Panel de anatomía/médico — PLACEHOLDER de testeo (docs/GDD_Anatomia.md,
 * mismo criterio de placeholder que panelCocina.ts/panelCombate.ts). Muestra
 * el estado de las 6 zonas del jugador LOCAL en todo momento; vendar/
 * entablillar son autocuidado (un botón por zona sangrando/fracturada,
 * sobre uno mismo); cirugía/prótesis son de oficio curandero, con inputs
 * crudos de sessionId/zona (sin picker de jugador cercano todavía).
 */

export type Zona = "cabeza" | "torso" | "brazoIzq" | "brazoDer" | "piernaIzq" | "piernaDer";
export const ZONAS: readonly Zona[] = ["cabeza", "torso", "brazoIzq", "brazoDer", "piernaIzq", "piernaDer"];

export interface EstadoZonaVista {
  sangrado: boolean;
  fractura: boolean;
  infectado: boolean;
  amputado: boolean;
  protesis: boolean;
  curando: boolean;
}

export interface OpcionesPanelMedico {
  contenedor: HTMLElement;
  vendar(zona: Zona, conUnguento: boolean): void;
  entablillar(zona: Zona): void;
  cirugia(targetSessionId: string): void;
  protesis(targetSessionId: string, zona: Zona): void;
}

const NOMBRE_ZONA: Record<Zona, string> = {
  cabeza: "Cabeza", torso: "Torso", brazoIzq: "Brazo izq.", brazoDer: "Brazo der.",
  piernaIzq: "Pierna izq.", piernaDer: "Pierna der.",
};

export class PanelMedico {
  private raiz: HTMLDivElement;
  private estado: Record<Zona, EstadoZonaVista> | null = null;

  constructor(private opciones: OpcionesPanelMedico) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "16px";
    this.raiz.style.bottom = "180px";
    this.raiz.style.background = "rgba(20,10,10,0.88)";
    this.raiz.style.color = "#f0d8d8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a3a3a";
    this.raiz.style.minWidth = "220px";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  actualizarEstado(estado: Record<Zona, EstadoZonaVista>) {
    this.estado = estado;
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🩹 Anatomía";
    this.raiz.appendChild(titulo);

    if (this.estado) {
      for (const zona of ZONAS) {
        const z = this.estado[zona];
        const marcas: string[] = [];
        if (z.sangrado) marcas.push("sangrando");
        if (z.fractura) marcas.push("fractura");
        if (z.infectado) marcas.push("infectada");
        if (z.amputado) marcas.push(z.protesis ? "amputada+prótesis" : "AMPUTADA");
        if (z.curando) marcas.push("curándose");
        if (marcas.length === 0) continue;

        const fila = document.createElement("div");
        fila.style.marginBottom = "4px";
        fila.textContent = `${NOMBRE_ZONA[zona]}: ${marcas.join(", ")}`;
        this.raiz.appendChild(fila);

        if (z.sangrado) {
          const btn = document.createElement("button");
          btn.textContent = "Vendar";
          btn.style.marginRight = "4px";
          btn.onclick = () => this.opciones.vendar(zona, false);
          fila.appendChild(btn);
          const btnUng = document.createElement("button");
          btnUng.textContent = "Vendar+ungüento";
          btnUng.onclick = () => this.opciones.vendar(zona, true);
          fila.appendChild(btnUng);
        }
        if (z.fractura) {
          const btn = document.createElement("button");
          btn.textContent = "Entablillar";
          btn.onclick = () => this.opciones.entablillar(zona);
          fila.appendChild(btn);
        }
      }
      if (ZONAS.every((z) => {
        const est = this.estado![z];
        return !est.sangrado && !est.fractura && !est.infectado && !est.amputado && !est.curando;
      })) {
        const sano = document.createElement("div");
        sano.style.opacity = "0.7";
        sano.textContent = "(sin heridas)";
        this.raiz.appendChild(sano);
      }
    }

    // Cirugía/prótesis (oficio curandero) — inputs crudos, mismo criterio placeholder que panelCocina.ts.
    const separador = document.createElement("div");
    separador.style.marginTop = "8px";
    separador.style.paddingTop = "6px";
    separador.style.borderTop = "1px solid #6a3a3a";
    separador.style.fontSize = "11px";
    separador.style.opacity = "0.8";
    separador.textContent = "Curandero (junto a mesa + instrumental/cama):";
    this.raiz.appendChild(separador);

    const inputTarget = document.createElement("input");
    inputTarget.placeholder = "sessionId paciente";
    inputTarget.style.width = "100%";
    inputTarget.style.margin = "4px 0";
    this.raiz.appendChild(inputTarget);

    const filaCirugia = document.createElement("div");
    const btnCirugia = document.createElement("button");
    btnCirugia.textContent = "Operar (cirugía)";
    btnCirugia.onclick = () => { if (inputTarget.value) this.opciones.cirugia(inputTarget.value); };
    filaCirugia.appendChild(btnCirugia);
    this.raiz.appendChild(filaCirugia);

    const filaProtesis = document.createElement("div");
    filaProtesis.style.marginTop = "4px";
    const selectZona = document.createElement("select");
    for (const z of ZONAS) {
      const opt = document.createElement("option");
      opt.value = z;
      opt.textContent = NOMBRE_ZONA[z];
      selectZona.appendChild(opt);
    }
    filaProtesis.appendChild(selectZona);
    const btnProtesis = document.createElement("button");
    btnProtesis.textContent = "Instalar prótesis";
    btnProtesis.onclick = () => { if (inputTarget.value) this.opciones.protesis(inputTarget.value, selectZona.value as Zona); };
    filaProtesis.appendChild(btnProtesis);
    this.raiz.appendChild(filaProtesis);
  }
}
