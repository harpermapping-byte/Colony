/**
 * Panel de debug de la Test Zone (docs/GDD_Admin.md, pedido 2026-08-31):
 * "los comandos que sea una tabla con opciones para aplicar que no tenga
 * que escribirlos yo" — TODO clicable, nada de escribir comandos a mano.
 * Envuelve los mensajes `admin:debug:*` que expone RoomExteriorBase
 * (gateados a jarl/superadmin en servidor; aquí solo se muestra si ya hay
 * sesión de admin confirmada, mismo criterio que PanelJarl). El servidor
 * es la autoridad: si el jugador no es jarl del mapa, cada botón simplemente
 * responde `admin:error` y aquí se refleja el mensaje sin más drama.
 */
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
  { etiqueta: "Portal a la aldea", x: 57, y: 32 },
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
  private raiz: HTMLDivElement;
  private visible = true;
  private mensaje = "";
  private godActivo = false;

  constructor(private opciones: OpcionesPanelDebugTestZone) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "16px";
    this.raiz.style.bottom = "16px";
    this.raiz.style.background = "rgba(20,14,24,0.92)";
    this.raiz.style.color = "#f0e0f8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #7a4a8a";
    this.raiz.style.minWidth = "280px";
    this.raiz.style.maxHeight = "70vh";
    this.raiz.style.overflowY = "auto";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  alternar() {
    this.visible = !this.visible;
    this.render();
  }

  estaVisible(): boolean {
    return this.visible;
  }

  mostrarResultado(texto: string) {
    this.mensaje = texto;
    this.render();
  }

  private fila(): HTMLDivElement {
    const div = document.createElement("div");
    div.style.margin = "4px 0";
    this.raiz.appendChild(div);
    return div;
  }

  private separador(titulo: string) {
    const div = document.createElement("div");
    div.style.marginTop = "8px";
    div.style.paddingTop = "6px";
    div.style.borderTop = "1px solid #7a4a8a";
    div.style.fontWeight = "bold";
    div.textContent = titulo;
    this.raiz.appendChild(div);
  }

  private render() {
    this.raiz.innerHTML = "";
    if (!this.visible) {
      const chip = document.createElement("div");
      chip.style.opacity = "0.7";
      chip.textContent = "🛠️ Panel de debug (F9 para abrir)";
      this.raiz.appendChild(chip);
      return;
    }

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.textContent = "🛠️ Debug Test Zone (F9 para cerrar)";
    this.raiz.appendChild(titulo);

    // --- Dar item ---
    this.separador("Dar ítem");
    const filaItem = this.fila();
    const selectItem = document.createElement("select");
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
    inputCantidad.type = "number";
    inputCantidad.min = "1";
    inputCantidad.value = "1";
    inputCantidad.style.width = "50px";
    inputCantidad.style.marginLeft = "4px";
    filaItem.appendChild(inputCantidad);

    const btnDar = document.createElement("button");
    btnDar.textContent = "Dar";
    btnDar.style.marginLeft = "4px";
    btnDar.onclick = () => {
      const cantidad = Math.max(1, Math.floor(Number(inputCantidad.value) || 1));
      this.opciones.darItem(selectItem.value, cantidad);
    };
    filaItem.appendChild(btnDar);

    // --- Farycoins (pedido 2026-09-02: dar/quitar dinero de la propia
    // cuenta de prueba, self-target, mismo gate jarl que el resto) ---
    this.separador("Farycoins (cuenta propia)");
    const filaCoins = this.fila();
    const inputCoins = document.createElement("input");
    inputCoins.type = "number";
    inputCoins.step = "1";
    inputCoins.value = "100";
    inputCoins.style.width = "70px";
    filaCoins.appendChild(inputCoins);
    const btnDarCoins = document.createElement("button");
    btnDarCoins.textContent = "Dar";
    btnDarCoins.style.marginLeft = "4px";
    btnDarCoins.onclick = () => {
      const cantidad = Math.trunc(Number(inputCoins.value) || 0);
      if (cantidad > 0) this.opciones.ajustarFarycoins(cantidad);
    };
    filaCoins.appendChild(btnDarCoins);
    const btnQuitarCoins = document.createElement("button");
    btnQuitarCoins.textContent = "Quitar";
    btnQuitarCoins.style.marginLeft = "4px";
    btnQuitarCoins.onclick = () => {
      const cantidad = Math.trunc(Number(inputCoins.value) || 0);
      if (cantidad > 0) this.opciones.ajustarFarycoins(-cantidad);
    };
    filaCoins.appendChild(btnQuitarCoins);

    // --- Limpiar inventario ---
    this.separador("Inventario");
    const filaLimpiar = this.fila();
    const btnLimpiar = document.createElement("button");
    btnLimpiar.textContent = "Limpiar inventario";
    btnLimpiar.onclick = () => this.opciones.limpiarInventario();
    filaLimpiar.appendChild(btnLimpiar);

    // --- God mode ---
    this.separador("God mode");
    const filaGod = this.fila();
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
    this.separador("Max oficio");
    const filaOficio = this.fila();
    const btnOficio1 = document.createElement("button");
    btnOficio1.textContent = "Slot 1 al máximo";
    btnOficio1.onclick = () => this.opciones.maxOficio(1);
    filaOficio.appendChild(btnOficio1);
    const btnOficio2 = document.createElement("button");
    btnOficio2.textContent = "Slot 2 al máximo";
    btnOficio2.style.marginLeft = "4px";
    btnOficio2.onclick = () => this.opciones.maxOficio(2);
    filaOficio.appendChild(btnOficio2);

    // --- Resetear nodo ---
    this.separador("Resetear nodo");
    const filaNodo = this.fila();
    const inputNodo = document.createElement("input");
    inputNodo.placeholder = "nodoId";
    inputNodo.style.width = "140px";
    filaNodo.appendChild(inputNodo);
    const btnNodo = document.createElement("button");
    btnNodo.textContent = "Resetear";
    btnNodo.style.marginLeft = "4px";
    btnNodo.onclick = () => { if (inputNodo.value) this.opciones.resetearNodo(inputNodo.value); };
    filaNodo.appendChild(btnNodo);

    // --- Teleport rápido ---
    this.separador("Teleport rápido");
    for (const zona of ZONAS_ACTIVAS) {
      const filaZona = this.fila();
      filaZona.style.margin = "2px 0";
      const btnZona = document.createElement("button");
      btnZona.textContent = zona.etiqueta;
      btnZona.style.width = "100%";
      btnZona.onclick = () => this.opciones.teleport(zona.x, zona.y);
      filaZona.appendChild(btnZona);
    }

    // --- Resultado del último comando ---
    if (this.mensaje) {
      const filaMensaje = this.fila();
      filaMensaje.style.opacity = "0.85";
      filaMensaje.style.whiteSpace = "pre-wrap";
      filaMensaje.textContent = this.mensaje;
    }
  }
}
