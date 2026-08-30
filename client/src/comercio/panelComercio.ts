/**
 * Panel de comercio jugador-jugador — PLACEHOLDER de testeo (docs/
 * GDD_Comercio.md, mismo criterio ya pactado para combate/mascotas: "que
 * sean placeholder sencillas... al final del proyecto se hará toda la UI").
 * DOM plano inyectado sobre el canvas, mismo patrón que panelCombate.ts /
 * panelMascotas.ts. Se muestra SOLO mientras hay un comercio abierto en el
 * que participa este jugador.
 */

export interface OfertaComercioVista {
  instanciaId: number;
  itemId: string;
  cantidad: number;
}

export interface EstadoComercioVista {
  comercioId: string;
  nombrePropio: string;
  nombreOtro: string;
  ofertaPropia: OfertaComercioVista[];
  ofertaOtro: OfertaComercioVista[];
  confirmadoPropio: boolean;
  confirmadoOtro: boolean;
}

export interface OpcionesPanelComercio {
  contenedor: HTMLElement;
  ofrecer(instanciaId: number): void;
  quitarOferta(instanciaId: number): void;
  confirmar(): void;
  cancelar(): void;
}

export class PanelComercio {
  private raiz: HTMLDivElement;
  private estado: EstadoComercioVista | null = null;

  constructor(private opciones: OpcionesPanelComercio) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "50%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = "rgba(20,16,10,0.94)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "14px 18px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "360px";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  /** Llamar al recibir "comercio:cerrado" o al no participar en ningún comercio. */
  cerrar() {
    this.estado = null;
    this.render();
  }

  /** Llamar con el estado reconstruido desde room.state.comercios cada vez que cambie. */
  actualizar(estado: EstadoComercioVista) {
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
    titulo.style.marginBottom = "8px";
    titulo.textContent = `🤝 Comercio con ${e.nombreOtro}`;
    this.raiz.appendChild(titulo);

    const columnas = document.createElement("div");
    columnas.style.display = "flex";
    columnas.style.gap = "16px";

    columnas.appendChild(
      this.columna(`Tú (${e.nombrePropio})`, e.ofertaPropia, e.confirmadoPropio, (instanciaId) => this.opciones.quitarOferta(instanciaId))
    );
    columnas.appendChild(this.columna(e.nombreOtro, e.ofertaOtro, e.confirmadoOtro, null));
    this.raiz.appendChild(columnas);

    const ayuda = document.createElement("div");
    ayuda.style.fontSize = "11px";
    ayuda.style.opacity = "0.8";
    ayuda.style.margin = "8px 0";
    ayuda.textContent = "Objetos completos, sin pilas parciales — cualquier cambio de oferta pide confirmar de nuevo a los dos.";
    this.raiz.appendChild(ayuda);

    // Sin rejilla arrastrable todavía (fase 3 de inventario pendiente,
    // docs/GDD_Inventario.md §7) — ofrecer por id de instancia mientras
    // tanto, mismo criterio de placeholder que "dejar mascota en propiedad".
    const filaOfrecer = document.createElement("div");
    filaOfrecer.style.display = "flex";
    filaOfrecer.style.gap = "6px";
    filaOfrecer.style.margin = "8px 0";
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = "id de instancia";
    input.style.width = "110px";
    filaOfrecer.appendChild(input);
    const ofrecer = document.createElement("button");
    ofrecer.textContent = "Ofrecer";
    ofrecer.onclick = () => {
      const id = Number(input.value);
      if (Number.isFinite(id) && id > 0) this.opciones.ofrecer(id);
      input.value = "";
    };
    filaOfrecer.appendChild(ofrecer);
    this.raiz.appendChild(filaOfrecer);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "8px";
    botones.style.justifyContent = "flex-end";

    const confirmar = document.createElement("button");
    confirmar.textContent = e.confirmadoPropio ? "Esperando al otro..." : "Confirmar";
    confirmar.disabled = e.confirmadoPropio;
    confirmar.onclick = () => this.opciones.confirmar();
    botones.appendChild(confirmar);

    const cancelar = document.createElement("button");
    cancelar.textContent = "Cancelar";
    cancelar.onclick = () => this.opciones.cancelar();
    botones.appendChild(cancelar);

    this.raiz.appendChild(botones);
  }

  private columna(titulo: string, oferta: OfertaComercioVista[], confirmado: boolean, quitar: ((instanciaId: number) => void) | null): HTMLDivElement {
    const col = document.createElement("div");
    col.style.flex = "1";
    col.style.border = "1px solid #4a3f2a";
    col.style.borderRadius = "4px";
    col.style.padding = "8px";
    col.style.minHeight = "80px";

    const t = document.createElement("div");
    t.style.fontWeight = "bold";
    t.style.marginBottom = "4px";
    t.textContent = `${titulo}${confirmado ? " ✅" : ""}`;
    col.appendChild(t);

    if (oferta.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.6";
      vacio.textContent = "(nada ofrecido)";
      col.appendChild(vacio);
    }
    for (const o of oferta) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.gap = "6px";
      const texto = document.createElement("span");
      texto.textContent = `${o.itemId} x${o.cantidad}`;
      fila.appendChild(texto);
      if (quitar) {
        const boton = document.createElement("button");
        boton.textContent = "✕";
        boton.onclick = () => quitar(o.instanciaId);
        fila.appendChild(boton);
      }
      col.appendChild(fila);
    }
    return col;
  }
}
