/**
 * Panel de cofres de mundo de la Test Zone (docs/GDD_Admin.md, pedido
 * 2026-08-31): cofres `contenedorTest:*` sin gating de admin — cualquier
 * jugador en el mapa testzone puede abrirlos. Sin detección de proximidad
 * real todavía (no hay schema de cofres en el state, lo está montando otro
 * agente en paralelo en server/): tecla Y abre un cofre de id fijo de
 * prueba, mismo criterio "sin UI de targeting" que el resto de paneles
 * placeholder de este cliente (ver panelPesca.ts, panelCompanero.ts).
 *
 * Migrado al marco compartido (pedido streamer 2026-09-09: "TODA pantalla
 * que salga... debe salir así con esta estética") — mismo centro de
 * pantalla de siempre (`crearMarcoPanel`, panelBase.ts). Cualquier cierre
 * (botón "Cerrar", X, clic fuera, Escape) limpia el estado local y avisa al
 * servidor exactamente igual — antes solo el botón "Cerrar" lo hacía.
 */
import { crearMarcoPanel, crearBoton, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";
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
  private readonly marco: MarcoPanel;
  private idAbierto: string | null = null;
  private items: ItemContenedorTest[] = [];

  constructor(private opciones: OpcionesPanelContenedorTest) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Cofre",
      icono: "📦",
      left: "50%",
      top: "40%",
      ancho: "220px",
    });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    // Cualquier cierre por X/clic-fuera/Escape (no solo el botón "Cerrar" de
    // siempre) debe limpiar el estado local y avisar al servidor — si no,
    // el cofre quedaría "abierto" en memoria sin ninguna ventana visible.
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto() && this.idAbierto !== null) {
        this.idAbierto = null;
        this.items = [];
        this.opciones.cerrar();
      }
    });
  }

  /** Refleja `contenedorTest:estado` — si el id no coincide con el cofre abierto ahora mismo, se ignora. */
  actualizarEstado(id: string, items: ItemContenedorTest[]) {
    if (this.idAbierto !== null && this.idAbierto !== id) return;
    this.idAbierto = id;
    this.items = items;
    this.render();
    this.marco.abrir();
  }

  estaAbierto(): boolean {
    return this.idAbierto !== null;
  }

  cerrar() {
    this.idAbierto = null;
    this.items = [];
    this.marco.cerrar();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    cuerpo.appendChild(crearLineaTexto(`ID: ${this.idAbierto}`, { tenue: true, fontSize: "11px" }));

    if (this.items.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(vacío)", { tenue: true }));
    }

    for (const it of this.items) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "8px";
      fila.style.margin = "4px 0";

      const etiqueta = document.createElement("span");
      etiqueta.textContent = `${ITEMS[it.itemId]?.nombre ?? it.itemId} x${it.cantidad}`;
      fila.appendChild(etiqueta);

      const idAbierto = this.idAbierto;
      fila.appendChild(crearBoton("Tomar", () => {
        if (idAbierto) this.opciones.tomar(idAbierto, it.itemId, it.cantidad);
      }));

      cuerpo.appendChild(fila);
    }

    const btnCerrar = crearBoton("Cerrar", () => {
      this.cerrar();
      this.opciones.cerrar();
    });
    btnCerrar.style.marginTop = "6px";
    btnCerrar.style.width = "100%";
    cuerpo.appendChild(btnCerrar);
  }
}
