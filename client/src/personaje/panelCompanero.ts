/**
 * Panel de compañero NPC — PLACEHOLDER de testeo (docs/GDD_Companeros.md,
 * mismo criterio de placeholder que panelMedico.ts/panelCocina.ts). Sin
 * compañero: botón de diálogo (tirada de carisma) + input crudo de
 * npcVendedorId para comprar a través de un vendedor. Con compañero: su
 * nombre/nivel/vida + dar/quitar objeto y equipar/desequipar por
 * instanciaId crudo (sin drag&drop todavía, igual que el resto de estos
 * paneles de esqueleto).
 */

export interface EstadoCompaneroVista {
  nombre: string;
  nivel: number;
  vida: number;
  vidaMax: number;
  /** Pedido 2026-08-31: "la gente que apoya debe poder decidir si se une o no, no autounirse" — toggle del dueño. */
  participaEnCombate: boolean;
}

export interface OpcionesPanelCompanero {
  contenedor: HTMLElement;
  intentarReclutar(): void;
  comprarDeVendedor(npcVendedorId: string): void;
  darItem(instanciaId: number): void;
  quitarItem(instanciaId: number): void;
  equipar(instanciaId: number, slot: string): void;
  desequipar(slot: string): void;
  /** docs/GDD_Produccion.md §3bis — trae de vuelta al compañero que está trabajando en una plantilla. */
  llamar(): void;
  /** Pedido 2026-08-31 — decidir si el compañero se une solo a tus combates o se queda fuera. */
  fijarParticipaCombate(activo: boolean): void;
}

export class PanelCompanero {
  private raiz: HTMLDivElement;
  private estado: EstadoCompaneroVista | null = null;

  constructor(private opciones: OpcionesPanelCompanero) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.right = "16px";
    this.raiz.style.bottom = "180px";
    this.raiz.style.background = "rgba(10,18,12,0.88)";
    this.raiz.style.color = "#d8f0d8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #3a6a3a";
    this.raiz.style.minWidth = "220px";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  actualizarEstado(estado: EstadoCompaneroVista | null) {
    this.estado = estado;
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🛡️ Compañero";
    this.raiz.appendChild(titulo);

    if (!this.estado) {
      const info = document.createElement("div");
      info.style.opacity = "0.8";
      info.style.marginBottom = "6px";
      info.textContent = "(sin compañero — habla con un NPC cercano)";
      this.raiz.appendChild(info);

      const btnDialogo = document.createElement("button");
      btnDialogo.textContent = "Intentar reclutar (diálogo)";
      btnDialogo.onclick = () => this.opciones.intentarReclutar();
      this.raiz.appendChild(btnDialogo);

      const filaVendedor = document.createElement("div");
      filaVendedor.style.marginTop = "6px";
      const inputVendedor = document.createElement("input");
      inputVendedor.placeholder = "id NPC vendedor";
      inputVendedor.style.width = "100%";
      inputVendedor.style.margin = "4px 0";
      filaVendedor.appendChild(inputVendedor);
      const btnComprar = document.createElement("button");
      btnComprar.textContent = "Comprar de vendedor";
      btnComprar.onclick = () => { if (inputVendedor.value) this.opciones.comprarDeVendedor(inputVendedor.value); };
      filaVendedor.appendChild(btnComprar);
      this.raiz.appendChild(filaVendedor);

      // docs/GDD_Produccion.md §3bis: si el "sin compañero" es en realidad
      // "está trabajando en una plantilla" (desaparece del Schema mientras
      // trabaja, mismo criterio que una mascota dejada en propiedad), este
      // botón lo trae de vuelta — inofensivo si de verdad no tienes ninguno
      // (el servidor responde "no tienes compañero" y no pasa nada).
      const filaLlamar = document.createElement("div");
      filaLlamar.style.marginTop = "6px";
      const btnLlamar = document.createElement("button");
      btnLlamar.textContent = "Llamar (si está trabajando)";
      btnLlamar.onclick = () => this.opciones.llamar();
      filaLlamar.appendChild(btnLlamar);
      this.raiz.appendChild(filaLlamar);
      return;
    }

    const info = document.createElement("div");
    info.style.marginBottom = "6px";
    info.textContent = `${this.estado.nombre} — nivel ${this.estado.nivel} — vida ${Math.round(this.estado.vida)}/${Math.round(this.estado.vidaMax)}`;
    this.raiz.appendChild(info);

    const inputInstancia = document.createElement("input");
    inputInstancia.placeholder = "id instancia";
    inputInstancia.type = "number";
    inputInstancia.style.width = "100%";
    inputInstancia.style.margin = "4px 0";
    this.raiz.appendChild(inputInstancia);

    const filaTransferir = document.createElement("div");
    const btnDar = document.createElement("button");
    btnDar.textContent = "Darle objeto";
    btnDar.style.marginRight = "4px";
    btnDar.onclick = () => { const id = Number(inputInstancia.value); if (id) this.opciones.darItem(id); };
    filaTransferir.appendChild(btnDar);
    const btnQuitar = document.createElement("button");
    btnQuitar.textContent = "Quitarle objeto";
    btnQuitar.onclick = () => { const id = Number(inputInstancia.value); if (id) this.opciones.quitarItem(id); };
    filaTransferir.appendChild(btnQuitar);
    this.raiz.appendChild(filaTransferir);

    const inputSlot = document.createElement("input");
    inputSlot.placeholder = "slot (ej. torso, espalda=mochila)";
    inputSlot.style.width = "100%";
    inputSlot.style.margin = "4px 0";
    this.raiz.appendChild(inputSlot);

    const filaEquipo = document.createElement("div");
    const btnEquipar = document.createElement("button");
    btnEquipar.textContent = "Equipar";
    btnEquipar.style.marginRight = "4px";
    btnEquipar.onclick = () => { const id = Number(inputInstancia.value); if (id && inputSlot.value) this.opciones.equipar(id, inputSlot.value); };
    filaEquipo.appendChild(btnEquipar);
    const btnDesequipar = document.createElement("button");
    btnDesequipar.textContent = "Desequipar";
    btnDesequipar.onclick = () => { if (inputSlot.value) this.opciones.desequipar(inputSlot.value); };
    filaEquipo.appendChild(btnDesequipar);
    this.raiz.appendChild(filaEquipo);

    // Pedido 2026-08-31: "la gente que apoya debe poder decidir si se une o
    // no, no autounirse" — antes se metía siempre en tu combate sin preguntar.
    const filaCombate = document.createElement("div");
    filaCombate.style.marginTop = "6px";
    const labelCombate = document.createElement("label");
    labelCombate.style.cursor = "pointer";
    const checkCombate = document.createElement("input");
    checkCombate.type = "checkbox";
    checkCombate.checked = this.estado.participaEnCombate;
    checkCombate.onchange = () => this.opciones.fijarParticipaCombate(checkCombate.checked);
    labelCombate.appendChild(checkCombate);
    labelCombate.appendChild(document.createTextNode(" se une a mis combates"));
    filaCombate.appendChild(labelCombate);
    this.raiz.appendChild(filaCombate);
  }
}
