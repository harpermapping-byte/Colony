/**
 * Chat entre jugadores (docs/GDD_Mecanicas.md §5.12, pedido 2026-09-02:
 * "literalmente no existe ningún canal local/global para que dos jugadores
 * se hablen" — hasta ahora el único "hablar" era npc:hablar, con IA, nunca
 * con otro jugador). Dos canales, mismo mensaje `chat:mensaje` del
 * servidor (server/src/rooms/base/RoomExteriorBase.ts):
 * - "local": solo llega a quien esté cerca (RADIO_CHAT_LOCAL del servidor).
 * - "global": llega a toda la room (Hub/región/interior/mazmorra/arena).
 *
 * DOM plano inyectado sobre el canvas, mismo patrón que panelCombate.ts —
 * nada de framework (`crearMarcoPanel` cierra del todo con la X; el chat es
 * una pieza permanente del HUD que solo se MINIMIZA, nunca desaparece por
 * completo — no encaja en ese contrato). Panel PERSISTENTE (a diferencia de
 * un panel modal): el log de mensajes siempre está visible, el input solo
 * se activa con Enter (mismo atajo universal de chat de cualquier MMO) para
 * no robarle el teclado al movimiento mientras no se está escribiendo.
 *
 * Minimizable (pedido streamer 2026-09-09: "el chat se tiene que poder
 * minimizar con una tecla como la X arriba derecha") — cabecera propia con
 * el mismo botón redondo del resto del HUD (`temaPaneles.css::
 * .chat-colony-minimizar`); minimizado deja solo la cabecera visible (log +
 * input ocultos, nunca destruidos: los mensajes que lleguen mientras está
 * minimizado siguen acumulándose para cuando se reabra).
 */

export interface OpcionesPanelChat {
  contenedor: HTMLElement;
  enviarMensaje(texto: string, canal: "local" | "global"): void;
}

interface MensajeChatVista {
  sessionId: string;
  nombre: string;
  texto: string;
  canal: "local" | "global";
  ts: number;
}

const MAX_MENSAJES_VISIBLES = 50;

export class PanelChat {
  private raiz: HTMLDivElement;
  private cuerpo: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private botonCanal: HTMLButtonElement;
  private botonMinimizar: HTMLButtonElement;
  private canal: "local" | "global" = "local";
  private mensajes: MensajeChatVista[] = [];
  private minimizado = false;

  constructor(private opciones: OpcionesPanelChat) {
    this.raiz = document.createElement("div");
    this.raiz.dataset.testid = "panel-chat";
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "12px";
    this.raiz.style.bottom = "12px";
    this.raiz.style.width = "300px";
    this.raiz.style.background = "rgba(20,16,10,0.72)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.overflow = "hidden";

    const cabecera = document.createElement("div");
    cabecera.className = "chat-colony-cabecera";
    const etiquetaCabecera = document.createElement("span");
    etiquetaCabecera.textContent = "💬 Chat";
    cabecera.appendChild(etiquetaCabecera);
    this.botonMinimizar = document.createElement("button");
    this.botonMinimizar.className = "chat-colony-minimizar";
    this.botonMinimizar.title = "Minimizar";
    this.botonMinimizar.dataset.testid = "chat-minimizar";
    this.botonMinimizar.textContent = "–";
    this.botonMinimizar.onclick = () => {
      this.minimizado = !this.minimizado;
      this.actualizarMinimizado();
    };
    cabecera.appendChild(this.botonMinimizar);
    this.raiz.appendChild(cabecera);

    this.cuerpo = document.createElement("div");
    this.raiz.appendChild(this.cuerpo);

    this.log = document.createElement("div");
    this.log.style.height = "150px";
    this.log.style.overflowY = "auto";
    this.log.style.padding = "6px 8px";
    this.log.style.lineHeight = "1.35";
    this.cuerpo.appendChild(this.log);

    const filaInput = document.createElement("div");
    filaInput.style.display = "flex";
    filaInput.style.borderTop = "1px solid #6a5a3a";

    this.botonCanal = document.createElement("button");
    this.botonCanal.dataset.testid = "panel-chat-canal";
    this.botonCanal.style.flex = "0 0 auto";
    this.botonCanal.style.background = "rgba(106,90,58,0.6)";
    this.botonCanal.style.color = "#f0e8d8";
    this.botonCanal.style.border = "none";
    this.botonCanal.style.borderRight = "1px solid #6a5a3a";
    this.botonCanal.style.padding = "6px 8px";
    this.botonCanal.style.cursor = "pointer";
    this.botonCanal.style.font = "12px sans-serif";
    this.botonCanal.title = "Cambiar canal (local/global)";
    this.botonCanal.onclick = () => {
      this.canal = this.canal === "local" ? "global" : "local";
      this.actualizarBotonCanal();
      this.input.focus();
    };
    filaInput.appendChild(this.botonCanal);
    this.actualizarBotonCanal();

    this.input = document.createElement("input");
    this.input.dataset.testid = "panel-chat-input";
    this.input.type = "text";
    this.input.placeholder = "Enter para escribir...";
    this.input.maxLength = 200;
    this.input.style.flex = "1 1 auto";
    this.input.style.background = "transparent";
    this.input.style.color = "#f0e8d8";
    this.input.style.border = "none";
    this.input.style.outline = "none";
    this.input.style.padding = "6px 8px";
    this.input.style.font = "13px sans-serif";
    this.input.style.minWidth = "0"; // que flex lo encoja de verdad, no lo desborde
    this.input.onkeydown = (e) => {
      // stopPropagation: sin esto, cada tecla escrita (b/m/z/i/space...)
      // le llegaría TAMBIÉN al keydown global de game.ts y dispararía el
      // atajo de juego correspondiente a la vez que se escribe el mensaje.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.enviarDesdeInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.input.value = "";
        this.input.blur();
      }
    };
    filaInput.appendChild(this.input);
    this.cuerpo.appendChild(filaInput);

    opciones.contenedor.appendChild(this.raiz);

    // Enter fuera del input (jugando normal): abre/enfoca el chat sin
    // enviar nada todavía — mismo atajo universal de cualquier MMO. Vive
    // aquí (listener propio) y no en el keydown global de game.ts porque
    // ese ya ignora por completo las teclas mientras un <input> tiene el
    // foco (ver el guardia añadido ahí) — sin este listener propio, Enter
    // nunca llegaría a abrir el chat la primera vez. Si está minimizado,
    // Enter lo restaura primero — sin esto, Enter enfocaría un input oculto.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (document.activeElement === this.input) return; // ya enfocado: lo gestiona this.input.onkeydown de arriba
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return; // otro input con foco (login, etc.) — no robarle Enter
      e.preventDefault();
      if (this.minimizado) {
        this.minimizado = false;
        this.actualizarMinimizado();
      }
      this.input.focus();
    });
  }

  private actualizarMinimizado() {
    this.cuerpo.style.display = this.minimizado ? "none" : "block";
    this.botonMinimizar.textContent = this.minimizado ? "＋" : "–";
    this.botonMinimizar.title = this.minimizado ? "Restaurar" : "Minimizar";
  }

  private actualizarBotonCanal() {
    this.botonCanal.textContent = this.canal === "local" ? "Local" : "Global";
    this.botonCanal.style.color = this.canal === "local" ? "#f0e8d8" : "#f0c860";
  }

  private enviarDesdeInput() {
    const texto = this.input.value.trim();
    this.input.value = "";
    if (!texto) {
      this.input.blur();
      return;
    }
    this.opciones.enviarMensaje(texto, this.canal);
    // Se queda enfocado para poder seguir escribiendo sin volver a pulsar
    // Enter — mismo criterio que la mayoría de chats de MMO.
  }

  /** Llamar desde `room.onMessage("chat:mensaje", ...)`. */
  agregarMensaje(m: MensajeChatVista) {
    this.mensajes.push(m);
    if (this.mensajes.length > MAX_MENSAJES_VISIBLES) this.mensajes.shift();
    this.renderizarLog();
  }

  private renderizarLog() {
    const pegadoAbajo = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 20;
    this.log.innerHTML = "";
    for (const m of this.mensajes) {
      const linea = document.createElement("div");
      const esGlobal = m.canal === "global";
      const etiqueta = esGlobal ? "[Global]" : "[Local]";
      linea.style.color = esGlobal ? "#f0c860" : "#d8d0c0";
      linea.style.wordBreak = "break-word";
      // textContent, nunca innerHTML con el mensaje del jugador — el texto
      // de otro jugador es contenido NO confiable, server-authoritative o
      // no (mismo criterio que cualquier chat: nunca se interpreta como HTML).
      linea.textContent = `${etiqueta} ${m.nombre}: ${m.texto}`;
      this.log.appendChild(linea);
    }
    if (pegadoAbajo) this.log.scrollTop = this.log.scrollHeight;
  }
}
