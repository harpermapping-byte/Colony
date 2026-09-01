/**
 * Panel de cofre/arcón real (docs/GDD_Produccion.md §3ter, pedido
 * 2026-08-31: "para abrir cofres arcones etc también con click sobre el y
 * abrir") — a diferencia de `mundo/panelContenedorTest.ts` (cofres de
 * mundo con stock infinito, solo la Test Zone), esto habla el protocolo
 * REAL `cofre:*` de una construcción `esContenedor` de verdad (RoomExteriorBase.ts),
 * que hasta ahora era "protocolo puro" sin ninguna UI (solo `console.log`).
 *
 * Solo "Sacar" por ahora — "Meter" un ítem del inventario propio
 * necesitaría integrarse con el drag&drop real de `panelJugador.ts`
 * (`ContenedorVista`/`mover`), que solo conoce los contenedores del
 * jugador (cuerpo/mochilas); ampliarlo para aceptar el cofre como destino
 * es trabajo aparte, no se ha tocado hoy.
 */
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItem {
  nombre?: string;
  tipo?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

export interface ItemCofre {
  id: number;
  itemId: string;
  cantidad: number;
  /** docs/GDD_Libreria.md — 0/ausente = libro de catálogo (o ni siquiera es un libro); >0 = libro escrito por un jugador, ver panelLibro.ts. */
  libroGeneradoId?: number;
}

export interface OpcionesPanelCofre {
  contenedor: HTMLElement;
  sacar(construccionId: number, instanciaId: number): void;
  /** docs/GDD_Libreria.md (pedido 2026-09-01) — opcional: solo se ofrece el botón "Leer" en filas con `tipo:"libro"` si esta opción está presente (una librería la pasa, un cofre normal no). */
  leer?(item: ItemCofre): void;
}

export class PanelCofre {
  private raiz: HTMLDivElement;
  private idAbierto: number | null = null;
  private nombre = "";
  private items: ItemCofre[] = [];

  constructor(private opciones: OpcionesPanelCofre) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "40%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = "rgba(20,16,10,0.94)";
    this.raiz.style.color = "#f0e4c8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #8a6a2a";
    this.raiz.style.minWidth = "220px";
    this.raiz.style.maxHeight = "60vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.display = "none";
    opciones.contenedor.appendChild(this.raiz);
  }

  abrir(nombre: string) {
    this.nombre = nombre;
  }

  /** Refleja `cofre:estado` — si no coincide con el cofre que se pidió abrir, se ignora (llegó de otro clic). */
  actualizarEstado(construccionId: number, items: ItemCofre[]) {
    this.idAbierto = construccionId;
    this.items = items;
    this.render();
  }

  cerrar() {
    this.idAbierto = null;
    this.raiz.style.display = "none";
  }

  private render() {
    this.raiz.innerHTML = "";
    if (this.idAbierto === null) {
      this.raiz.style.display = "none";
      return;
    }
    this.raiz.style.display = "block";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = this.nombre || "Cofre";
    this.raiz.appendChild(titulo);

    if (this.items.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "(vacío)";
      this.raiz.appendChild(vacio);
    }
    for (const it of this.items) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "8px";
      fila.style.margin = "3px 0";
      const etiqueta = document.createElement("span");
      etiqueta.textContent = `${ITEMS[it.itemId]?.nombre ?? it.itemId} x${it.cantidad}`;
      fila.appendChild(etiqueta);
      if (this.opciones.leer && ITEMS[it.itemId]?.tipo === "libro") {
        const btnLeer = document.createElement("button");
        btnLeer.textContent = "Leer";
        btnLeer.onclick = () => this.opciones.leer!(it);
        fila.appendChild(btnLeer);
      }
      const btn = document.createElement("button");
      btn.textContent = "Sacar";
      btn.onclick = () => this.opciones.sacar(this.idAbierto!, it.id);
      fila.appendChild(btn);
      this.raiz.appendChild(fila);
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.textContent = "Cerrar";
    btnCerrar.style.marginTop = "8px";
    btnCerrar.onclick = () => this.cerrar();
    this.raiz.appendChild(btnCerrar);
  }
}
