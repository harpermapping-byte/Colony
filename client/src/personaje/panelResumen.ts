/**
 * Panel "todo lo que tienes" (docs/GDD_Resumen_Jugador.md, pedido
 * 2026-08-31): *"monturas, animales, propiedades y NPC que tenga un
 * jugador le saldrán en una pestaña que se abre en algún menú... es como un
 * menú donde se ve que tienes y dónde y cómo está."* Overlay a pantalla
 * completa (mismo patrón visual que `panelMapaMundo.ts`), tres secciones:
 *
 * - **Monturas**: NO pide nada nuevo al servidor — `game.ts` ya recibe
 *   "mascota:lista" para `PanelMascotas`, este panel solo se apunta al
 *   mismo dato (`actualizarMascotas`).
 * - **Compañero**: NO pide nada nuevo — vive en `room.state.companeros`
 *   (Colyseus, ya en vivo), `game.ts` ya lo espeja para `PanelCompanero`,
 *   este panel se apunta a la misma actualización (`actualizarCompanero`).
 * - **Propiedades**: la única pieza que no existía en ningún sitio —
 *   `propiedad:listarMias` → `propiedad:misPropiedades`, pedido fresco cada
 *   vez que se abre (mismo criterio "snapshot bajo demanda, sin push
 *   continuo" que `mapa:consultarExploracion`).
 *
 * Tecla temporal (pedido explícito: "ahora lo ponemos en cualquier tecla y
 * se cambiará" — de sobra para un v1, todavía no hay un menú de pestañas
 * real donde encajarlo): **Tab**, la única letra/tecla libre que quedaba
 * (las 26 letras del teclado ya están todas asignadas a otra cosa).
 */
import type { MascotaVista } from "../mascotas/panelMascotas";
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

export interface PropiedadVista {
  id: string;
  tipo: string;
  asentamiento: string;
  modoTenencia: "compra" | "alquiler" | null;
  precioFarycoins: number | null;
  expiraEn: string | null;
  impuestoActivo: boolean;
  impuestoFarycoins: number | null;
  impuestoPeriodoHoras: number | null;
}

export interface CompaneroVista {
  nombre: string;
  nivel: number;
  vida: number;
  vidaMax: number;
  x: number;
  y: number;
  quejaTexto: string;
}

export interface OpcionesPanelResumen {
  contenedor: HTMLElement;
  /** Pide el snapshot fresco de propiedades — la respuesta llega por `actualizarPropiedades`. */
  consultarPropiedades(): void;
}

export class PanelResumen {
  // Fondo oscurecido de pantalla completa — mismo criterio que
  // panelMapaMundo.ts (crearMarcoPanel da una tarjeta flotante, no un
  // overlay a pantalla completa; la tarjeta se monta DENTRO de este fondo
  // para que el "clic fuera cierra" de crearMarcoPanel, que mide contra
  // `marco.raiz`, caiga sobre el fondo y cierre igual que antes).
  private readonly fondo: HTMLDivElement;
  private readonly marco: MarcoPanel;
  private mascotas: MascotaVista[] = [];
  private propiedades: PropiedadVista[] | null = null; // null = todavía no ha llegado ningún snapshot
  private companero: CompaneroVista | null = null;

  constructor(private readonly opciones: OpcionesPanelResumen) {
    this.fondo = document.createElement("div");
    this.fondo.style.position = "fixed";
    this.fondo.style.inset = "0";
    this.fondo.style.background = "rgba(0,0,0,0.7)";
    this.fondo.style.display = "none";
    this.fondo.style.zIndex = "70";
    this.fondo.style.alignItems = "center";
    this.fondo.style.justifyContent = "center";
    document.body.appendChild(this.fondo);

    this.marco = crearMarcoPanel({ contenedor: this.fondo, titulo: "Lo que tienes", icono: "🎒", ancho: "420px" });
    this.marco.raiz.style.position = "relative"; // el fondo ya centra con flex — el position:absolute del tema rompería el centrado
    this.marco.onCambioEstado(() => {
      this.fondo.style.display = this.marco.estaAbierto() ? "flex" : "none";
      if (this.marco.estaAbierto()) {
        this.opciones.consultarPropiedades(); // siempre pide fresco al abrir — barato, un solo mensaje
        this.render();
      }
    });
  }

  /** Llamar al recibir "mascota:lista" del servidor (mismo dato que PanelMascotas). */
  actualizarMascotas(mascotas: MascotaVista[]): void {
    this.mascotas = mascotas;
    if (this.marco.estaAbierto()) this.render();
  }

  /** Llamar al recibir "propiedad:misPropiedades" del servidor. */
  actualizarPropiedades(propiedades: PropiedadVista[]): void {
    this.propiedades = propiedades;
    if (this.marco.estaAbierto()) this.render();
  }

  /** Llamar en cada cambio del compañero propio (mismo `c` que ya alimenta a PanelCompanero) — null si no tiene. */
  actualizarCompanero(companero: CompaneroVista | null): void {
    this.companero = companero;
    if (this.marco.estaAbierto()) this.render();
  }

  alternar(): void {
    this.marco.alternar();
  }

  estaAbierto(): boolean {
    return this.marco.estaAbierto();
  }

  /** Dock (docs/GDD_UI_Paneles.md) — se dispara en cada abrir/cerrar por cualquier vía (X, clic fuera, Escape, Tab). */
  onCambioEstado(cb: () => void): void {
    this.marco.onCambioEstado(cb);
  }

  private render(): void {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    const ayuda = document.createElement("div");
    ayuda.style.opacity = "0.7";
    ayuda.style.fontSize = "11px";
    ayuda.style.marginBottom = "8px";
    ayuda.textContent = "Tab o Escape para cerrar";
    cuerpo.appendChild(ayuda);

    cuerpo.appendChild(this.seccionMonturas());
    cuerpo.appendChild(this.seccionPropiedades());
    cuerpo.appendChild(this.seccionCompanero());
  }

  private encabezado(texto: string): HTMLDivElement {
    const h = document.createElement("div");
    h.style.fontWeight = "bold";
    h.style.marginTop = "12px";
    h.style.marginBottom = "6px";
    h.style.borderBottom = "1px solid #4a3a6a";
    h.style.paddingBottom = "3px";
    h.textContent = texto;
    return h;
  }

  private vacio(texto: string): HTMLDivElement {
    const v = document.createElement("div");
    v.style.opacity = "0.6";
    v.style.fontSize = "12px";
    v.textContent = texto;
    return v;
  }

  private seccionMonturas(): DocumentFragment {
    const frag = document.createDocumentFragment();
    frag.appendChild(this.encabezado(`🐾 Monturas (${this.mascotas.length})`));
    if (this.mascotas.length === 0) {
      frag.appendChild(this.vacio("Ninguna todavía."));
      return frag;
    }
    for (const m of this.mascotas) {
      const fila = document.createElement("div");
      fila.style.fontSize = "12px";
      fila.style.marginBottom = "2px";
      const etiquetaMontura = m.montura ? " 🐴 (con silla)" : "";
      const donde = m.ubicacion === "siguiendo" ? "te sigue" : `dejada en ${m.propiedadId}`;
      fila.textContent = `${m.especieId}${etiquetaMontura} — ${donde}`;
      frag.appendChild(fila);
    }
    return frag;
  }

  private seccionPropiedades(): DocumentFragment {
    const frag = document.createDocumentFragment();
    frag.appendChild(this.encabezado(`🏠 Propiedades${this.propiedades ? ` (${this.propiedades.length})` : ""}`));
    if (this.propiedades === null) {
      frag.appendChild(this.vacio("cargando…"));
      return frag;
    }
    if (this.propiedades.length === 0) {
      frag.appendChild(this.vacio("Ninguna todavía."));
      return frag;
    }
    for (const p of this.propiedades) {
      const fila = document.createElement("div");
      fila.style.fontSize = "12px";
      fila.style.marginBottom = "2px";
      const tenencia = p.modoTenencia === "alquiler" ? `alquilada${p.expiraEn ? ` hasta ${new Date(p.expiraEn).toLocaleDateString()}` : ""}` : p.modoTenencia === "compra" ? "comprada" : "asignada";
      const impuesto = p.impuestoActivo ? ` · impuesto ${p.impuestoFarycoins}₣/${p.impuestoPeriodoHoras}h` : "";
      fila.textContent = `${p.tipo} "${p.id}" en ${p.asentamiento} — ${tenencia}${impuesto}`;
      frag.appendChild(fila);
    }
    return frag;
  }

  private seccionCompanero(): DocumentFragment {
    const frag = document.createDocumentFragment();
    frag.appendChild(this.encabezado("🛡️ Compañero"));
    if (!this.companero) {
      frag.appendChild(this.vacio("Sin compañero todavía."));
      return frag;
    }
    const c = this.companero;
    const fila = document.createElement("div");
    fila.style.fontSize = "12px";
    fila.textContent = `${c.nombre} — nivel ${c.nivel} — vida ${Math.round(c.vida)}/${Math.round(c.vidaMax)} — en (${Math.round(c.x)}, ${Math.round(c.y)})`;
    frag.appendChild(fila);
    if (c.quejaTexto) {
      const queja = document.createElement("div");
      queja.style.fontSize = "11px";
      queja.style.opacity = "0.75";
      queja.style.fontStyle = "italic";
      queja.textContent = `"${c.quejaTexto}"`;
      frag.appendChild(queja);
    }
    return frag;
  }
}
