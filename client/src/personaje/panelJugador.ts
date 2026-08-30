/**
 * Panel "Jugador" (docs/GDD_Equipo.md) — PLACEHOLDER de testeo, mismo
 * criterio ya pactado con el streamer para combate/mascotas: "que sean
 * placeholder sencillas... al final del proyecto se hará toda la UI".
 * DOM plano inyectado sobre el canvas, mismo patrón visual EXACTO que
 * panelMascotas.ts/panelCombate.ts (fondo oscuro semitransparente, texto
 * crema, borde marrón) — panel condicional (oculto hasta pulsar la tecla),
 * mismo criterio que panelCombate.ts.
 *
 * No es una rejilla arrastrable de verdad (eso es la fase de UI real, GDD
 * Inventario §8, "lo último" — pedido explícito del streamer para toda la
 * UI del juego): lista de ítems con un botón "Equipar"/"Quitar" por fila,
 * suficiente para probar el mecanismo real de servidor de punta a punta.
 */

import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItem {
  tipo?: string;
  slotEquipo?: string;
  peso?: number;
  huella?: [number, number];
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

// Los 19 huecos de equipo (docs/GDD_Equipo.md) con etiqueta legible —
// orden pensado para leer de arriba a abajo como un cuerpo real.
const SLOTS: { slot: string; etiqueta: string }[] = [
  { slot: "casco", etiqueta: "Casco" },
  { slot: "mascara", etiqueta: "Máscara" },
  { slot: "gafas", etiqueta: "Gafas" },
  { slot: "pechera", etiqueta: "Pechera" },
  { slot: "hombreras", etiqueta: "Hombreras" },
  { slot: "brazos", etiqueta: "Brazos" },
  { slot: "coderas", etiqueta: "Coderas" },
  { slot: "manos", etiqueta: "Manos" },
  { slot: "anilloIzquierdo", etiqueta: "Anillo Izq." },
  { slot: "anilloDerecho", etiqueta: "Anillo Der." },
  { slot: "brazalete", etiqueta: "Brazalete" },
  { slot: "cinturon", etiqueta: "Cinturón" },
  { slot: "piernas", etiqueta: "Piernas" },
  { slot: "rodilleras", etiqueta: "Rodilleras" },
  { slot: "zapatos", etiqueta: "Zapatos" },
  { slot: "espalda", etiqueta: "Espalda" },
  { slot: "bandolera", etiqueta: "Bandolera" },
  { slot: "manoPrincipal", etiqueta: "Mano principal" },
  { slot: "manoSecundaria", etiqueta: "Mano secundaria" },
];

// slot genérico de catálogo -> hueco(s) físico(s) reales donde puede caer
// (docs/GDD_Equipo.md, server/src/inventario/inventario.ts:GRUPOS_SLOT) —
// mismo criterio duplicado a propósito en el cliente solo para saber qué
// botones ofrecer, el servidor sigue siendo la única autoridad real.
const SLOTS_FISICOS_POR_DECLARADO: Record<string, string[]> = {
  anillo: ["anilloIzquierdo", "anilloDerecho"],
};

interface ItemInstanciaVista {
  id: number;
  itemId: string;
  cantidad: number;
}

export interface OpcionesPanelJugador {
  contenedor: HTMLElement;
  equipar(instanciaId: number, slot: string): void;
  desequipar(slot: string): void;
}

export class PanelJugador {
  private raiz: HTMLDivElement;
  private visible = false;

  constructor(private opciones: OpcionesPanelJugador) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "16px";
    this.raiz.style.top = "16px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "260px";
    this.raiz.style.maxHeight = "80vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.display = "none";
    opciones.contenedor.appendChild(this.raiz);
  }

  alternar() {
    this.visible = !this.visible;
    this.raiz.style.display = this.visible ? "block" : "none";
  }

  estaVisible() {
    return this.visible;
  }

  /** Llamar en cada cambio de `player` (onChange/onAdd de Colyseus) — reconstruye todo, mismo criterio "barato a esta frecuencia" que el resto de sincronizaciones del proyecto. */
  actualizar(player: any) {
    if (!this.visible) return; // evita reconstruir DOM en cada tick de red si el panel está cerrado
    this.render(player);
  }

  private render(player: any) {
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = `🧍 ${player.name || "Jugador"}`;
    this.raiz.appendChild(titulo);

    this.raiz.appendChild(
      this.linea(
        `❤ ${Math.round(player.vida)}/${Math.round(player.vidaMax)}  ⚔ ${player.ataque} (${player.ataqueMagico} mág.)  🛡 ${player.defensa} (${player.defensaMagica} mág.)`,
      ),
    );
    const a = player.atributos;
    if (a) {
      this.raiz.appendChild(
        this.linea(`Fuerza ${a.fuerza} · Destreza ${a.destreza} · Inteligencia ${a.inteligencia} · Resistencia ${a.resistencia} · Carisma ${a.carisma}`, "11px"),
      );
    }

    this.raiz.appendChild(this.subtitulo("Equipo"));
    const equipo: Map<string, string> = player.inventario.equipo;
    for (const { slot, etiqueta } of SLOTS) {
      const itemId = equipo.get(slot);
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.padding = "1px 0";

      const texto = document.createElement("span");
      texto.textContent = `${etiqueta}: ${itemId || "—"}`;
      texto.style.opacity = itemId ? "1" : "0.55";
      fila.appendChild(texto);

      if (itemId) {
        const quitar = document.createElement("button");
        quitar.textContent = "Quitar";
        quitar.onclick = () => this.opciones.desequipar(slot);
        fila.appendChild(quitar);
      }
      this.raiz.appendChild(fila);
    }

    this.raiz.appendChild(this.subtitulo("Cuerpo"));
    this.renderContenedor(player.inventario.cuerpo.items);

    const extras: Map<string, any> = player.inventario.extras;
    for (const [slotExtra, contenedorExtra] of extras) {
      const etiquetaExtra = SLOTS.find((s) => s.slot === slotExtra)?.etiqueta ?? slotExtra;
      this.raiz.appendChild(this.subtitulo(`Dentro de: ${etiquetaExtra}`));
      this.renderContenedor(contenedorExtra.items);
    }
  }

  private renderContenedor(items: Iterable<ItemInstanciaVista>) {
    const lista = [...items];
    if (lista.length === 0) {
      this.raiz.appendChild(this.linea("(vacío)", "11px"));
      return;
    }
    for (const it of lista) {
      const entrada = ITEMS[it.itemId];
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.padding = "1px 0";

      const texto = document.createElement("span");
      texto.textContent = `${it.itemId} x${it.cantidad}`;
      fila.appendChild(texto);

      const declarado = entrada?.slotEquipo;
      if (declarado) {
        const destinos = SLOTS_FISICOS_POR_DECLARADO[declarado] ?? [declarado];
        for (const slotFisico of destinos) {
          const boton = document.createElement("button");
          const etiqueta = SLOTS.find((s) => s.slot === slotFisico)?.etiqueta ?? slotFisico;
          boton.textContent = destinos.length > 1 ? `→ ${etiqueta}` : "Equipar";
          boton.onclick = () => this.opciones.equipar(it.id, slotFisico);
          fila.appendChild(boton);
        }
      }
      this.raiz.appendChild(fila);
    }
  }

  private subtitulo(texto: string): HTMLDivElement {
    const el = document.createElement("div");
    el.style.fontWeight = "bold";
    el.style.marginTop = "8px";
    el.style.marginBottom = "3px";
    el.style.borderTop = "1px solid #6a5a3a";
    el.style.paddingTop = "4px";
    el.textContent = texto;
    return el;
  }

  private linea(texto: string, fontSize?: string): HTMLDivElement {
    const el = document.createElement("div");
    if (fontSize) el.style.fontSize = fontSize;
    el.style.marginBottom = "4px";
    el.textContent = texto;
    return el;
  }
}
