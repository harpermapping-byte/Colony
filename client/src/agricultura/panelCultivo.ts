/**
 * Panel de agricultura — PLACEHOLDER de testeo (docs/GDD_Agricultura.md,
 * mismo criterio ya pactado para combate/mascotas/comercio/pesca:
 * "placeholder sencillo, la UI final se hace al final del proyecto").
 * Se muestra solo cuando el jugador está junto a un bancal/maceta
 * (`RenderConstrucciones.plantableMasCercana`, ver game.ts).
 *
 * Chrome migrado al marco compartido (`panelBase.ts`, pedido streamer
 * 2026-09-09: "TODA pantalla debe salir con esta estética").
 */
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";

export interface EstadoCultivoVista {
  construccionId: number;
  semillaId: string | null;
  itemIdCosecha: string | null;
  agua: number;
  fertilizante: number;
  diasParaCosecha: number | null;
  listo: boolean;
}

export interface OpcionesPanelCultivo {
  contenedor: HTMLElement;
  plantar(construccionId: number, instanciaId: number): void;
  regar(construccionId: number): void;
  abonar(construccionId: number): void;
  cosechar(construccionId: number): void;
}

export class PanelCultivo {
  private marco: MarcoPanel;
  private estado: EstadoCultivoVista | null = null;

  constructor(private opciones: OpcionesPanelCultivo) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Bancal",
      icono: "🌱",
      // Lo muestra/oculta la PROXIMIDAD al bancal/maceta (game.ts, cada
      // 500ms) — no un gesto del jugador. Cerrarlo con Escape/clic-fuera
      // mientras sigue de pie ahí lo reabriría en el siguiente barrido de
      // proximidad, dando sensación de panel que "no se deja cerrar". Solo
      // `actualizar(null)` (al alejarse) o el botón ✕ lo cierran de verdad.
      cierraAlClicarFuera: false,
      cierraConEscape: false,
    });
    this.marco.raiz.style.left = "16px";
    this.marco.raiz.style.bottom = "90px";
    this.render();
  }

  /** Llamar con null cuando el jugador ya no está junto a ningún bancal/maceta. */
  actualizar(estado: EstadoCultivoVista | null) {
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
    const e = this.estado;

    if (!e.semillaId) {
      cuerpo.appendChild(crearLineaTexto("Vacío — planta una semilla.", { tenue: true }));

      const filaPlantar = document.createElement("div");
      filaPlantar.style.display = "flex";
      filaPlantar.style.gap = "6px";
      const input = crearInput({ tipo: "number", placeholder: "id semilla" });
      input.style.width = "90px";
      filaPlantar.appendChild(input);
      const plantar = crearBoton("Plantar", () => {
        const id = Number(input.value);
        if (Number.isFinite(id) && id > 0) this.opciones.plantar(e.construccionId, id);
        input.value = "";
      });
      filaPlantar.appendChild(plantar);
      cuerpo.appendChild(filaPlantar);
      return;
    }

    const info = document.createElement("div");
    info.style.marginBottom = "6px";
    info.textContent = `${e.itemIdCosecha ?? "?"} — 💧${Math.round(e.agua)} 🌿${Math.round(e.fertilizante)}${e.listo ? " — ¡listo!" : e.diasParaCosecha != null ? ` — ${e.diasParaCosecha}d` : ""}`;
    cuerpo.appendChild(info);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "6px";
    botones.appendChild(crearBoton("Regar", () => this.opciones.regar(e.construccionId)));
    botones.appendChild(crearBoton("Abonar", () => this.opciones.abonar(e.construccionId)));
    const cosechar = crearBoton("Cosechar", () => this.opciones.cosechar(e.construccionId));
    cosechar.disabled = !e.listo;
    botones.appendChild(cosechar);
    cuerpo.appendChild(botones);
  }
}
