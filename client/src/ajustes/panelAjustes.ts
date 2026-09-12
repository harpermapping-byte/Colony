/**
 * Panel de Ajustes (pedido streamer 2026-09-09: "una zona de ajustes donde
 * blindear las teclas... panel de volumen, panel de pantalla completa o
 * resolución... cosas típicas de videojuego que nos faltan, con funciones
 * REALES y útiles") — usa el marco compartido (`panelBase.ts`, X + clic
 * fuera + Escape), registrado en el dock como cualquier otro panel nuevo.
 *
 * Las 3 primeras secciones tienen efecto de verdad, no solo visual:
 * - Volumen → `audio/instrumentos.ts::fijarVolumenMaestro` (el único bus de
 *   audio real del juego hoy, instrumentos MIDI — investigado antes de
 *   escribir esto, no hay pasos/combate/ambiente que enganchar todavía).
 * - Pantalla completa → Fullscreen API real (no existía nada parecido).
 * - Calidad gráfica → `render3d/worldScene.ts::fijarCalidadGrafica`
 *   (pixel ratio + sombras), relevante de verdad dado el historial de
 *   problemas de rendimiento ya documentado en CLAUDE.md.
 * - Teclas → ver `configTeclas.ts` para el diseño de la reasignación
 *   (remapeo de entrada, sin tocar el switch de `game.ts`).
 * - Twitch → fallback de conexión (pedido streamer 2026-09-09: "lo de
 *   conectar twitch debe ir al crear cuenta o loguearse, y si no lo hace se
 *   queda en ajustes loguearse con twitch") — la vía principal es la
 *   pantalla de bienvenida (`inicio/pantallaBienvenida.ts`), esto es solo
 *   para quien no lo conectó al entrar. Mismo endpoint, sin duplicar lógica.
 */
import { crearMarcoPanel, crearBoton, crearSubtitulo, crearLineaTexto } from "../ui/panelBase";
import { obtenerVolumenGuardado, guardarVolumen, obtenerVolumenMusicaGuardado, guardarVolumenMusica, obtenerCalidadGuardada, guardarCalidad, CalidadGrafica } from "./configAjustes";
import { ACCIONES_REASIGNABLES, obtenerTeclaAsignada, asignarTecla, restablecerTeclas } from "./configTeclas";
import { ModoControlesTactiles, obtenerModoControlesGuardado, guardarModoControles } from "../controles/deteccionControl";

export interface OpcionesPanelAjustes {
  contenedor: HTMLElement;
  fijarVolumen(v: number): void;
  /** Bus de audio INDEPENDIENTE del anterior — ver `audio/musicaFondo.ts`. */
  fijarVolumenMusica(v: number): void;
  fijarCalidadGrafica(nivel: CalidadGrafica): void;
  serverUrlHttp: string;
  /** `true` si ya se mandó una `twitchSession` (login desde bienvenida.ts) y se está esperando la confirmación del servidor. */
  twitchYaConectando: boolean;
}

/** Nombre legible de una tecla para mostrar en la UI (" " -> "Espacio", "arrowup" -> "↑"...). */
function etiquetaTecla(tecla: string): string {
  const especiales: Record<string, string> = {
    " ": "Espacio", tab: "Tab", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
    shift: "Shift", escape: "Esc", f9: "F9",
  };
  return especiales[tecla] ?? tecla.toUpperCase();
}

export class PanelAjustes {
  private readonly marco;
  private capturandoAccion: string | null = null;
  private twitchLoginConfirmado: string | null = null;

  constructor(private opciones: OpcionesPanelAjustes) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Ajustes", icono: "⚙️", ancho: "300px", left: "50%", top: "50%" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "78vh";
    this.marco.onCambioEstado(() => {
      if (this.marco.estaAbierto()) this.render();
    });

    // Fullscreen puede salir por otras vías (Esc nativo del navegador,
    // F11...) — re-renderizar en cada cambio mantiene el botón honesto.
    document.addEventListener("fullscreenchange", () => {
      if (this.marco.estaAbierto()) this.render();
    });
  }

  alternar() {
    this.marco.alternar();
  }

  estaAbierto() {
    return this.marco.estaAbierto();
  }

  onCambioEstado(cb: () => void) {
    this.marco.onCambioEstado(cb);
  }

  /** Llamar desde `room.onMessage("twitch:loginConfirmado", ...)`. */
  actualizarTwitch(twitchLogin: string) {
    this.twitchLoginConfirmado = twitchLogin;
    if (this.marco.estaAbierto()) this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    // --- Sonido ---
    cuerpo.appendChild(crearSubtitulo("🔊 Sonido"));
    const filaVolumen = document.createElement("div");
    filaVolumen.style.display = "flex";
    filaVolumen.style.alignItems = "center";
    filaVolumen.style.gap = "8px";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(obtenerVolumenGuardado());
    slider.style.flex = "1";
    const etiquetaVolumen = document.createElement("span");
    etiquetaVolumen.style.minWidth = "34px";
    etiquetaVolumen.style.fontSize = "12px";
    etiquetaVolumen.textContent = `${slider.value}%`;
    slider.oninput = () => {
      const v = Number(slider.value);
      etiquetaVolumen.textContent = `${v}%`;
      this.opciones.fijarVolumen(v);
      guardarVolumen(v);
    };
    filaVolumen.appendChild(slider);
    filaVolumen.appendChild(etiquetaVolumen);
    cuerpo.appendChild(filaVolumen);
    cuerpo.appendChild(crearLineaTexto("Solo afecta a instrumentos musicales tocados por jugadores.", { tenue: true, fontSize: "10px" }));

    // --- Música de fondo (bus INDEPENDIENTE del de arriba, ver audio/musicaFondo.ts) ---
    const filaMusica = document.createElement("div");
    filaMusica.style.display = "flex";
    filaMusica.style.alignItems = "center";
    filaMusica.style.gap = "8px";
    const sliderMusica = document.createElement("input");
    sliderMusica.type = "range";
    sliderMusica.min = "0";
    sliderMusica.max = "100";
    sliderMusica.value = String(obtenerVolumenMusicaGuardado());
    sliderMusica.style.flex = "1";
    const etiquetaMusica = document.createElement("span");
    etiquetaMusica.style.minWidth = "34px";
    etiquetaMusica.style.fontSize = "12px";
    etiquetaMusica.textContent = `${sliderMusica.value}%`;
    sliderMusica.oninput = () => {
      const v = Number(sliderMusica.value);
      etiquetaMusica.textContent = `${v}%`;
      this.opciones.fijarVolumenMusica(v);
      guardarVolumenMusica(v);
    };
    filaMusica.appendChild(sliderMusica);
    filaMusica.appendChild(etiquetaMusica);
    cuerpo.appendChild(crearLineaTexto("🎵 Música de fondo", { fontSize: "12px" }));
    cuerpo.appendChild(filaMusica);
    cuerpo.appendChild(crearLineaTexto("Ponlo a 0 para quitarla del todo. Suena en bucle al entrar al juego.", { tenue: true, fontSize: "10px" }));

    // --- Pantalla ---
    cuerpo.appendChild(crearSubtitulo("🖥️ Pantalla"));
    const enFullscreen = !!document.fullscreenElement;
    const botonFullscreen = crearBoton(enFullscreen ? "Salir de pantalla completa" : "Pantalla completa", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    botonFullscreen.style.width = "100%";
    botonFullscreen.style.marginBottom = "8px";
    cuerpo.appendChild(botonFullscreen);

    const filaCalidad = document.createElement("div");
    filaCalidad.style.display = "flex";
    filaCalidad.style.gap = "4px";
    const calidadActual = obtenerCalidadGuardada();
    for (const nivel of ["baja", "media", "alta"] as const) {
      const boton = crearBoton(nivel === "baja" ? "Baja" : nivel === "media" ? "Media" : "Alta", () => {
        guardarCalidad(nivel);
        this.opciones.fijarCalidadGrafica(nivel);
        this.render();
      });
      boton.style.flex = "1";
      if (nivel === calidadActual) boton.style.background = "rgba(255,255,255,0.18)";
      filaCalidad.appendChild(boton);
    }
    cuerpo.appendChild(crearLineaTexto("Calidad gráfica", { tenue: true, fontSize: "11px" }));
    cuerpo.appendChild(filaCalidad);
    cuerpo.appendChild(crearLineaTexto("\"Baja\" apaga sombras y reduce la resolución interna — recomendado si notas tirones.", { tenue: true, fontSize: "10px" }));

    // --- Controles táctiles (pedido streamer: "controles para jugar desde
    // el móvil") — "Automático" detecta solo si el puntero principal del
    // dispositivo es un dedo (`deteccionControl.ts`), sin mirar el ancho de
    // pantalla; "Siempre"/"Nunca" fuerzan el resultado para el caso raro que
    // la detección sola no puede acertar (un híbrido con teclado+ratón
    // Bluetooth, o simplemente querer probarlos en un PC de escritorio). ---
    cuerpo.appendChild(crearSubtitulo("📱 Controles táctiles"));
    const filaControles = document.createElement("div");
    filaControles.style.display = "flex";
    filaControles.style.gap = "4px";
    const modoActual = obtenerModoControlesGuardado();
    const etiquetasModo: Record<ModoControlesTactiles, string> = { auto: "Automático", siempre: "Siempre", nunca: "Nunca" };
    for (const modo of ["auto", "siempre", "nunca"] as const) {
      const boton = crearBoton(etiquetasModo[modo], () => {
        guardarModoControles(modo);
        this.render();
      });
      boton.dataset.testid = `ajustes-controles-tactiles-${modo}`;
      boton.style.flex = "1";
      if (modo === modoActual) boton.style.background = "rgba(255,255,255,0.18)";
      filaControles.appendChild(boton);
    }
    cuerpo.appendChild(filaControles);
    cuerpo.appendChild(crearLineaTexto("\"Automático\" los muestra solo si el dispositivo se maneja con el dedo (móvil/tablet) — nunca en un PC con ratón, aunque achiques la ventana.", { tenue: true, fontSize: "10px" }));

    // --- Twitch ---
    cuerpo.appendChild(crearSubtitulo("🎮 Twitch"));
    if (this.twitchLoginConfirmado) {
      cuerpo.appendChild(crearLineaTexto(`Conectado como ${this.twitchLoginConfirmado}`, { fontSize: "12px" }));
    } else {
      const enlaceTwitch = document.createElement("a");
      enlaceTwitch.href = `${this.opciones.serverUrlHttp}/auth/twitch/login`;
      enlaceTwitch.className = "panel-colony-boton";
      enlaceTwitch.style.display = "block";
      enlaceTwitch.style.textAlign = "center";
      enlaceTwitch.style.textDecoration = "none";
      enlaceTwitch.textContent = this.opciones.twitchYaConectando ? "🎮 Twitch: conectando..." : "🎮 Conectar con Twitch";
      cuerpo.appendChild(enlaceTwitch);
      cuerpo.appendChild(crearLineaTexto("Para que el chat te reconozca por tu nombre de Twitch.", { tenue: true, fontSize: "10px" }));
    }

    // --- Teclas ---
    cuerpo.appendChild(crearSubtitulo("⌨️ Teclas"));
    cuerpo.appendChild(crearLineaTexto("El movimiento (WASD/flechas/Shift) no es reasignable aquí.", { tenue: true, fontSize: "10px" }));
    const listaTeclas = document.createElement("div");
    listaTeclas.style.maxHeight = "220px";
    listaTeclas.style.overflowY = "auto";
    listaTeclas.style.marginTop = "4px";
    for (const accion of ACCIONES_REASIGNABLES) {
      listaTeclas.appendChild(this.filaAccionTecla(accion.id, accion.etiqueta));
    }
    cuerpo.appendChild(listaTeclas);

    const errorTeclas = document.createElement("div");
    errorTeclas.className = "panel-colony-error";
    errorTeclas.id = "panel-ajustes-error-teclas";
    cuerpo.appendChild(errorTeclas);

    const botonRestablecer = crearBoton("Restablecer teclas por defecto", () => {
      restablecerTeclas();
      this.capturandoAccion = null;
      this.render();
    });
    botonRestablecer.style.width = "100%";
    botonRestablecer.style.marginTop = "6px";
    cuerpo.appendChild(botonRestablecer);

    // Enfocar el input de captura AHORA que todo el árbol ya cuelga de
    // `cuerpo` (conectado al documento real) — ver comentario en
    // `filaAccionTecla` sobre por qué no se hace antes.
    if (this.capturandoAccion) {
      cuerpo.querySelector<HTMLInputElement>('input[placeholder="Pulsa una tecla…"]')?.focus();
    }
  }

  private filaAccionTecla(accionId: string, etiqueta: string): HTMLDivElement {
    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.alignItems = "center";
    fila.style.justifyContent = "space-between";
    fila.style.gap = "6px";
    fila.style.padding = "3px 0";
    fila.style.fontSize = "12px";

    const nombre = document.createElement("span");
    nombre.textContent = etiqueta;
    nombre.style.overflow = "hidden";
    nombre.style.textOverflow = "ellipsis";
    nombre.style.whiteSpace = "nowrap";
    fila.appendChild(nombre);

    if (this.capturandoAccion === accionId) {
      const input = document.createElement("input");
      input.className = "panel-colony-input";
      input.type = "text";
      input.readOnly = true; // no se escribe texto, solo se captura la PRÓXIMA tecla — el guardia global de game.ts ya ignora el juego mientras un input tiene foco
      input.placeholder = "Pulsa una tecla…";
      input.style.width = "110px";
      input.style.fontSize = "11px";
      input.onkeydown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          this.capturandoAccion = null;
          this.render();
          return;
        }
        const resultado = asignarTecla(accionId, e.key.toLowerCase());
        const error = document.getElementById("panel-ajustes-error-teclas");
        if (!resultado.ok && error) error.textContent = resultado.motivo;
        else if (error) error.textContent = "";
        this.capturandoAccion = null;
        this.render();
      };
      input.onblur = () => {
        // clic fuera del input cancela la captura sin asignar nada.
        if (this.capturandoAccion === accionId) { this.capturandoAccion = null; this.render(); }
      };
      fila.appendChild(input);
      // NO enfocar aquí: `fila` todavía no está conectada al documento real
      // (esta función la construye aislada, el caller la añade después) —
      // `.focus()` sobre un elemento desconectado no hace nada, el navegador
      // lo ignora en silencio. `render()` lo enfoca al final, una vez que
      // todo el árbol ya cuelga de `cuerpo` (que sí está en el documento).
    } else {
      const etiquetaTeclaEl = document.createElement("span");
      etiquetaTeclaEl.textContent = etiquetaTecla(obtenerTeclaAsignada(accionId));
      etiquetaTeclaEl.style.flex = "none";
      etiquetaTeclaEl.style.minWidth = "26px";
      etiquetaTeclaEl.style.textAlign = "center";
      etiquetaTeclaEl.style.padding = "1px 5px";
      etiquetaTeclaEl.style.border = "1px solid #6a5a3a";
      etiquetaTeclaEl.style.borderRadius = "3px";
      etiquetaTeclaEl.style.fontFamily = "monospace";
      fila.appendChild(etiquetaTeclaEl);

      const botonCambiar = crearBoton("Cambiar", () => { this.capturandoAccion = accionId; this.render(); });
      botonCambiar.style.fontSize = "10px";
      botonCambiar.style.padding = "2px 6px";
      fila.appendChild(botonCambiar);
    }

    return fila;
  }
}
