/**
 * Panel de cofres de mundo de la Test Zone (docs/GDD_Admin.md, pedido
 * 2026-08-31): cofres `contenedorTest:*` sin gating de admin — cualquier
 * jugador en el mapa testzone puede abrirlos. Sin detección de proximidad
 * real todavía (no hay schema de cofres en el state, lo está montando otro
 * agente en paralelo en server/): tecla Y abre un cofre de id fijo de
 * prueba, mismo criterio "sin UI de targeting" que el resto de paneles
 * placeholder de este cliente (ver panelPesca.ts, panelCompanero.ts).
 */
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItem {
  nombre?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

export interface ItemContenedorTest {
  itemId: string;
  cantidad: number;
}

export interface OpcionesPanelContenedorTest {
  contenedor: HTMLElement;
  tomar(id: string, itemId: string, cantidad: number): void;
  cerrar(): void;
}

export class PanelContenedorTest {
  private raiz: HTMLDivElement;
  private idAbierto: string | null = null;
  private items: ItemContenedorTest[] = [];

  constructor(private opciones: OpcionesPanelContenedorTest) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "40%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = "rgba(24,20,10,0.94)";
    this.raiz.style.color = "#f0e8d0";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #8a7a2a";
    this.raiz.style.minWidth = "220px";
    this.raiz.style.display = "none";
    opciones.contenedor.appendChild(this.raiz);
  }

  /** Refleja `contenedorTest:estado` — si el id no coincide con el cofre abierto ahora mismo, se ignora. */
  actualizarEstado(id: string, items: ItemContenedorTest[]) {
    if (this.idAbierto !== null && this.idAbierto !== id) return;
    this.idAbierto = id;
    this.items = items;
    this.render();
  }

  estaAbierto(): boolean {
    return this.idAbierto !== null;
  }

  cerrar() {
    this.idAbierto = null;
    this.items = [];
    this.raiz.style.display = "none";
  }

  private render() {
    this.raiz.style.display = "block";
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = `📦 Cofre: ${this.idAbierto}`;
    this.raiz.appendChild(titulo);

    if (this.items.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.8";
      vacio.textContent = "(vacío)";
      this.raiz.appendChild(vacio);
    }

    for (const it of this.items) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.margin = "4px 0";

      const etiqueta = document.createElement("span");
      etiqueta.textContent = `${ITEMS[it.itemId]?.nombre ?? it.itemId} x${it.cantidad}`;
      fila.appendChild(etiqueta);

      const btnTomar = document.createElement("button");
      btnTomar.textContent = "Tomar";
      btnTomar.style.marginLeft = "8px";
      btnTomar.onclick = () => {
        if (this.idAbierto) this.opciones.tomar(this.idAbierto, it.itemId, it.cantidad);
      };
      fila.appendChild(btnTomar);

      this.raiz.appendChild(fila);
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.textContent = "Cerrar";
    btnCerrar.style.marginTop = "6px";
    btnCerrar.onclick = () => {
      this.cerrar();
      this.opciones.cerrar();
    };
    this.raiz.appendChild(btnCerrar);
  }
}
