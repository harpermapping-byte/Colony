/**
 * Panel "Jugador" (docs/GDD_Equipo.md) — PLACEHOLDER de testeo, mismo
 * criterio ya pactado con el streamer para combate/mascotas: "que sean
 * placeholder sencillas... al final del proyecto se hará toda la UI".
 * DOM plano inyectado sobre el canvas, mismo patrón visual EXACTO que
 * panelMascotas.ts/panelCombate.ts (fondo oscuro semitransparente, texto
 * crema, borde marrón) — panel condicional (oculto hasta pulsar la tecla),
 * mismo criterio que panelCombate.ts.
 *
 * Sección "Equipo": sigue siendo lista+botón (equipar/desequipar no es un
 * gesto de arrastrar, es elegir un hueco por catálogo). Secciones
 * "Cuerpo"/"Dentro de: X" SÍ son rejilla real con drag&drop nativo del
 * navegador (docs/GDD_Inventario.md §10, pedido 2026-08-30: "esqueleto
 * completo, la UI final es lo último") — arrastra una celda a cualquier
 * grid visible (el propio cuerpo o cualquier mochila/bolsa puesta) y suelta
 * para pedir `inventario:mover`; el servidor decide si cabe, aquí no se
 * valida nada por adelantado. Visualmente sigue siendo tosco a propósito
 * (cuadrados de color + texto), la rejilla/posición SÍ es de verdad.
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
  x: number;
  y: number;
  rot: 0 | 1;
  liquidoTipo?: string;
  liquidoVolumenMl?: number;
}

interface ContenedorVista {
  ancho: number;
  alto: number;
  items: Iterable<ItemInstanciaVista>;
}

/** Tamaño de celda del grid en px — puramente visual, sin relación con nada del servidor. */
const TAM_CELDA = 30;

export interface OpcionesPanelJugador {
  contenedor: HTMLElement;
  equipar(instanciaId: number, slot: string): void;
  desequipar(slot: string): void;
  /** docs/GDD_Inventario.md §10 — mover/soltar una instancia propia a (x,y) de `contenedorDestino` ("cuerpo" o un slot de mochila/bolsa puesta), misma rotación que ya tenía (el skeleton no ofrece rotar al vuelo). */
  mover(instanciaId: number, contenedorDestino: string, x: number, y: number, rot: 0 | 1): void;
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
    this.raiz.appendChild(this.renderGridContenedor("cuerpo", player.inventario.cuerpo));

    const extras: Map<string, any> = player.inventario.extras;
    for (const [slotExtra, contenedorExtra] of extras) {
      const etiquetaExtra = SLOTS.find((s) => s.slot === slotExtra)?.etiqueta ?? slotExtra;
      this.raiz.appendChild(this.subtitulo(`Dentro de: ${etiquetaExtra}`));
      this.raiz.appendChild(this.renderGridContenedor(slotExtra, contenedorExtra));
    }
  }

  /**
   * Rejilla real de un contenedor (docs/GDD_Inventario.md §10) — celdas
   * absolutas dentro de una caja de `ancho x alto` casillas, una por
   * instancia, arrastrable con drag&drop nativo a CUALQUIER grid visible
   * (incluida ella misma, para reordenar). El drop calcula la celda a
   * partir del punto donde se suelta y delega toda la validación (¿cabe?
   * ¿es tuyo?) al servidor vía `opciones.mover` — aquí no se rechaza nada
   * por adelantado, solo se pide.
   */
  private renderGridContenedor(contenedorId: string, contenedor: ContenedorVista): HTMLDivElement {
    const grid = document.createElement("div");
    grid.style.position = "relative";
    grid.style.width = `${Math.max(1, contenedor.ancho) * TAM_CELDA}px`;
    grid.style.height = `${Math.max(1, contenedor.alto) * TAM_CELDA}px`;
    grid.style.background = `repeating-linear-gradient(0deg, transparent, transparent ${TAM_CELDA - 1}px, #4a3f2a ${TAM_CELDA}px), repeating-linear-gradient(90deg, transparent, transparent ${TAM_CELDA - 1}px, #4a3f2a ${TAM_CELDA}px)`;
    grid.style.border = "1px solid #6a5a3a";
    grid.style.marginBottom = "8px";

    grid.ondragover = (ev) => ev.preventDefault();
    grid.ondrop = (ev) => {
      ev.preventDefault();
      const datos = ev.dataTransfer?.getData("text/plain");
      if (!datos) return;
      let payload: { instanciaId: number; rot: 0 | 1 };
      try {
        payload = JSON.parse(datos);
      } catch {
        return;
      }
      const rect = grid.getBoundingClientRect();
      const x = Math.max(0, Math.min(Math.max(1, contenedor.ancho) - 1, Math.floor((ev.clientX - rect.left) / TAM_CELDA)));
      const y = Math.max(0, Math.min(Math.max(1, contenedor.alto) - 1, Math.floor((ev.clientY - rect.top) / TAM_CELDA)));
      this.opciones.mover(payload.instanciaId, contenedorId, x, y, payload.rot);
    };

    const lista = [...contenedor.items];
    for (const it of lista) {
      const entrada = ITEMS[it.itemId];
      const [wBase, hBase] = entrada?.huella ?? [1, 1];
      const w = it.rot === 1 ? hBase : wBase;
      const h = it.rot === 1 ? wBase : hBase;

      const celda = document.createElement("div");
      celda.draggable = true;
      celda.style.position = "absolute";
      celda.style.left = `${it.x * TAM_CELDA}px`;
      celda.style.top = `${it.y * TAM_CELDA}px`;
      celda.style.width = `${w * TAM_CELDA - 2}px`;
      celda.style.height = `${h * TAM_CELDA - 2}px`;
      celda.style.boxSizing = "border-box";
      celda.style.background = it.liquidoTipo ? "#3a5a6a" : "#3a3020";
      celda.style.border = "1px solid #b8a878";
      celda.style.borderRadius = "3px";
      celda.style.fontSize = "9px";
      celda.style.lineHeight = "1.2";
      celda.style.overflow = "hidden";
      celda.style.padding = "1px 2px";
      celda.style.cursor = "grab";
      const liquidoTxt = it.liquidoTipo ? ` (${it.liquidoTipo} ${it.liquidoVolumenMl}ml)` : "";
      celda.title = `${it.itemId} x${it.cantidad}${liquidoTxt}`;
      celda.textContent = `${it.itemId}${it.cantidad > 1 ? ` x${it.cantidad}` : ""}${liquidoTxt}`;
      celda.ondragstart = (ev) => {
        ev.dataTransfer?.setData("text/plain", JSON.stringify({ instanciaId: it.id, rot: it.rot }));
      };

      const declarado = entrada?.slotEquipo;
      if (declarado) {
        const destinos = SLOTS_FISICOS_POR_DECLARADO[declarado] ?? [declarado];
        const botones = document.createElement("div");
        botones.style.position = "absolute";
        botones.style.bottom = "0";
        botones.style.right = "0";
        for (const slotFisico of destinos) {
          const boton = document.createElement("button");
          const etiqueta = SLOTS.find((s) => s.slot === slotFisico)?.etiqueta ?? slotFisico;
          boton.textContent = destinos.length > 1 ? `→${etiqueta}` : "Eq.";
          boton.style.fontSize = "8px";
          boton.style.padding = "0 2px";
          boton.onclick = (ev) => {
            ev.stopPropagation();
            this.opciones.equipar(it.id, slotFisico);
          };
          botones.appendChild(boton);
        }
        celda.appendChild(botones);
      }

      grid.appendChild(celda);
    }

    if (lista.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.position = "absolute";
      vacio.style.top = "4px";
      vacio.style.left = "4px";
      vacio.style.fontSize = "10px";
      vacio.style.opacity = "0.6";
      vacio.textContent = "(vacío)";
      grid.appendChild(vacio);
    }

    return grid;
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
