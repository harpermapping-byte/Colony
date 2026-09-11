/**
 * Panel de agricultura — PLACEHOLDER de testeo (docs/GDD_Agricultura.md,
 * mismo criterio ya pactado para combate/mascotas/comercio/pesca:
 * "placeholder sencillo, la UI final se hace al final del proyecto").
 * Se muestra solo cuando el jugador está junto a un bancal/maceta
 * (`RenderConstrucciones.plantableMasCercana`, ver game.ts).
 *
 * Chrome migrado al marco compartido (`panelBase.ts`, pedido streamer
 * 2026-09-09: "TODA pantalla debe salir con esta estética").
 *
 * §9 (2026-09-11): una maceta exige `tierra` antes de plantar (botón "Meter
 * tierra", contador n/N) y regar gasta agua de un cubo/regadera de la
 * mochila — el panel solo lo explica, la regla vive en el servidor. Las
 * semillas se eligen de un desplegable con lo que llevas encima (antes había
 * que teclear un id de instancia a mano).
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
  /** §9: unidades de tierra metidas / exigidas (0 = no hace falta, bancal). Opcionales para no romper sondas antiguas. */
  tierra?: number;
  tierraNecesaria?: number;
}

export interface SemillaDisponible {
  instanciaId: number;
  etiqueta: string;
}

export interface OpcionesPanelCultivo {
  contenedor: HTMLElement;
  plantar(construccionId: number, instanciaId: number): void;
  regar(construccionId: number): void;
  abonar(construccionId: number): void;
  cosechar(construccionId: number): void;
  /** §9: mete una unidad de tierra de la mochila (cultivo:meterTierra). */
  meterTierra?(construccionId: number): void;
  /** Semillas que lleva el jugador ahora mismo, para el desplegable de plantar. Sin él, el panel vuelve al input de id de instancia (sondas de test). */
  semillasDisponibles?(): SemillaDisponible[];
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
    const necesaria = Math.max(0, Math.floor(e.tierraNecesaria ?? 0));
    const tierra = Math.max(0, Math.floor(e.tierra ?? 0));
    const faltaTierra = necesaria > 0 && tierra < necesaria;

    if (necesaria > 0) {
      const filaTierra = document.createElement("div");
      filaTierra.style.display = "flex";
      filaTierra.style.gap = "6px";
      filaTierra.style.alignItems = "center";
      filaTierra.style.marginBottom = "6px";
      filaTierra.appendChild(crearLineaTexto(`🪴 Tierra ${tierra}/${necesaria}`, { tenue: !faltaTierra }));
      const meter = crearBoton("Meter tierra", () => this.opciones.meterTierra?.(e.construccionId));
      meter.setAttribute("data-testid", "cultivo-meter-tierra");
      meter.disabled = !faltaTierra || !this.opciones.meterTierra;
      meter.title = faltaTierra ? "Gasta 1 de tierra de la mochila (pala sobre una casilla de suelo → tierra)" : "Ya está llena de tierra";
      filaTierra.appendChild(meter);
      cuerpo.appendChild(filaTierra);
    }

    if (!e.semillaId) {
      if (faltaTierra) {
        cuerpo.appendChild(crearLineaTexto("Sin tierra no se puede plantar.", { tenue: true }));
        return;
      }
      cuerpo.appendChild(crearLineaTexto("Vacío — planta una semilla.", { tenue: true }));

      const filaPlantar = document.createElement("div");
      filaPlantar.style.display = "flex";
      filaPlantar.style.gap = "6px";
      const semillas = this.opciones.semillasDisponibles?.() ?? null;
      if (semillas) {
        const select = document.createElement("select");
        select.setAttribute("data-testid", "cultivo-semilla");
        select.style.flex = "1";
        select.style.font = "inherit";
        for (const s of semillas) {
          const op = document.createElement("option");
          op.value = String(s.instanciaId);
          op.textContent = s.etiqueta;
          select.appendChild(op);
        }
        if (semillas.length === 0) {
          const op = document.createElement("option");
          op.value = "";
          op.textContent = "(no llevas semillas)";
          select.appendChild(op);
          select.disabled = true;
        }
        filaPlantar.appendChild(select);
        const plantar = crearBoton("Plantar", () => {
          const id = Number(select.value);
          if (Number.isFinite(id) && id > 0) this.opciones.plantar(e.construccionId, id);
        });
        plantar.disabled = semillas.length === 0;
        filaPlantar.appendChild(plantar);
      } else {
        const input = crearInput({ tipo: "number", placeholder: "id semilla" });
        input.style.width = "90px";
        filaPlantar.appendChild(input);
        const plantar = crearBoton("Plantar", () => {
          const id = Number(input.value);
          if (Number.isFinite(id) && id > 0) this.opciones.plantar(e.construccionId, id);
          input.value = "";
        });
        filaPlantar.appendChild(plantar);
      }
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
    const regar = crearBoton("Regar", () => this.opciones.regar(e.construccionId));
    regar.title = "Gasta 500ml de un cubo/regadera con agua de la mochila (llénalo junto al agua)";
    botones.appendChild(regar);
    botones.appendChild(crearBoton("Abonar", () => this.opciones.abonar(e.construccionId)));
    const cosechar = crearBoton("Cosechar", () => this.opciones.cosechar(e.construccionId));
    cosechar.disabled = !e.listo;
    botones.appendChild(cosechar);
    cuerpo.appendChild(botones);
  }
}
