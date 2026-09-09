/**
 * Panel de cofre/arcón real (docs/GDD_Produccion.md §3ter, pedido
 * 2026-08-31: "para abrir cofres arcones etc también con click sobre el y
 * abrir") — a diferencia de `mundo/panelContenedorTest.ts` (cofres de
 * mundo con stock infinito, solo la Test Zone), esto habla el protocolo
 * REAL `cofre:*` de una construcción `esContenedor` de verdad (RoomExteriorBase.ts).
 *
 * Rejilla real con drag&drop (pedido streamer 2026-09-06: "debe salir la
 * opción abrir inventario y se abre la UI de su inventario con el grid...
 * podrás... intercambiar objetos") — MISMO patrón visual y de arrastre que
 * `panelJugador.ts::renderGridContenedor` (celdas absolutas por `(x,y)`,
 * `draggable`), pero el destino de un drop AQUÍ siempre es "meter" (el
 * cofre no tiene mochilas/slots como el jugador, un único contenedor) y el
 * hueco de destino lo decide el SERVIDOR solo (`cofre:meterItem`/
 * `cofre:sacarItem` ya buscan hueco libre ellos mismos, `buscarHueco` en
 * RoomExteriorBase.ts) — por eso ni el `ondrop` de aquí ni el de
 * `panelJugador.ts` calculan una celda de destino para este intercambio,
 * a diferencia del drag&drop DENTRO del inventario propio (que sí reordena
 * a mano con `inventario:mover`). El botón "Sacar" de toda la vida se
 * mantiene igual de accesible que el arrastre.
 *
 * Chrome visual migrado al marco compartido (pedido streamer 2026-09-09,
 * "TODA pantalla... debe salir así con esta estética") — X + clic fuera +
 * Escape los da `crearMarcoPanel`, el botón "Cerrar" casero se retira. La
 * rejilla en sí (celdas draggable por (x,y)) sigue siendo un `<div>` con su
 * propio grid CSS, sin tocar, solo colgado de `marco.cuerpo` en vez del
 * `raiz` de antes — el drag&drop no depende de qué envuelve a la rejilla.
 * El nombre real del cofre (variable, lo fija el servidor por `cofre:estado`)
 * sigue mostrándose como primera línea del cuerpo — la cabecera del marco
 * usa un título genérico fijo, mismo criterio que el resto de paneles
 * migrados (p.ej. panelJugador.ts muestra `player.name` en el cuerpo bajo
 * una cabecera fija "Jugador"), panelBase.ts no ofrece título dinámico.
 */
import itemsJson from "../../../items/catalogo/items.json";
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

interface EntradaItem {
  nombre?: string;
  tipo?: string;
  huella?: [number, number];
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

/** Tamaño de celda del grid en px — mismo valor que panelJugador.ts, puramente visual. */
const TAM_CELDA = 30;

export interface ItemCofre {
  id: number;
  itemId: string;
  cantidad: number;
  x: number;
  y: number;
  rot: 0 | 1;
  /** docs/GDD_Libreria.md — 0/ausente = libro de catálogo (o ni siquiera es un libro); >0 = libro escrito por un jugador, ver panelLibro.ts. */
  libroGeneradoId?: number;
}

export interface OpcionesPanelCofre {
  contenedor: HTMLElement;
  sacar(construccionId: number, instanciaId: number): void;
  /** Mete un ítem propio soltado sobre esta rejilla (`cofre:meterItem`, ya funcional en el servidor desde antes de hoy — solo faltaba el gesto real de UI). */
  meter(instanciaId: number): void;
  /** docs/GDD_Libreria.md (pedido 2026-09-01) — opcional: solo se ofrece el botón "Leer" en filas con `tipo:"libro"` si esta opción está presente (una librería la pasa, un cofre normal no). */
  leer?(item: ItemCofre): void;
}

export class PanelCofre {
  private readonly marco: MarcoPanel;
  private idAbierto: number | null = null;
  private nombre = "";
  private ancho = 1;
  private alto = 1;
  private items: ItemCofre[] = [];

  constructor(private opciones: OpcionesPanelCofre) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Cofre", icono: "🧰", left: "50%", top: "40%" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "60vh";
    // Cerrar por CUALQUIER vía (X, clic fuera, Escape) también olvida el
    // cofre "abierto" a nivel de datos — mismo criterio que los paneles
    // legendarios, para no dejar `idAbierto` apuntando a un cofre que ya no
    // se ve en pantalla.
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) this.idAbierto = null;
    });
  }

  abrir(nombre: string) {
    this.nombre = nombre;
  }

  /** Refleja `cofre:estado` — si no coincide con el cofre que se pidió abrir, se ignora (llegó de otro clic). */
  actualizarEstado(construccionId: number, ancho: number, alto: number, items: ItemCofre[]) {
    this.idAbierto = construccionId;
    this.ancho = Math.max(1, ancho);
    this.alto = Math.max(1, alto);
    this.items = items;
    this.marco.abrir();
    this.render();
  }

  cerrar() {
    this.idAbierto = null;
    this.marco.cerrar();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (this.idAbierto === null) return;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = this.nombre || "Cofre";
    cuerpo.appendChild(titulo);

    cuerpo.appendChild(this.renderGrid());
  }

  /** Rejilla real (mismo patrón que panelJugador.ts::renderGridContenedor) — celdas por (x,y), arrastrables, con botón "Sacar" (y "Leer" si aplica) superpuesto. */
  private renderGrid(): HTMLDivElement {
    const grid = document.createElement("div");
    grid.style.position = "relative";
    grid.style.width = `${this.ancho * TAM_CELDA}px`;
    grid.style.height = `${this.alto * TAM_CELDA}px`;
    grid.style.background = `repeating-linear-gradient(0deg, transparent, transparent ${TAM_CELDA - 1}px, #6a5a2a ${TAM_CELDA}px), repeating-linear-gradient(90deg, transparent, transparent ${TAM_CELDA - 1}px, #6a5a2a ${TAM_CELDA}px)`;
    grid.style.border = "1px solid #8a6a2a";

    // Meter un ítem propio soltado aquí (pedido streamer "intercambiar
    // objetos") — solo reacciona a drags con origen "jugador" (los que
    // vienen de la propia rejilla no tienen nada que hacer aquí: el cofre
    // no reordena por (x,y), el servidor ya busca hueco solo).
    grid.ondragover = (ev) => ev.preventDefault();
    grid.ondrop = (ev) => {
      ev.preventDefault();
      const datos = ev.dataTransfer?.getData("text/plain");
      if (!datos) return;
      let payload: { instanciaId: number; origen?: "jugador" | "cofre" };
      try {
        payload = JSON.parse(datos);
      } catch {
        return;
      }
      if (payload.origen === "jugador") this.opciones.meter(payload.instanciaId);
    };

    if (this.items.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.position = "absolute";
      vacio.style.top = "4px";
      vacio.style.left = "4px";
      vacio.style.opacity = "0.7";
      vacio.textContent = "(vacío)";
      grid.appendChild(vacio);
    }

    for (const it of this.items) {
      const entrada = ITEMS[it.itemId];
      const [wBase, hBase] = entrada?.huella ?? [1, 1];
      const w = it.rot === 1 ? hBase : wBase;
      const h = it.rot === 1 ? wBase : hBase;

      const celda = document.createElement("div");
      celda.draggable = true;
      celda.style.position = "absolute";
      celda.style.left = `${it.x * TAM_CELDA}px`;
      celda.style.top = `${it.y * TAM_CELDA}px`;
      celda.style.width = `${w * TAM_CELDA - 2}px`;
      celda.style.height = `${h * TAM_CELDA - 2}px`;
      celda.style.boxSizing = "border-box";
      celda.style.background = "#3a3020";
      celda.style.border = "1px solid #b8a878";
      celda.style.borderRadius = "3px";
      celda.style.fontSize = "9px";
      celda.style.lineHeight = "1.2";
      celda.style.overflow = "hidden";
      celda.style.padding = "1px 2px";
      celda.style.cursor = "grab";
      celda.title = `${ITEMS[it.itemId]?.nombre ?? it.itemId} x${it.cantidad}`;
      celda.textContent = `${ITEMS[it.itemId]?.nombre ?? it.itemId}${it.cantidad > 1 ? ` x${it.cantidad}` : ""}`;
      celda.ondragstart = (ev) => {
        ev.dataTransfer?.setData("text/plain", JSON.stringify({ instanciaId: it.id, rot: it.rot, origen: "cofre" }));
      };

      const botones = document.createElement("div");
      botones.style.position = "absolute";
      botones.style.bottom = "0";
      botones.style.right = "0";
      if (this.opciones.leer && entrada?.tipo === "libro") {
        const btnLeer = document.createElement("button");
        btnLeer.textContent = "Leer";
        btnLeer.style.fontSize = "9px";
        btnLeer.onclick = (ev) => { ev.stopPropagation(); this.opciones.leer!(it); };
        botones.appendChild(btnLeer);
      }
      const btnSacar = document.createElement("button");
      btnSacar.textContent = "Sacar";
      btnSacar.style.fontSize = "9px";
      btnSacar.onclick = (ev) => { ev.stopPropagation(); this.opciones.sacar(this.idAbierto!, it.id); };
      botones.appendChild(btnSacar);
      celda.appendChild(botones);

      grid.appendChild(celda);
    }
    return grid;
  }
}
