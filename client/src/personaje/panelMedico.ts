/**
 * Panel de anatomía/médico — PLACEHOLDER de testeo (docs/GDD_Anatomia.md,
 * mismo criterio de placeholder que panelCocina.ts/panelCombate.ts). Muestra
 * el estado de las 6 zonas del jugador LOCAL en todo momento; vendar/
 * entablillar son autocuidado (un botón por zona sangrando/fracturada,
 * sobre uno mismo); cirugía/prótesis son de oficio curandero, con inputs
 * crudos de sessionId/zona (sin picker de jugador cercano todavía).
 */
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

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

/** docs/GDD_Enfermedades.md (pedido 2026-08-30) — catarro/gripe, condición GLOBAL del jugador, no por zona. */
export interface EstadoEnfermedadesVista {
  catarro: boolean;
  unguentosTomados: number;
  gripe: boolean;
}

export interface OpcionesPanelMedico {
  contenedor: HTMLElement;
  vendar(zona: Zona, conUnguento: boolean): void;
  entablillar(zona: Zona): void;
  cirugia(targetSessionId: string): void;
  protesis(targetSessionId: string, zona: Zona): void;
  tomarUnguento(): void;
  tomarJarabe(): void;
}

const NOMBRE_ZONA: Record<Zona, string> = {
  cabeza: "Cabeza", torso: "Torso", brazoIzq: "Brazo izq.", brazoDer: "Brazo der.",
  piernaIzq: "Pierna izq.", piernaDer: "Pierna der.",
};

export class PanelMedico {
  private readonly marco: MarcoPanel;
  private estado: Record<Zona, EstadoZonaVista> | null = null;
  private enfermedades: EstadoEnfermedadesVista | null = null;

  constructor(private opciones: OpcionesPanelMedico) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Anatomía", icono: "🩹", left: "16px" });
    // Esquina inferior-izquierda, misma zona que ocupaba antes de migrar.
    this.marco.raiz.style.top = "auto";
    this.marco.raiz.style.bottom = "180px";
    this.render();
  }

  alternar() {
    this.marco.alternar();
  }

  estaAbierto() {
    return this.marco.estaAbierto();
  }

  onCambioEstado(cb: () => void) {
    this.marco.onCambioEstado(cb);
  }

  actualizarEstado(estado: Record<Zona, EstadoZonaVista>) {
    this.estado = estado;
    this.render();
  }

  actualizarEnfermedades(enfermedades: EstadoEnfermedadesVista) {
    this.enfermedades = enfermedades;
    this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

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
        cuerpo.appendChild(fila);

        if (z.sangrado) {
          const btn = document.createElement("button");
          btn.className = "panel-colony-boton";
          btn.textContent = "Vendar";
          btn.style.marginRight = "4px";
          btn.onclick = () => this.opciones.vendar(zona, false);
          fila.appendChild(btn);
          const btnUng = document.createElement("button");
          btnUng.className = "panel-colony-boton";
          btnUng.textContent = "Vendar+ungüento";
          btnUng.onclick = () => this.opciones.vendar(zona, true);
          fila.appendChild(btnUng);
        }
        if (z.fractura) {
          const btn = document.createElement("button");
          btn.className = "panel-colony-boton";
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
        cuerpo.appendChild(sano);
      }
    }

    // Enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30) — catarro
    // (por herida infectada, tose) y gripe (por frío en invierno, tirita y
    // va un 50% más lento), self-service igual que vendar/entablillar.
    if (this.enfermedades && (this.enfermedades.catarro || this.enfermedades.gripe)) {
      const separadorEnf = document.createElement("div");
      separadorEnf.style.marginTop = "8px";
      separadorEnf.style.paddingTop = "6px";
      separadorEnf.style.borderTop = "1px solid #6a3a3a";
      cuerpo.appendChild(separadorEnf);

      if (this.enfermedades.catarro) {
        const filaCatarro = document.createElement("div");
        filaCatarro.style.marginBottom = "4px";
        filaCatarro.textContent = `🤧 Catarro (ungüentos: ${this.enfermedades.unguentosTomados}/4) `;
        const btnUnguento = document.createElement("button");
        btnUnguento.className = "panel-colony-boton";
        btnUnguento.textContent = "Tomar ungüento";
        btnUnguento.onclick = () => this.opciones.tomarUnguento();
        filaCatarro.appendChild(btnUnguento);
        cuerpo.appendChild(filaCatarro);
      }
      if (this.enfermedades.gripe) {
        const filaGripe = document.createElement("div");
        filaGripe.style.marginBottom = "4px";
        filaGripe.textContent = "🥶 Gripe (-50% velocidad) ";
        const btnJarabe = document.createElement("button");
        btnJarabe.className = "panel-colony-boton";
        btnJarabe.textContent = "Tomar jarabe";
        btnJarabe.onclick = () => this.opciones.tomarJarabe();
        filaGripe.appendChild(btnJarabe);
        cuerpo.appendChild(filaGripe);
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
    cuerpo.appendChild(separador);

    const inputTarget = document.createElement("input");
    inputTarget.className = "panel-colony-input";
    inputTarget.placeholder = "sessionId paciente";
    inputTarget.style.width = "100%";
    inputTarget.style.margin = "4px 0";
    cuerpo.appendChild(inputTarget);

    const filaCirugia = document.createElement("div");
    const btnCirugia = document.createElement("button");
    btnCirugia.className = "panel-colony-boton";
    btnCirugia.textContent = "Operar (cirugía)";
    btnCirugia.onclick = () => { if (inputTarget.value) this.opciones.cirugia(inputTarget.value); };
    filaCirugia.appendChild(btnCirugia);
    cuerpo.appendChild(filaCirugia);

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
    btnProtesis.className = "panel-colony-boton";
    btnProtesis.textContent = "Instalar prótesis";
    btnProtesis.onclick = () => { if (inputTarget.value) this.opciones.protesis(inputTarget.value, selectZona.value as Zona); };
    filaProtesis.appendChild(btnProtesis);
    cuerpo.appendChild(filaProtesis);
  }
}
