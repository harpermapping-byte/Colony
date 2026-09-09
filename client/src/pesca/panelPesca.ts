/**
 * Panel de pesca — PLACEHOLDER de testeo (docs/GDD_Pesca.md, mismo criterio
 * ya pactado para combate/mascotas/comercio: "placeholder sencillo, la UI
 * final se hace al final del proyecto"). Solo un estado de texto + botón de
 * cancelar; la boya de verdad se ve en el mundo 3D (ver game.ts).
 *
 * Chrome migrado al marco compartido (`panelBase.ts`, pedido streamer
 * 2026-09-09: "TODA pantalla debe salir con esta estética").
 */
import { crearMarcoPanel, crearBoton, type MarcoPanel } from "../ui/panelBase";

export type EstadoPescaVista = "esperando" | "picando" | null;

export interface OpcionesPanelPesca {
  contenedor: HTMLElement;
  cancelar(): void;
}

export class PanelPesca {
  private marco: MarcoPanel;
  private estado: EstadoPescaVista = null;

  constructor(private opciones: OpcionesPanelPesca) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Pesca",
      icono: "🎣",
      // Lo abre/cierra el propio estado de pesca (game.ts, mensajes
      // pesca:pica/escapado/cancelada) — no un gesto del jugador. Cerrarlo
      // con Escape/clic-fuera mientras la caña sigue lanzada lo reabriría
      // en cuanto llegue el siguiente mensaje del servidor, dando sensación
      // de panel que "no se deja cerrar". Solo `actualizar(null)` (o el
      // botón ✕, equivalente a cancelar la pesca) lo cierra de verdad.
      cierraAlClicarFuera: false,
      cierraConEscape: false,
    });
    this.marco.raiz.style.left = "50%";
    this.marco.raiz.style.bottom = "90px";
    this.marco.raiz.style.transform = "translateX(-50%)";
    this.render();
  }

  actualizar(estado: EstadoPescaVista) {
    this.estado = estado;
    this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (!this.estado) {
      this.marco.cerrar();
      return;
    }
    this.marco.abrir();

    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.alignItems = "center";
    fila.style.gap = "10px";
    const texto = document.createElement("span");
    texto.textContent = this.estado === "picando" ? "🐟 ¡Pica! Pulsa U" : "🎣 Pescando... esperando una picada";
    fila.appendChild(texto);
    fila.appendChild(crearBoton("Cancelar", () => this.opciones.cancelar()));
    cuerpo.appendChild(fila);
  }
}
