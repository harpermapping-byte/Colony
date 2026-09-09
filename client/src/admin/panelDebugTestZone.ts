/**
 * Panel de debug de la Test Zone (docs/GDD_Admin.md, pedido 2026-08-31):
 * "los comandos que sea una tabla con opciones para aplicar que no tenga
 * que escribirlos yo" — TODO clicable, nada de escribir comandos a mano.
 * Envuelve los mensajes `admin:debug:*` que expone RoomExteriorBase
 * (gateados a jarl/superadmin en servidor; aquí solo se muestra si ya hay
 * sesión de admin confirmada, mismo criterio que PanelJarl). El servidor
 * es la autoridad: si el jugador no es jarl del mapa, cada botón simplemente
 * responde `admin:error` y aquí se refleja el mensaje sin más drama.
 *
 * Migrado al marco compartido (pedido streamer 2026-09-09: "TODA pantalla
 * que salga... debe salir así con esta estética") — misma esquina inferior
 * izquierda de siempre (`crearMarcoPanel`, panelBase.ts). F9 sigue
 * alternándolo (`alternar()`), ahora también con X/clic-fuera/Escape — el
 * viejo "chip" de aviso cuando estaba colapsado ya no hace falta, la X del
 * marco cumple ese papel.
 */
import { crearMarcoPanel, crearBoton, crearSubtitulo, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";
import itemsJson from "../../../items/catalogo/items.json";

// Dos mapas de Test Zone distintos (docs/GDD_TestZone.md) — coordenadas
// reales de cada uno (assets/mapas/<mapa>/ZONAS.md), elegidas por mapaId
// para que los botones sirvan en cualquiera de los dos sin tocar código.
const ZONAS_TESTFLAT: { etiqueta: string; x: number; y: number }[] = [
  { etiqueta: "Spawn", x: 32, y: 32 },
  { etiqueta: "Norte: Muebles/mesas", x: 31, y: 15 },
  { etiqueta: "Sur: NPCs que hablan", x: 32, y: 46 },
  { etiqueta: "Este: Cofres", x: 46, y: 32 },
  { etiqueta: "Oeste: Nodos recolección", x: 17, y: 33 },
  { etiqueta: "Noreste: Dummies combate", x: 47, y: 16 },
  // Aldea fusionada 2026-09-02 ("fusionar de verdad"): ya no hay portal que
  // cruzar, el terreno de testaldea vive directo dentro de testflat con
  // offset +80,+0 — este botón teleporta a su plaza/ciudad (73,41 -> 153,41).
  { etiqueta: "Aldea (plaza)", x: 153, y: 41 },
];
const ZONAS_TESTZONE: { etiqueta: string; x: number; y: number }[] = [
  { etiqueta: "Spawn", x: 220, y: 270 },
  { etiqueta: "Zona 1 Recolección", x: 206, y: 258 },
  { etiqueta: "Zona 2 Crafteo", x: 234, y: 266 },
  { etiqueta: "Zona 3 Almacenamiento", x: 228, y: 280 },
  { etiqueta: "Zona 4 Construcción", x: 219, y: 276 },
  { etiqueta: "Zona 5 Combate", x: 236, y: 280 },
];
const ZONAS_ACTIVAS =
  new URLSearchParams(location.search).get("mapaId") === "testzone" ? ZONAS_TESTZONE : ZONAS_TESTFLAT;

interface EntradaItem {
  nombre?: string;
  tipo?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

export interface OpcionesPanelDebugTestZone {
  contenedor: HTMLElement;
  darItem(itemId: string, cantidad: number): void;
  ajustarFarycoins(cantidad: number): void;
  limpiarInventario(): void;
  godMode(activo: boolean): void;
  maxOficio(slot: 1 | 2): void;
  resetearNodo(nodoId: string): void;
  teleport(x: number, y: number): void;
}

export class PanelDebugTestZone {
  private readonly marco: MarcoPanel;
  private mensaje = "";
  private godActivo = false;

  constructor(private opciones: OpcionesPanelDebugTestZone) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Debug Test Zone",
      icono: "🛠️",
      ancho: "280px",
    });
    this.marco.raiz.style.left = "16px";
    this.marco.raiz.style.bottom = "16px";
    this.render();
    this.marco.abrir();
  }

  /** F9 — mismo nombre público de siempre, ahora delega en el marco compartido. */
  alternar() {
    this.marco.alternar();
  }

  estaVisible(): boolean {
    return this.marco.estaAbierto();
  }

  mostrarResultado(texto: string) {
    this.mensaje = texto;
    this.render();
  }

  private fila(cuerpo: HTMLElement): HTMLDivElement {
    const div = document.createElement("div");
    div.style.margin = "4px 0";
    cuerpo.appendChild(div);
    return div;
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    cuerpo.appendChild(crearLineaTexto("F9 alterna este panel.", { tenue: true, fontSize: "10px" }));

    // --- Dar item ---
    cuerpo.appendChild(crearSubtitulo("Dar ítem"));
    const filaItem = this.fila(cuerpo);
    const selectItem = document.createElement("select");
    selectItem.className = "panel-colony-input";
    selectItem.style.maxWidth = "170px";
    const porTipo = new Map<string, { id: string; nombre: string }[]>();
    for (const [id, entrada] of Object.entries(ITEMS)) {
      const tipo = entrada.tipo ?? "otro";
      if (!porTipo.has(tipo)) porTipo.set(tipo, []);
      porTipo.get(tipo)!.push({ id, nombre: entrada.nombre ?? id });
    }
    for (const tipo of [...porTipo.keys()].sort()) {
      const grupo = document.createElement("optgroup");
      grupo.label = tipo;
      for (const { id, nombre } of porTipo.get(tipo)!.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = nombre;
        grupo.appendChild(opt);
      }
      selectItem.appendChild(grupo);
    }
    filaItem.appendChild(selectItem);

    const inputCantidad = document.createElement("input");
    inputCantidad.className = "panel-colony-input";
    inputCantidad.type = "number";
    inputCantidad.min = "1";
    inputCantidad.value = "1";
    inputCantidad.style.width = "50px";
    inputCantidad.style.marginLeft = "4px";
    filaItem.appendChild(inputCantidad);

    const btnDar = crearBoton("Dar", () => {
      const cantidad = Math.max(1, Math.floor(Number(inputCantidad.value) || 1));
      this.opciones.darItem(selectItem.value, cantidad);
    });
    btnDar.style.marginLeft = "4px";
    filaItem.appendChild(btnDar);

    // --- Farycoins (pedido 2026-09-02: dar/quitar dinero de la propia
    // cuenta de prueba, self-target, mismo gate jarl que el resto) ---
    cuerpo.appendChild(crearSubtitulo("Farycoins (cuenta propia)"));
    const filaCoins = this.fila(cuerpo);
    const inputCoins = document.createElement("input");
    inputCoins.className = "panel-colony-input";
    inputCoins.type = "number";
    inputCoins.step = "1";
    inputCoins.value = "100";
    inputCoins.style.width = "70px";
    filaCoins.appendChild(inputCoins);
    const btnDarCoins = crearBoton("Dar", () => {
      const cantidad = Math.trunc(Number(inputCoins.value) || 0);
      if (cantidad > 0) this.opciones.ajustarFarycoins(cantidad);
    });
    btnDarCoins.style.marginLeft = "4px";
    filaCoins.appendChild(btnDarCoins);
    const btnQuitarCoins = crearBoton("Quitar", () => {
      const cantidad = Math.trunc(Number(inputCoins.value) || 0);
      if (cantidad > 0) this.opciones.ajustarFarycoins(-cantidad);
    });
    btnQuitarCoins.style.marginLeft = "4px";
    filaCoins.appendChild(btnQuitarCoins);

    // --- Limpiar inventario ---
    cuerpo.appendChild(crearSubtitulo("Inventario"));
    const filaLimpiar = this.fila(cuerpo);
    filaLimpiar.appendChild(crearBoton("Limpiar inventario", () => this.opciones.limpiarInventario()));

    // --- God mode ---
    cuerpo.appendChild(crearSubtitulo("God mode"));
    const filaGod = this.fila(cuerpo);
    const labelGod = document.createElement("label");
    labelGod.style.cursor = "pointer";
    const checkGod = document.createElement("input");
    checkGod.type = "checkbox";
    checkGod.checked = this.godActivo;
    checkGod.onchange = () => {
      this.godActivo = checkGod.checked;
      this.opciones.godMode(this.godActivo);
    };
    labelGod.appendChild(checkGod);
    labelGod.appendChild(document.createTextNode(" activo"));
    filaGod.appendChild(labelGod);

    // --- Max oficio ---
    cuerpo.appendChild(crearSubtitulo("Max oficio"));
    const filaOficio = this.fila(cuerpo);
    filaOficio.appendChild(crearBoton("Slot 1 al máximo", () => this.opciones.maxOficio(1)));
    const btnOficio2 = crearBoton("Slot 2 al máximo", () => this.opciones.maxOficio(2));
    btnOficio2.style.marginLeft = "4px";
    filaOficio.appendChild(btnOficio2);

    // --- Resetear nodo ---
    cuerpo.appendChild(crearSubtitulo("Resetear nodo"));
    const filaNodo = this.fila(cuerpo);
    const inputNodo = document.createElement("input");
    inputNodo.className = "panel-colony-input";
    inputNodo.placeholder = "nodoId";
    inputNodo.style.width = "140px";
    filaNodo.appendChild(inputNodo);
    const btnNodo = crearBoton("Resetear", () => { if (inputNodo.value) this.opciones.resetearNodo(inputNodo.value); });
    btnNodo.style.marginLeft = "4px";
    filaNodo.appendChild(btnNodo);

    // --- Teleport rápido ---
    cuerpo.appendChild(crearSubtitulo("Teleport rápido"));
    for (const zona of ZONAS_ACTIVAS) {
      const filaZona = this.fila(cuerpo);
      filaZona.style.margin = "2px 0";
      const btnZona = crearBoton(zona.etiqueta, () => this.opciones.teleport(zona.x, zona.y));
      btnZona.style.width = "100%";
      filaZona.appendChild(btnZona);
    }

    // --- Resultado del último comando ---
    if (this.mensaje) {
      const filaMensaje = this.fila(cuerpo);
      filaMensaje.style.color = "var(--panel-texto-tenue)";
      filaMensaje.style.whiteSpace = "pre-wrap";
      filaMensaje.textContent = this.mensaje;
    }
  }
}
