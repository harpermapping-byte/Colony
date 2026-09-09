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

export interface OpcionesPanelDialogoNpc {
  contenedor: HTMLElement;
  enviarMensaje(npcId: string, texto: string): void;
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

  /** Abre la conversación con un NPC nuevo — limpia el historial visual de cualquier charla anterior (cada NPC es una conversación propia, mismo criterio que un chat 1:1 nuevo). */
  abrirCon(npcId: string, nombre: string) {
    this.npcIdActual = npcId;
    this.lineas = [];
    this.esperandoRespuesta = false;
    this.nombreNpc.textContent = nombre || npcId;
    this.marco.abrir();
    this.renderizarLog();
    this.input.focus();
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
