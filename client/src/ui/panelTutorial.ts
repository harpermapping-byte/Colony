/**
 * Guía rápida + Novedades (docs/GDD_UI_Paneles.md, pedido streamer
 * 2026-09-13: "justo al inicio, cuando te logeas, un panel con un resumen
 * de qué se puede hacer... también un changelog que iremos actualizando,
 * seguimos fase BETA. Y en Ajustes o abajo que salga Tutoriales, lo mismo
 * que el inicio, para que la gente entienda las mecánicas"). Mismo panel,
 * dos usos: se abre SOLO una vez por sesión al entrar al mundo (salvo que
 * el jugador haya marcado "no mostrar automáticamente") y siempre queda
 * disponible bajo el icono 📖 del dock — "Tutoriales" no es un contenido
 * aparte, es este mismo panel abierto a mano.
 */
import { crearMarcoPanel, crearSubtitulo, type MarcoPanel } from "./panelBase";
import { SECCIONES_GUIA, HISTORIAL_CAMBIOS } from "./contenidoAyuda";

// Solo esconde el AUTO-abrir al entrar — el panel sigue accesible siempre
// desde el dock, así que no hace falta ninguna cuenta atrás/versión: es una
// preferencia simple de "no me lo enseñes solo, ya lo abro yo si quiero".
const CLAVE_OCULTAR_AUTO = "colonyOcultarGuiaInicioAuto";

function obtenerOcultarAutoGuardado(): boolean {
  try {
    return localStorage.getItem(CLAVE_OCULTAR_AUTO) === "1";
  } catch {
    return false;
  }
}

function guardarOcultarAuto(valor: boolean): void {
  try {
    localStorage.setItem(CLAVE_OCULTAR_AUTO, valor ? "1" : "0");
  } catch {
    // localStorage puede fallar (ventana privada, cuota) — preferencia cosmética, no bloquea nada
  }
}

/** true salvo que el jugador haya marcado antes "no mostrar automáticamente" — para decidir el auto-abrir al entrar al mundo. */
export function debeAbrirGuiaAutomaticamente(): boolean {
  return !obtenerOcultarAutoGuardado();
}

type Pestana = "guia" | "novedades";

export class PanelTutorial {
  private readonly marco: MarcoPanel;
  private pestana: Pestana = "guia";

  constructor(opts: { contenedor: HTMLElement }) {
    this.marco = crearMarcoPanel({ contenedor: opts.contenedor, titulo: "Guía y novedades", icono: "📖", left: "50%", top: "50%", ancho: "440px" });
    this.marco.raiz.setAttribute("data-testid", "panel-tutorial");
    this.render();
  }

  abrir() {
    this.marco.abrir();
  }
  cerrar() {
    this.marco.cerrar();
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

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    cuerpo.style.maxHeight = "70vh";
    cuerpo.style.overflowY = "auto";

    const beta = document.createElement("div");
    beta.textContent = "🚧 Streamer Colony está en fase BETA — todo puede cambiar, y lo iremos anunciando en Novedades.";
    beta.style.cssText =
      "background:rgba(255,200,80,0.12);border:1px solid #8a6a2a;border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:12px;";
    cuerpo.appendChild(beta);

    cuerpo.appendChild(this.pestanas());

    if (this.pestana === "guia") {
      for (const seccion of SECCIONES_GUIA) {
        const fila = document.createElement("div");
        fila.style.marginBottom = "10px";
        const titulo = document.createElement("div");
        titulo.textContent = `${seccion.icono} ${seccion.titulo}`;
        titulo.style.fontWeight = "bold";
        titulo.style.marginBottom = "2px";
        fila.appendChild(titulo);
        const texto = document.createElement("div");
        texto.textContent = seccion.texto;
        texto.style.fontSize = "12px";
        texto.style.color = "var(--panel-texto-tenue)";
        fila.appendChild(texto);
        cuerpo.appendChild(fila);
      }
    } else {
      for (const entrada of HISTORIAL_CAMBIOS) {
        cuerpo.appendChild(crearSubtitulo(entrada.fecha));
        const lista = document.createElement("ul");
        lista.style.margin = "0 0 4px 0";
        lista.style.paddingLeft = "18px";
        lista.style.fontSize = "12px";
        for (const cambio of entrada.cambios) {
          const li = document.createElement("li");
          li.textContent = cambio;
          li.style.marginBottom = "2px";
          lista.appendChild(li);
        }
        cuerpo.appendChild(lista);
      }
    }

    const pie = document.createElement("label");
    pie.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:10px;font-size:11px;color:var(--panel-texto-tenue);cursor:pointer;";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = obtenerOcultarAutoGuardado();
    check.onchange = () => guardarOcultarAuto(check.checked);
    pie.appendChild(check);
    pie.appendChild(document.createTextNode("No mostrar esto automáticamente al entrar (siempre lo tienes en el icono 📖 de abajo)"));
    cuerpo.appendChild(pie);
  }

  private pestanas(): HTMLDivElement {
    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.gap = "4px";
    fila.style.margin = "8px 0";
    for (const [id, etiqueta] of [
      ["guia", "🧭 Guía rápida"],
      ["novedades", "📰 Novedades"],
    ] as const) {
      const boton = document.createElement("button");
      boton.textContent = etiqueta;
      boton.style.flex = "1";
      boton.style.padding = "4px 0";
      boton.style.background = this.pestana === id ? "rgba(255,255,255,0.14)" : "transparent";
      boton.style.color = "#f0e8d8";
      boton.style.border = "1px solid #6a5a3a";
      boton.style.borderRadius = "4px";
      boton.style.cursor = "pointer";
      boton.style.font = "inherit";
      boton.onclick = () => {
        this.pestana = id;
        this.render();
      };
      fila.appendChild(boton);
    }
    return fila;
  }
}
