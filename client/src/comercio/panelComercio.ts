/**
 * Panel de comercio jugador-jugador — PLACEHOLDER de testeo (docs/
 * GDD_Comercio.md, mismo criterio ya pactado para combate/mascotas: "que
 * sean placeholder sencillas... al final del proyecto se hará toda la UI").
 * Marco compartido (`panelBase.ts`, tema madera/pergamino, X + clic fuera +
 * Escape). Se muestra SOLO mientras hay un comercio abierto en el que
 * participa este jugador — `actualizar()`/`cerrar()` abren/cierran el marco
 * según el estado real del servidor, la X solo lo oculta (el comercio en sí
 * sigue activo hasta `cancelar()`/`comercio:cerrado`).
 */
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto, crearSubtitulo } from "../ui/panelBase";

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
  private readonly marco;
  private estado: EstadoComercioVista | null = null;

  constructor(private opciones: OpcionesPanelComercio) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Comercio", icono: "🤝", left: "50%", top: "50%", ancho: "400px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
  }

  /** Llamar al recibir "comercio:cerrado" o al no participar en ningún comercio. */
  cerrar() {
    this.estado = null;
    this.marco.cerrar();
  }

  /** Llamar con el estado reconstruido desde room.state.comercios cada vez que cambie. */
  actualizar(estado: EstadoComercioVista) {
    this.estado = estado;
    this.marco.abrir();
    this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (!this.estado) return;
    const e = this.estado;

    cuerpo.appendChild(crearSubtitulo(`Comercio con ${e.nombreOtro}`));

    const columnas = document.createElement("div");
    columnas.style.display = "flex";
    columnas.style.gap = "16px";

    columnas.appendChild(
      this.columna(`Tú (${e.nombrePropio})`, e.ofertaPropia, e.confirmadoPropio, (instanciaId) => this.opciones.quitarOferta(instanciaId))
    );
    columnas.appendChild(this.columna(e.nombreOtro, e.ofertaOtro, e.confirmadoOtro, null));
    cuerpo.appendChild(columnas);

    cuerpo.appendChild(crearLineaTexto("Objetos completos, sin pilas parciales — cualquier cambio de oferta pide confirmar de nuevo a los dos.", { tenue: true, fontSize: "11px" }));

    // Sin rejilla arrastrable todavía (fase 3 de inventario pendiente,
    // docs/GDD_Inventario.md §7) — ofrecer por id de instancia mientras
    // tanto, mismo criterio de placeholder que "dejar mascota en propiedad".
    const filaOfrecer = document.createElement("div");
    filaOfrecer.style.display = "flex";
    filaOfrecer.style.gap = "6px";
    filaOfrecer.style.margin = "8px 0";
    const input = crearInput({ placeholder: "id de instancia", tipo: "number" });
    input.style.width = "110px";
    filaOfrecer.appendChild(input);
    filaOfrecer.appendChild(crearBoton("Ofrecer", () => {
      const id = Number(input.value);
      if (Number.isFinite(id) && id > 0) this.opciones.ofrecer(id);
      input.value = "";
    }));
    cuerpo.appendChild(filaOfrecer);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "8px";
    botones.style.justifyContent = "flex-end";

    const confirmar = crearBoton(e.confirmadoPropio ? "Esperando al otro..." : "Confirmar", () => this.opciones.confirmar());
    confirmar.disabled = e.confirmadoPropio;
    botones.appendChild(confirmar);

    // "Cancelar" cancela la operación en el servidor (docs/GDD_Comercio.md) —
    // distinto de la X del marco, que solo oculta el panel.
    botones.appendChild(crearBoton("Cancelar", () => this.opciones.cancelar()));

    cuerpo.appendChild(botones);
  }

  private columna(titulo: string, oferta: OfertaComercioVista[], confirmado: boolean, quitar: ((instanciaId: number) => void) | null): HTMLDivElement {
    const col = document.createElement("div");
    col.style.flex = "1";
    col.style.border = "1px solid var(--panel-borde-tallado)";
    col.style.borderRadius = "4px";
    col.style.padding = "8px";
    col.style.minHeight = "80px";

    const t = document.createElement("div");
    t.style.fontWeight = "bold";
    t.style.marginBottom = "4px";
    t.textContent = `${titulo}${confirmado ? " ✅" : ""}`;
    col.appendChild(t);

    if (oferta.length === 0) {
      col.appendChild(crearLineaTexto("(nada ofrecido)", { tenue: true }));
    }
    for (const o of oferta) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      const texto = document.createElement("span");
      texto.textContent = `${o.itemId} x${o.cantidad}`;
      fila.appendChild(texto);
      if (quitar) {
        const boton = crearBoton("✕", () => quitar(o.instanciaId));
        boton.style.padding = "1px 6px";
        fila.appendChild(boton);
      }
      col.appendChild(fila);
    }
    return col;
  }
}
