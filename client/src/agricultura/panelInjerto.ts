/**
 * Panel de injertos — PLACEHOLDER de testeo (docs/GDD_Agricultura.md §4,
 * mismo criterio de placeholder que el resto de esta pasada). Aparece
 * solo al acercarse a una `mesa_injertos`. Combina dos semillas por id de
 * instancia (sin rejilla arrastrable todavía, fase 3 de inventario).
 *
 * Chrome migrado al marco compartido (`panelBase.ts`, pedido streamer
 * 2026-09-09: "TODA pantalla debe salir con esta estética").
 */
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";

export interface OpcionesPanelInjerto {
  contenedor: HTMLElement;
  crear(construccionId: number, instanciaIdA: number, instanciaIdB: number): void;
}

export class PanelInjerto {
  private marco: MarcoPanel;
  private construccionId: number | null = null;

  constructor(private opciones: OpcionesPanelInjerto) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Injertos",
      icono: "🧬",
      // Lo muestra/oculta la PROXIMIDAD a la mesa de injertos (game.ts,
      // cada 500ms) — no un gesto del jugador. Cerrarlo con Escape/clic-
      // fuera mientras sigue de pie ahí lo reabriría en el siguiente
      // barrido de proximidad, dando sensación de panel que "no se deja
      // cerrar". Solo `actualizar(null)` (al alejarse) o el botón ✕ lo
      // cierran de verdad.
      cierraAlClicarFuera: false,
      cierraConEscape: false,
    });
    this.marco.raiz.style.right = "16px";
    this.marco.raiz.style.bottom = "90px";
    this.render();
  }

  /** null cuando el jugador ya no está junto a ninguna mesa de injertos. */
  actualizar(construccionId: number | null) {
    this.construccionId = construccionId;
    this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (this.construccionId == null) {
      this.marco.cerrar();
      return;
    }
    this.marco.abrir();
    const id = this.construccionId;

    cuerpo.appendChild(crearLineaTexto("Combina dos semillas cualesquiera en una especie nueva.", { tenue: true, fontSize: "11px" }));

    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.gap = "6px";
    const inputA = crearInput({ tipo: "number", placeholder: "semilla A" });
    inputA.style.width = "80px";
    const inputB = crearInput({ tipo: "number", placeholder: "semilla B" });
    inputB.style.width = "80px";
    fila.appendChild(inputA);
    fila.appendChild(inputB);
    const boton = crearBoton("Injertar", () => {
      const a = Number(inputA.value);
      const b = Number(inputB.value);
      if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) this.opciones.crear(id, a, b);
      inputA.value = "";
      inputB.value = "";
    });
    fila.appendChild(boton);
    cuerpo.appendChild(fila);
  }
}
