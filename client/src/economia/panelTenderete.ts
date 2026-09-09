/**
 * Panel del tenderete de mercado de jugador (docs/GDD_Mercado.md §12, pedido
 * posterior a v1: mueble `puesto_mercado_jugador` con inventario propio,
 * precios que fija el dueño, tendero contratable, caja de ganancias) —
 * marco compartido (`panelBase.ts`, tema madera/pergamino): sin targeting
 * propio, el servidor decide quién puede hacer qué ("Gestionar" lo rechaza
 * si no eres el dueño, "Comprar" lo rechaza si lo eres o si no hay tendero
 * contratado — mismo criterio "sin UI de targeting" del resto del proyecto).
 *
 * Dos modos, un único panel (evita duplicar el DOM flotante):
 * - `comprar`: escaparate público (`tenderete:escaparate`) — precio y
 *   disponibilidad, cantidad exacta NUNCA viaja aquí.
 * - `gestion`: privado del dueño (`tenderete:gestion`) — cantidades exactas,
 *   fijar precio por ítem, reponer desde el propio cuerpo, recoger la caja
 *   de ganancias acumuladas.
 */
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto, crearSubtitulo } from "../ui/panelBase";
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItem {
  nombre?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;
function nombreDe(itemId: string): string {
  return ITEMS[itemId]?.nombre ?? itemId;
}

export interface ItemEscaparateTenderete {
  itemId: string;
  precioFarycoins: number;
  disponible: boolean;
}

export interface ItemGestionTenderete {
  itemId: string;
  cantidad: number;
  precioFarycoins: number;
}

export interface ItemCuerpoParaReponer {
  instanciaId: number;
  itemId: string;
  cantidad: number;
}

export interface OpcionesPanelTenderete {
  contenedor: HTMLElement;
  comprar(tenderoteId: string, itemId: string, cantidad: number): void;
  fijarPrecio(tenderoteId: string, itemId: string, precioFarycoins: number): void;
  reponer(tenderoteId: string, instanciaId: number, cantidad: number, precioFarycoins: number): void;
  recogerGanancias(tenderoteId: string): void;
  /** Ítems del propio cuerpo — llamado al abrir/refrescar el panel de gestión, para ofrecer qué reponer sin inventar un listado. */
  itemsDelCuerpo(): ItemCuerpoParaReponer[];
}

export class PanelTenderete {
  private readonly marco;
  private modo: "comprar" | "gestion" | null = null;
  private tenderoteId: string | null = null;
  private tendero = false;
  private cajaFarycoins = 0;
  private itemsEscaparate: ItemEscaparateTenderete[] = [];
  private itemsGestion: ItemGestionTenderete[] = [];
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelTenderete) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Puesto de Mercado", icono: "🏪", left: "50%", top: "40%", ancho: "300px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "65vh";
  }

  /** Fija el objetivo del clic — el `tenderete:escaparate`/`tenderete:gestion` de respuesta rellena el resto (mismo patrón que PanelCofre.abrir + actualizarEstado). */
  abrirComprar(tenderoteId: string) {
    this.modo = "comprar";
    this.tenderoteId = tenderoteId;
    this.ultimoError = "";
    this.marco.abrir();
    this.render();
  }

  abrirGestion(tenderoteId: string) {
    this.modo = "gestion";
    this.tenderoteId = tenderoteId;
    this.ultimoError = "";
    this.marco.abrir();
    this.render();
  }

  actualizarEscaparate(tenderoteId: string, tendero: boolean, items: ItemEscaparateTenderete[]) {
    if (this.modo !== "comprar" || this.tenderoteId !== tenderoteId) return;
    this.tendero = tendero;
    this.itemsEscaparate = items;
    this.render();
  }

  actualizarGestion(tenderoteId: string, tendero: boolean, cajaFarycoins: number, items: ItemGestionTenderete[]) {
    if (this.modo !== "gestion" || this.tenderoteId !== tenderoteId) return;
    this.tendero = tendero;
    this.cajaFarycoins = cajaFarycoins;
    this.itemsGestion = items;
    this.render();
  }

  mostrarError(motivo: string) {
    this.ultimoError = motivo;
    this.render();
  }

  cerrar() {
    this.modo = null;
    this.tenderoteId = null;
    this.marco.cerrar();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (this.modo === null || this.tenderoteId === null) return;

    if (!this.tendero) {
      const aviso = crearLineaTexto(
        this.modo === "comprar"
          ? "Cerrado — este puesto no tiene tendero contratado."
          : "Sin tendero contratado: los clientes no pueden comprar todavía (contrátalo desde el reclutador).",
        { fontSize: "11px" }
      );
      aviso.style.color = "var(--error-color)";
      cuerpo.appendChild(aviso);
    }

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.className = "panel-colony-error";
      err.textContent = this.ultimoError;
      cuerpo.appendChild(err);
    }

    if (this.modo === "comprar") this.renderComprar();
    else this.renderGestion();
  }

  private renderComprar() {
    const cuerpo = this.marco.cuerpo;
    if (this.itemsEscaparate.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(sin objetos a la venta)", { tenue: true }));
      return;
    }
    for (const it of this.itemsEscaparate) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "8px";
      fila.style.margin = "3px 0";
      const etiqueta = document.createElement("span");
      etiqueta.style.opacity = it.disponible ? "1" : "0.5";
      etiqueta.textContent = `${nombreDe(it.itemId)} — ${it.precioFarycoins}₣${it.disponible ? "" : " (agotado)"}`;
      fila.appendChild(etiqueta);
      const btn = crearBoton("Comprar 1", () => this.opciones.comprar(this.tenderoteId!, it.itemId, 1));
      btn.disabled = !it.disponible || !this.tendero;
      fila.appendChild(btn);
      cuerpo.appendChild(fila);
    }
  }

  private renderGestion() {
    const cuerpo = this.marco.cuerpo;
    const caja = document.createElement("div");
    caja.style.margin = "4px 0 8px";
    caja.style.padding = "6px 8px";
    caja.style.background = "var(--panel-hover)";
    caja.style.borderRadius = "5px";
    caja.style.display = "flex";
    caja.style.justifyContent = "space-between";
    caja.style.alignItems = "center";
    const etiquetaCaja = document.createElement("span");
    etiquetaCaja.textContent = `Ganancias sin recoger: ${this.cajaFarycoins}₣`;
    caja.appendChild(etiquetaCaja);
    const btnRecoger = crearBoton("Recoger ganancias", () => this.opciones.recogerGanancias(this.tenderoteId!));
    btnRecoger.disabled = this.cajaFarycoins <= 0;
    caja.appendChild(btnRecoger);
    cuerpo.appendChild(caja);

    cuerpo.appendChild(crearSubtitulo("A la venta"));

    if (this.itemsGestion.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(nada repuesto todavía)", { tenue: true }));
    }
    for (const it of this.itemsGestion) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.margin = "3px 0";
      const etiqueta = document.createElement("span");
      etiqueta.textContent = `${nombreDe(it.itemId)} x${it.cantidad}`;
      fila.appendChild(etiqueta);
      const inputPrecio = crearInput({ tipo: "number" });
      inputPrecio.min = "1";
      inputPrecio.value = String(it.precioFarycoins);
      inputPrecio.style.width = "56px";
      fila.appendChild(inputPrecio);
      const btnPrecio = crearBoton("Fijar precio", () => {
        const precio = Math.max(1, Math.floor(Number(inputPrecio.value) || 0));
        this.opciones.fijarPrecio(this.tenderoteId!, it.itemId, precio);
      });
      fila.appendChild(btnPrecio);
      cuerpo.appendChild(fila);
    }

    cuerpo.appendChild(crearSubtitulo("Reponer desde tu inventario"));

    const propios = this.opciones.itemsDelCuerpo();
    if (propios.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(no llevas nada encima)", { tenue: true }));
      return;
    }
    for (const it of propios) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.margin = "3px 0";
      const etiqueta = document.createElement("span");
      etiqueta.textContent = `${nombreDe(it.itemId)} x${it.cantidad}`;
      fila.appendChild(etiqueta);
      const inputPrecio = crearInput({ tipo: "number" });
      inputPrecio.min = "1";
      inputPrecio.value = "1";
      inputPrecio.title = "Precio en Farycoins";
      inputPrecio.style.width = "48px";
      fila.appendChild(inputPrecio);
      const btnReponer = crearBoton("Poner a la venta", () => {
        const precio = Math.max(1, Math.floor(Number(inputPrecio.value) || 0));
        this.opciones.reponer(this.tenderoteId!, it.instanciaId, it.cantidad, precio);
      });
      fila.appendChild(btnReponer);
      cuerpo.appendChild(fila);
    }
  }
}
