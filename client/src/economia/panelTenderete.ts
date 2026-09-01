/**
 * Panel del tenderete de mercado de jugador (docs/GDD_Mercado.md §12, pedido
 * posterior a v1: mueble `puesto_mercado_jugador` con inventario propio,
 * precios que fija el dueño, tendero contratable, caja de ganancias) —
 * mismo patrón DOM flotante que `panelCofre.ts`/`panelReclutador.ts`: sin
 * targeting propio, el servidor decide quién puede hacer qué ("Gestionar"
 * lo rechaza si no eres el dueño, "Comprar" lo rechaza si lo eres o si no
 * hay tendero contratado — mismo criterio "sin UI de targeting" del resto
 * del proyecto).
 *
 * Dos modos, un único panel (evita duplicar el DOM flotante):
 * - `comprar`: escaparate público (`tenderete:escaparate`) — precio y
 *   disponibilidad, cantidad exacta NUNCA viaja aquí.
 * - `gestion`: privado del dueño (`tenderete:gestion`) — cantidades exactas,
 *   fijar precio por ítem, reponer desde el propio cuerpo, recoger la caja
 *   de ganancias acumuladas.
 */
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

const COLOR_FONDO = "rgba(20,16,10,0.94)";
const COLOR_BORDE = "#8a6a2a";
const COLOR_TEXTO = "#f0e4c8";

export class PanelTenderete {
  private raiz: HTMLDivElement;
  private modo: "comprar" | "gestion" | null = null;
  private tenderoteId: string | null = null;
  private nombreTenderete = "";
  private tendero = false;
  private cajaFarycoins = 0;
  private itemsEscaparate: ItemEscaparateTenderete[] = [];
  private itemsGestion: ItemGestionTenderete[] = [];
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelTenderete) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "40%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = COLOR_FONDO;
    this.raiz.style.color = COLOR_TEXTO;
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = `1px solid ${COLOR_BORDE}`;
    this.raiz.style.minWidth = "260px";
    this.raiz.style.maxHeight = "65vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.display = "none";
    opciones.contenedor.appendChild(this.raiz);
  }

  /** Fija el objetivo del clic — el `tenderete:escaparate`/`tenderete:gestion` de respuesta rellena el resto (mismo patrón que PanelCofre.abrir + actualizarEstado). */
  abrirComprar(tenderoteId: string) {
    this.modo = "comprar";
    this.tenderoteId = tenderoteId;
    this.ultimoError = "";
    this.render();
  }

  abrirGestion(tenderoteId: string) {
    this.modo = "gestion";
    this.tenderoteId = tenderoteId;
    this.ultimoError = "";
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
    this.raiz.style.display = "none";
  }

  private render() {
    this.raiz.innerHTML = "";
    if (this.modo === null || this.tenderoteId === null) {
      this.raiz.style.display = "none";
      return;
    }
    this.raiz.style.display = "block";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "4px";
    titulo.textContent = this.modo === "comprar" ? "Puesto de Mercado" : "Mi Tenderete";
    this.raiz.appendChild(titulo);

    if (!this.tendero) {
      const aviso = document.createElement("div");
      aviso.style.color = "#e0a060";
      aviso.style.fontSize = "11px";
      aviso.style.marginBottom = "6px";
      aviso.textContent = this.modo === "comprar"
        ? "Cerrado — este puesto no tiene tendero contratado."
        : "Sin tendero contratado: los clientes no pueden comprar todavía (contrátalo desde el reclutador).";
      this.raiz.appendChild(aviso);
    }

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.style.color = "#e08080";
      err.style.fontSize = "11px";
      err.style.marginBottom = "6px";
      err.textContent = this.ultimoError;
      this.raiz.appendChild(err);
    }

    if (this.modo === "comprar") this.renderComprar();
    else this.renderGestion();

    const btnCerrar = document.createElement("button");
    btnCerrar.textContent = "Cerrar";
    btnCerrar.style.marginTop = "8px";
    btnCerrar.onclick = () => this.cerrar();
    this.raiz.appendChild(btnCerrar);
  }

  private renderComprar() {
    if (this.itemsEscaparate.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "(sin objetos a la venta)";
      this.raiz.appendChild(vacio);
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
      const btn = document.createElement("button");
      btn.textContent = "Comprar 1";
      btn.disabled = !it.disponible || !this.tendero;
      btn.onclick = () => this.opciones.comprar(this.tenderoteId!, it.itemId, 1);
      fila.appendChild(btn);
      this.raiz.appendChild(fila);
    }
  }

  private renderGestion() {
    const caja = document.createElement("div");
    caja.style.margin = "4px 0 8px";
    caja.style.padding = "6px 8px";
    caja.style.background = "rgba(255,255,255,0.06)";
    caja.style.borderRadius = "5px";
    caja.style.display = "flex";
    caja.style.justifyContent = "space-between";
    caja.style.alignItems = "center";
    const etiquetaCaja = document.createElement("span");
    etiquetaCaja.textContent = `Ganancias sin recoger: ${this.cajaFarycoins}₣`;
    caja.appendChild(etiquetaCaja);
    const btnRecoger = document.createElement("button");
    btnRecoger.textContent = "Recoger ganancias";
    btnRecoger.disabled = this.cajaFarycoins <= 0;
    btnRecoger.onclick = () => this.opciones.recogerGanancias(this.tenderoteId!);
    caja.appendChild(btnRecoger);
    this.raiz.appendChild(caja);

    const subVenta = document.createElement("div");
    subVenta.style.fontWeight = "bold";
    subVenta.style.margin = "6px 0 2px";
    subVenta.textContent = "A la venta";
    this.raiz.appendChild(subVenta);

    if (this.itemsGestion.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "(nada repuesto todavía)";
      this.raiz.appendChild(vacio);
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
      const inputPrecio = document.createElement("input");
      inputPrecio.type = "number";
      inputPrecio.min = "1";
      inputPrecio.value = String(it.precioFarycoins);
      inputPrecio.style.width = "56px";
      fila.appendChild(inputPrecio);
      const btnPrecio = document.createElement("button");
      btnPrecio.textContent = "Fijar precio";
      btnPrecio.onclick = () => {
        const precio = Math.max(1, Math.floor(Number(inputPrecio.value) || 0));
        this.opciones.fijarPrecio(this.tenderoteId!, it.itemId, precio);
      };
      fila.appendChild(btnPrecio);
      this.raiz.appendChild(fila);
    }

    const subReponer = document.createElement("div");
    subReponer.style.fontWeight = "bold";
    subReponer.style.margin = "10px 0 2px";
    subReponer.textContent = "Reponer desde tu inventario";
    this.raiz.appendChild(subReponer);

    const propios = this.opciones.itemsDelCuerpo();
    if (propios.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "(no llevas nada encima)";
      this.raiz.appendChild(vacio);
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
      const inputPrecio = document.createElement("input");
      inputPrecio.type = "number";
      inputPrecio.min = "1";
      inputPrecio.value = "1";
      inputPrecio.title = "Precio en Farycoins";
      inputPrecio.style.width = "48px";
      fila.appendChild(inputPrecio);
      const btnReponer = document.createElement("button");
      btnReponer.textContent = "Poner a la venta";
      btnReponer.onclick = () => {
        const precio = Math.max(1, Math.floor(Number(inputPrecio.value) || 0));
        this.opciones.reponer(this.tenderoteId!, it.instanciaId, it.cantidad, precio);
      };
      fila.appendChild(btnReponer);
      this.raiz.appendChild(fila);
    }
  }
}
