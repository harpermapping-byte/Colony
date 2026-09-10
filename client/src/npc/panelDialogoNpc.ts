/**
 * Panel de diálogo con un NPC (docs/GDD_IA_NPCs.md, pedido streamer
 * 2026-09-08: "ahondar en el tema de las conversaciones con IA NPC" — hasta
 * ahora `npc:hablar` solo se probaba desde tests, NINGÚN jugador real había
 * hablado nunca con un NPC porque no existía ninguna UI). Mismo patrón DOM
 * flotante + log de mensajes que `ui/chat.ts`, pero MODAL (una conversación
 * a la vez, con un NPC concreto) en vez de persistente — se abre/cierra con
 * la tecla H (game.ts) sobre el NPC no hostil más cercano.
 */
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

// Mismos 10 ids que server/src/personaje/oficios.ts::OFICIOS_JUGADOR_VALIDOS
// (fuente de verdad real) — duplicado consciente porque cliente/servidor son
// proyectos TS separados sin import cruzado, mismo criterio ya aceptado en
// el repo para catálogos pequeños (p.ej. ropa/src/generarEquipo.js y su
// copia sincronizada client/src/render3d/generarEquipoVoxel.ts). Los ids ya
// son la palabra española real (nombreDisplay solo capitaliza).
const OFICIOS_JUGADOR = [
  "herrero", "carpintero", "ingeniero", "picapedrero", "molinero",
  "cazador", "cocinero", "curandero", "curtidor", "joyero",
] as const;

function nombreDisplayOficio(oficio: string): string {
  return oficio.charAt(0).toUpperCase() + oficio.slice(1);
}

export interface OpcionesPanelDialogoNpc {
  contenedor: HTMLElement;
  enviarMensaje(npcId: string, texto: string): void;
  /** Slot vacío -> `oficio:elegir` (gratis); slot ocupado -> `oficio:cambiar` (de pago, el servidor informa el precio en la respuesta/error). */
  elegirOficio(oficio: string): void;
  cambiarOficio(slot: 1 | 2, oficio: string): void;
}

interface LineaDialogo {
  quien: "jugador" | "npc" | "error";
  texto: string;
}

const MAX_LINEAS = 40;

export class PanelDialogoNpc {
  private readonly marco: MarcoPanel;
  private nombreNpc: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private botonEnviar: HTMLButtonElement;
  private npcIdActual: string | null = null;
  private lineas: LineaDialogo[] = [];
  private esperandoRespuesta = false;
  private readonly selectorOficios: HTMLDivElement;
  private confirmandoReemplazoDe: string | null = null; // oficio nuevo pendiente de elegir qué slot reemplaza, null = sin confirmación abierta
  // Copia LOCAL de oficio1/oficio2 mientras el selector está abierto — nunca
  // se relee de room.state al recibir oficio:elegido/cambiado a propósito:
  // el mensaje llega por su propio canal, más rápido que el siguiente patch
  // de Schema (15hz), así que leer room.state en ese instante daba el valor
  // VIEJO (bug real encontrado con el e2e: el toast salía pero el botón
  // nunca pasaba a "✓"). `slot`/`oficio` del propio mensaje del servidor ya
  // dicen exactamente qué cambió, sin depender de ninguna carrera de red.
  private oficiosActuales: { oficio1: string; oficio2: string } | null = null;

  constructor(private opciones: OpcionesPanelDialogoNpc) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Hablar", icono: "💬", left: "50%", ancho: "360px" });
    this.marco.raiz.style.transform = "translateX(-50%)";
    this.marco.raiz.style.top = "auto";
    this.marco.raiz.style.bottom = "90px";
    this.marco.raiz.dataset.testid = "panel-dialogo-npc";
    // Cerrar por clic-fuera/Escape lo gestiona ya crearMarcoPanel — pero eso
    // pasa por SU cierre interno, no por nuestro `cerrar()` (que además
    // limpia npcIdActual y quita el foco del input). npcAbierto() ya gatea
    // por `marco.estaAbierto()` así que no rompe nada dejarlo sin limpiar,
    // pero limpiarlo aquí evita arrastrar un npcId viejo al siguiente abrirCon.
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) {
        this.npcIdActual = null;
        this.oficiosActuales = null;
        this.input.blur();
      }
    });

    const cuerpo = this.marco.cuerpo;
    cuerpo.style.padding = "0"; // el log/input propios ya traen su padding — el del marco duplicaría el margen

    this.nombreNpc = document.createElement("div");
    this.nombreNpc.style.padding = "6px 10px 0";
    this.nombreNpc.style.fontSize = "12px";
    this.nombreNpc.style.opacity = "0.85";
    cuerpo.appendChild(this.nombreNpc);

    // Bloque de "elegir/cambiar oficio" — SOLO se rellena/muestra cuando
    // abrirCon() detecta que el NPC es el maestro de oficios (game.ts, vía
    // Npc.tipoTutorial==="tutorial_oficios"). Vive dentro del mismo panel de
    // diálogo en vez de uno aparte a propósito: es literalmente de qué se
    // habla con ESE NPC, no una mecánica independiente.
    this.selectorOficios = document.createElement("div");
    this.selectorOficios.hidden = true;
    this.selectorOficios.style.padding = "8px 10px";
    this.selectorOficios.style.borderBottom = "1px solid var(--panel-borde-tallado)";
    cuerpo.appendChild(this.selectorOficios);

    this.log = document.createElement("div");
    this.log.style.height = "180px";
    this.log.style.overflowY = "auto";
    this.log.style.padding = "8px 10px";
    this.log.style.lineHeight = "1.4";
    cuerpo.appendChild(this.log);

    const filaInput = document.createElement("div");
    filaInput.style.display = "flex";
    filaInput.style.borderTop = "1px solid var(--panel-borde-tallado)";

    this.input = document.createElement("input");
    this.input.className = "panel-colony-input";
    this.input.dataset.testid = "panel-dialogo-npc-input";
    this.input.type = "text";
    this.input.placeholder = "Escribe algo...";
    this.input.maxLength = 300;
    this.input.style.flex = "1 1 auto";
    this.input.style.border = "none";
    this.input.style.borderRadius = "0";
    this.input.style.minWidth = "0";
    this.input.onkeydown = (e) => {
      // stopPropagation: mismo motivo que ui/chat.ts — sin esto, cada tecla
      // dispara TAMBIÉN el atajo de juego correspondiente (H incluida).
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.enviarDesdeInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cerrar();
      }
    };
    filaInput.appendChild(this.input);

    this.botonEnviar = document.createElement("button");
    this.botonEnviar.className = "panel-colony-boton";
    this.botonEnviar.textContent = "Hablar";
    this.botonEnviar.style.flex = "0 0 auto";
    this.botonEnviar.style.borderRadius = "0";
    this.botonEnviar.onclick = () => this.enviarDesdeInput();
    filaInput.appendChild(this.botonEnviar);

    cuerpo.appendChild(filaInput);
  }

  estaAbierto(): boolean {
    return this.marco.estaAbierto();
  }

  /** Dock (docs/GDD_UI_Paneles.md) — se dispara en cada abrir/cerrar por cualquier vía. */
  onCambioEstado(cb: () => void): void {
    this.marco.onCambioEstado(cb);
  }

  /** `undefined` si el panel está cerrado — para que game.ts sepa si la tecla H debe abrir uno nuevo o cerrar el actual. */
  npcAbierto(): string | undefined {
    return this.marco.estaAbierto() ? (this.npcIdActual ?? undefined) : undefined;
  }

  /**
   * Abre la conversación con un NPC nuevo — limpia el historial visual de
   * cualquier charla anterior (cada NPC es una conversación propia, mismo
   * criterio que un chat 1:1 nuevo). `datosOficios` presente = este NPC es
   * el maestro de oficios (game.ts lo decide por `Npc.tipoTutorial ===
   * "tutorial_oficios"`) — muestra el selector de oficios; ausente = panel
   * de charla normal, sin selector.
   */
  abrirCon(npcId: string, nombre: string, datosOficios?: { oficio1: string; oficio2: string }) {
    this.npcIdActual = npcId;
    this.lineas = [];
    this.esperandoRespuesta = false;
    this.confirmandoReemplazoDe = null;
    this.nombreNpc.textContent = nombre || npcId;
    this.oficiosActuales = datosOficios ?? null;
    if (datosOficios) {
      this.selectorOficios.hidden = false;
      this.renderizarSelectorOficios(datosOficios.oficio1, datosOficios.oficio2);
    } else {
      this.selectorOficios.hidden = true;
    }
    this.marco.abrir();
    this.renderizarLog();
    this.input.focus();
  }

  /** Tras `oficio:elegido` (game.ts, slot 1|2) — refresca el selector con el slot que el SERVIDOR acaba de confirmar, sin depender del siguiente patch de Schema. No-op si el selector no está activo ahora mismo. */
  aplicarOficioElegido(slot: number, oficio: string) {
    this.aplicarCambioDeSlot(slot, oficio);
  }

  /** Tras `oficio:cambiado` — mismo criterio que aplicarOficioElegido. */
  aplicarOficioCambiado(slot: number, oficio: string) {
    this.aplicarCambioDeSlot(slot, oficio);
  }

  private aplicarCambioDeSlot(slot: number, oficio: string) {
    if (!this.oficiosActuales) return; // panel cerrado, o hablando con un NPC que no es el maestro de oficios
    if (slot === 1) this.oficiosActuales.oficio1 = oficio;
    else if (slot === 2) this.oficiosActuales.oficio2 = oficio;
    else return;
    this.confirmandoReemplazoDe = null;
    this.renderizarSelectorOficios(this.oficiosActuales.oficio1, this.oficiosActuales.oficio2);
  }

  private renderizarSelectorOficios(oficio1: string, oficio2: string) {
    this.selectorOficios.innerHTML = "";

    const cabecera = document.createElement("div");
    cabecera.style.fontSize = "12px";
    cabecera.style.marginBottom = "6px";
    cabecera.style.opacity = "0.85";
    const elegidos = [oficio1, oficio2].filter((o) => o !== "");
    cabecera.textContent = elegidos.length === 0
      ? "Aún no tienes ningún oficio — elige uno gratis:"
      : `Tus oficios: ${elegidos.map(nombreDisplayOficio).join(", ")}${elegidos.length < 2 ? " — te queda un hueco libre" : ""}.`;
    this.selectorOficios.appendChild(cabecera);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "1fr 1fr";
    grid.style.gap = "4px";
    this.selectorOficios.appendChild(grid);

    const haySlotVacio = oficio1 === "" || oficio2 === "";
    for (const oficio of OFICIOS_JUGADOR) {
      const boton = document.createElement("button");
      boton.className = "panel-colony-boton";
      boton.style.fontSize = "11px";
      boton.style.padding = "4px 2px";
      const yaLoTiene = oficio === oficio1 || oficio === oficio2;
      if (yaLoTiene) {
        boton.textContent = `✓ ${nombreDisplayOficio(oficio)}`;
        boton.disabled = true;
        boton.style.opacity = "0.6";
      } else {
        boton.textContent = nombreDisplayOficio(oficio);
        boton.onclick = () => {
          if (haySlotVacio) {
            this.opciones.elegirOficio(oficio);
          } else {
            // Ya tiene los 2 slots llenos — hace falta elegir cuál reemplazar (cuesta Farycoins). Un segundo clic en el MISMO oficio cierra la confirmación sin mandar nada.
            this.confirmandoReemplazoDe = this.confirmandoReemplazoDe === oficio ? null : oficio;
            this.renderizarSelectorOficios(oficio1, oficio2);
          }
        };
      }
      grid.appendChild(boton);
    }

    if (!haySlotVacio && this.confirmandoReemplazoDe) {
      const nuevo = this.confirmandoReemplazoDe;
      const aviso = document.createElement("div");
      aviso.style.marginTop = "6px";
      aviso.style.fontSize = "11px";
      aviso.textContent = `¿Qué oficio reemplaza ${nombreDisplayOficio(nuevo)}? Cuesta Farycoins (sube cada vez que cambias) y pierdes toda la XP del que sueltes.`;
      this.selectorOficios.appendChild(aviso);

      const filaBotones = document.createElement("div");
      filaBotones.style.display = "flex";
      filaBotones.style.gap = "4px";
      filaBotones.style.marginTop = "4px";
      for (const [slot, actual] of [[1, oficio1], [2, oficio2]] as const) {
        const b = document.createElement("button");
        b.className = "panel-colony-boton";
        b.style.fontSize = "11px";
        b.style.flex = "1 1 0";
        b.textContent = `Reemplazar ${nombreDisplayOficio(actual)}`;
        b.onclick = () => {
          this.confirmandoReemplazoDe = null;
          this.opciones.cambiarOficio(slot, nuevo);
        };
        filaBotones.appendChild(b);
      }
      this.selectorOficios.appendChild(filaBotones);
    }
  }

  cerrar() {
    this.marco.cerrar();
  }

  private enviarDesdeInput() {
    const texto = this.input.value.trim();
    this.input.value = "";
    if (!texto || !this.npcIdActual || this.esperandoRespuesta) return;
    this.lineas.push({ quien: "jugador", texto });
    this.esperandoRespuesta = true; // cooldown real lo aplica el servidor; esto solo evita machacar "Enviar" mientras se espera
    this.renderizarLog();
    this.opciones.enviarMensaje(this.npcIdActual, texto);
  }

  /** Llamar desde `room.onMessage("npc:respuesta", ...)`. Ignora respuestas de un NPC que ya no es el abierto (el jugador cerró/cambió de conversación mientras la IA respondía). */
  recibirRespuesta(npcId: string, texto: string) {
    this.esperandoRespuesta = false;
    if (npcId !== this.npcIdActual) return;
    this.lineas.push({ quien: "npc", texto });
    this.recortarYRenderizar();
  }

  /** Llamar desde `room.onMessage("npc:error", ...)`. */
  recibirError(npcId: string, motivo: string) {
    this.esperandoRespuesta = false;
    if (npcId !== this.npcIdActual) return;
    this.lineas.push({ quien: "error", texto: motivo });
    this.recortarYRenderizar();
  }

  private recortarYRenderizar() {
    if (this.lineas.length > MAX_LINEAS) this.lineas = this.lineas.slice(-MAX_LINEAS);
    this.renderizarLog();
  }

  private renderizarLog() {
    this.log.innerHTML = "";
    for (const l of this.lineas) {
      const linea = document.createElement("div");
      linea.style.wordBreak = "break-word";
      linea.style.marginBottom = "4px";
      if (l.quien === "jugador") {
        linea.style.color = "#c8d8f0";
        linea.textContent = `Tú: ${l.texto}`;
      } else if (l.quien === "error") {
        linea.style.color = "#e08060";
        linea.style.fontStyle = "italic";
        linea.textContent = l.texto;
      } else {
        linea.style.color = "#f0e0a0";
        // textContent, nunca innerHTML — la respuesta viene de un proveedor
        // de IA externo (Gemini/Groq), contenido NO confiable igual que el
        // texto de otro jugador en ui/chat.ts.
        linea.textContent = l.texto;
      }
      this.log.appendChild(linea);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }
}
