/**
 * Panel de diálogo con un NPC (docs/GDD_IA_NPCs.md, pedido streamer
 * 2026-09-08: "ahondar en el tema de las conversaciones con IA NPC" — hasta
 * ahora `npc:hablar` solo se probaba desde tests, NINGÚN jugador real había
 * hablado nunca con un NPC porque no existía ninguna UI). Mismo patrón DOM
 * flotante + log de mensajes que `ui/chat.ts`, pero MODAL (una conversación
 * a la vez, con un NPC concreto) en vez de persistente — se abre/cierra con
 * la tecla H (game.ts) sobre el NPC no hostil más cercano.
 */
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
  private raiz: HTMLDivElement;
  private titulo: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private botonEnviar: HTMLButtonElement;
  private npcIdActual: string | null = null;
  private lineas: LineaDialogo[] = [];
  private esperandoRespuesta = false;

  constructor(private opciones: OpcionesPanelDialogoNpc) {
    this.raiz = document.createElement("div");
    this.raiz.dataset.testid = "panel-dialogo-npc";
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.bottom = "90px";
    this.raiz.style.transform = "translateX(-50%)";
    this.raiz.style.width = "360px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.borderRadius = "8px";
    this.raiz.style.border = "1px solid #8a6a3a";
    this.raiz.style.overflow = "hidden";
    this.raiz.style.zIndex = "60";
    this.raiz.hidden = true;

    this.titulo = document.createElement("div");
    this.titulo.style.padding = "8px 10px";
    this.titulo.style.fontWeight = "bold";
    this.titulo.style.borderBottom = "1px solid #6a5a3a";
    this.titulo.style.background = "rgba(106,90,58,0.35)";
    this.titulo.style.display = "flex";
    this.titulo.style.justifyContent = "space-between";
    this.raiz.appendChild(this.titulo);

    const botonCerrar = document.createElement("span");
    botonCerrar.textContent = "✕";
    botonCerrar.style.cursor = "pointer";
    botonCerrar.style.opacity = "0.7";
    botonCerrar.onclick = () => this.cerrar();

    this.log = document.createElement("div");
    this.log.style.height = "180px";
    this.log.style.overflowY = "auto";
    this.log.style.padding = "8px 10px";
    this.log.style.lineHeight = "1.4";
    this.raiz.appendChild(this.log);

    const filaInput = document.createElement("div");
    filaInput.style.display = "flex";
    filaInput.style.borderTop = "1px solid #6a5a3a";

    this.input = document.createElement("input");
    this.input.dataset.testid = "panel-dialogo-npc-input";
    this.input.type = "text";
    this.input.placeholder = "Escribe algo...";
    this.input.maxLength = 300;
    this.input.style.flex = "1 1 auto";
    this.input.style.background = "transparent";
    this.input.style.color = "#f0e8d8";
    this.input.style.border = "none";
    this.input.style.outline = "none";
    this.input.style.padding = "8px 10px";
    this.input.style.font = "13px sans-serif";
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
    this.botonEnviar.textContent = "Hablar";
    this.botonEnviar.style.flex = "0 0 auto";
    this.botonEnviar.style.background = "rgba(106,90,58,0.6)";
    this.botonEnviar.style.color = "#f0e8d8";
    this.botonEnviar.style.border = "none";
    this.botonEnviar.style.borderLeft = "1px solid #6a5a3a";
    this.botonEnviar.style.padding = "8px 12px";
    this.botonEnviar.style.cursor = "pointer";
    this.botonEnviar.style.font = "12px sans-serif";
    this.botonEnviar.onclick = () => this.enviarDesdeInput();
    filaInput.appendChild(this.botonEnviar);

    this.raiz.appendChild(filaInput);
    this.titulo.appendChild(document.createTextNode(""));
    this.titulo.appendChild(botonCerrar);
    opciones.contenedor.appendChild(this.raiz);
  }

  estaAbierto(): boolean {
    return !this.raiz.hidden;
  }

  /** `undefined` si el panel está cerrado — para que game.ts sepa si la tecla H debe abrir uno nuevo o cerrar el actual. */
  npcAbierto(): string | undefined {
    return this.raiz.hidden ? undefined : (this.npcIdActual ?? undefined);
  }

  /** Abre la conversación con un NPC nuevo — limpia el historial visual de cualquier charla anterior (cada NPC es una conversación propia, mismo criterio que un chat 1:1 nuevo). */
  abrirCon(npcId: string, nombre: string) {
    this.npcIdActual = npcId;
    this.lineas = [];
    this.esperandoRespuesta = false;
    this.titulo.childNodes[0].textContent = nombre || npcId;
    this.raiz.hidden = false;
    this.renderizarLog();
    this.input.focus();
  }

  cerrar() {
    this.raiz.hidden = true;
    this.npcIdActual = null;
    this.input.blur();
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
